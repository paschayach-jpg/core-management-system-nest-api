# Business Rules ที่ API ต้องรักษา

> เอกสารนี้รวม "กฎที่ซ่อนอยู่ใน Service / Stored Procedure / WinForms" ซึ่ง **ไม่ใช่ CRUD** แต่ต้องพอร์ตให้พฤติกรรมเหมือนเดิม
> ที่มา: อ่านโค้ด `CMS.Services/*`, `CMS.Domain/Models/UserContext.cs`, definition ของ SP ใน `db-export/sp-by-schema/*.md` และ `AGENTS.md` (ส่วน KMS Import)
> ตาราง Guard/Audit ราย method (สกัดอัตโนมัติ) อยู่ที่ [`06-service-use-cases.md`](06-service-use-cases.md) · ข้อสงสัย/จุดเสี่ยงอยู่ที่ [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md)

## 0. หลักการ

1. **API เป็นด่านเดียวที่บังคับกฎ** — ปัจจุบันกฎหลายข้อเช็กที่ฝั่ง WinForms (UI) และใน Service; API ต้องเช็กซ้ำที่ฝั่ง server ทุกครั้ง
2. **รหัสผู้ใช้ 2 แบบ:** DMS/KMS/WFE ใช้ `UserID` (int, FK `EMS.UserAccount`) หรือ `ADUserName` (string) · **RGP เก็บผู้ใช้เป็น `varchar` (ชื่อผู้ใช้)** ในคอลัมน์ `i_create_user`, `i_update_user` ฯลฯ — ต้อง map จาก token → ทั้งสองรูปแบบ
3. **Soft delete เป็นหลัก** — ดูคอลัมน์ `IsDeleted`/`IsActive`/`FileStatus=3` ต่อตารางใน data dictionary; การลบจริงมีเฉพาะที่ระบุด้านล่าง
4. **ทุกการแก้ไขสำคัญต้องเขียน `audit.AuditLog`** — รายการ Module/Action อยู่ใน `05-cross-cutting.md` หัวข้อ Audit

## 1. ผู้ใช้ สิทธิ์ และบทบาท

### 1.1 AppRole (ตัวเลขใน `EMS.UserAccount.AppRole`)
`1=Officer, 2=SrOfficer, 3=Manager, 4=Admin` — กฎที่พบซ้ำ:

| เงื่อนไข | ผล |
|---|---|
| `AppRole >= 3` | ถือเป็น "privileged": ข้ามการเช็ก `FolderAuthorityConfig`/ACL ในหลาย use case (สร้าง folder, อัปโหลด, ดูเนื้อหา) แต่ **ยังถูก Explicit Deny ของ ACL บล็อก** (`PermissionService.CheckPermissionInternal`) |
| Manager/Admin เท่านั้น | ตั้งสิทธิ์โฟลเดอร์/ไฟล์ (`SetFolderPermission`, `SetFilePermission`, `PropagatePermissionsToFiles`), ส่ง/อนุมัติ/ปฏิเสธ approval step, ลบถาวร folder, ApplyTemplate, ChangeConfidentialityLevel, CopyFolderStructure, ดู Audit log |
| Admin เท่านั้น | จัดการ OrgUnit (สร้าง/แก้/ย้าย/ลบ/force delete), จัดการ Menu, Grant/Revoke `UserOrgVisibility`, ดู/จัดการ share ทั้งหมด |
| SrOfficer ขึ้นไป | ย้าย folder (`MoveFolder`: `AppRole < 2` ห้าม) |
| เจ้าของ share หรือ Admin | Revoke/Toggle internal/external share, ดู access log |

### 1.2 Login / สร้างบัญชีอัตโนมัติ (`Program.Main`)
1. ตรวจ Username/Password หรือ Token กับ **AD Auth API ภายนอก** (`AdAuthApiBaseUrl` + `/api/auth/login|validate`)
2. หา `EMS.UserAccount` ด้วย `ADUserName` (`sp_GetUserAccountByADUserName`)
3. ถ้าไม่พบ → **สร้างอัตโนมัติ**: `AppRole=1`, `OrgUnitID=1`, `IsActive=1`, `ConsentGiven=0`
4. ถ้า `IsActive=0` → ปฏิเสธเข้าระบบ
5. `sp_UpdateLastLogin`
6. Sync ข้อมูลพนักงาน (ตำแหน่ง/แผนก/ฝ่าย/ระดับ) จาก AD API หรือ Employee API เข้า `EMS.UserAccount` (`EmployeeCode`, `Department*`, `Division*`, `PositionName`, `LevelCode`)
7. ถ้า `ConsentGiven=0` → ต้องยอมรับ PDPA ก่อน (`sp_UpdateUserConsent`; ถ้าปฏิเสธ = ออกจากโปรแกรม)
8. สร้าง `UserContext` (UserID, AppRole, ADUserName, Department/Division, LevelCode, PositionName, **Authority** (ผล resolve `FolderAuthorityConfig`), **SessionAcl** (ACL ที่ preload))
9. เขียน audit `Auth/LOGIN` (และ `Auth/LOGOUT` ตอนปิดโปรแกรม)

### 1.3 Authority (`EMS.FolderAuthorityConfig`) — สิทธิ์ตามระดับความลับ
- `sp_ResolveFolderAuthority(@LevelCode,@PositionName,@DepartmentCode,@DivisionCode)` เลือกชุดกฎแบบ **ลำดับความสำคัญ แล้วหยุดที่ระดับแรกที่พบ**:
  0. `LevelCode` + `DepartmentCode` → 1. `LevelCode` ล้วน (Department ว่าง) → 2. `PositionName` → 3. `DepartmentCode` ล้วน (ไม่มี Position/Level) → 4. `DivisionCode` ล้วน
- ผลคือแถวต่อ `ConfidentialityLevel` (1–4) มีธง `CanView/CanAdd/CanEdit/CanApprove/CanDownload`
- `UserContext`:
  - `CanViewFolder(level)`: ถ้าไม่มีแถว → ผ่านเฉพาะ **level 4 (PC)**; ถ้ามีแถวใช้ค่า `CanView`
  - `CanAddToFolder`, `CanEditFolder`, `CanApproveFolder`: ไม่มีแถว = **ไม่อนุญาต**
- `sp_Insert/UpdateFolderAuthorityConfig` คำนวณ `LevelCode`↔`ConfidentialityLevel` ให้ถ้าส่งมาอย่างเดียว (`1HC/2SC/3NC/4PC`)
- `sp_DeleteFolderAuthorityConfig` = **soft delete ทั้งกลุ่มตาม `ConfigLabel`** (ทุก level ของ label เดียวกัน) ไม่ใช่ตาม `ConfigID`
- ⚠ `CanDownload` มีในตาราง แต่ SP Insert/Update ไม่รับพารามิเตอร์นี้

## 2. DMS — Folder / File / Permission

### 2.1 โครงสร้าง Folder
- ทุก OrgUnit มี **Root Folder หลัก 4 อัน** ชื่อต้องขึ้นต้นด้วย `1HC`, `2SC`, `3NC`, `4PC` ตรงกับ `ConfidentialityLevel` 1–4; **ห้ามสร้าง Root อื่น** (`EnsureRootCreationAllowed`)
- Root `2SC/3NC/4PC` สร้างได้ครั้งเดียวต่อ OrgUnit (เช็กซ้ำ); **`1HC` สร้างได้หลายอัน แต่ต้องผ่าน approval `CREATE_HC`**
- Folder ลูกต้องอยู่ใต้ Root หลัก (`EnsureCreationUnderMainRoots`); `FolderDepth` ≤ **10** (`MaxFolderDepth`; root = depth 1 ในโค้ด, DB CHECK 0–10)
- ชื่อ folder ห้ามมีอักขระต้องห้าม (`InvalidFolderNameChars`), ชื่อซ้ำใน parent เดียวกัน (case-insensitive, trim) ไม่ได้ **ยกเว้น 1HC**
- ลูกที่ไม่ระบุ `ConfidentialityLevel` → สืบทอดจาก parent และ `InheritPermission=1`; ถ้าระบุเอง → `InheritPermission=0`
- เปลี่ยนระดับความลับ: Manager/Admin เท่านั้น, level 1–4, **เปลี่ยนไม่ได้กับ Conf-Root เอง** และเปลี่ยนได้เฉพาะ folder ที่อยู่ **ใต้ Conf-Root โดยตรง** (`BR-001-07`)
- เปลี่ยนชื่อ/ลบ **Root Folder หลักไม่ได้**
- ก่อนสร้างเรียก `FolderQuotaService.EnforceQuota(orgUnitId)` (บล็อกถ้า quota เต็ม) และ `SendAlertIfNeeded`

### 2.2 วงจรชีวิต Folder
| การกระทำ | กฎ |
|---|---|
| ลบ (`DeleteFolder`) | ต้องมีสิทธิ์ `Modify`; ถ้ามีไฟล์อยู่ **ลบตรงไม่ได้ ต้องส่ง approval `DELETE_FOLDER`** (`RequestFolderDelete`; ถ้าไม่มีไฟล์ต้องลบตรง ไม่ยื่น approval; ต้องมี Admin Active อย่างน้อย 1 คน) |
| ผล soft delete | `sp_SoftDeleteFolder` ตั้ง `IsDeleted=1`, `DeletedDate`, `RecycleBinExpiry = +30 วัน` **ให้ทั้งต้นไม้ย่อย (recursive CTE)** |
| กู้คืน | ภายใน **30 วัน** (`RecycleBinRetentionDays`); ต้องมี parent เดิมอยู่ มิฉะนั้นต้องเลือก parent ใหม่; `sp_RestoreFolder` คืนทั้งต้นไม้ย่อย |
| ลบถาวร | Manager/Admin; ต้องอยู่ในถังขยะก่อน; ลบ ไฟล์ (ทางกายภาพบน share), approval, permission แล้วค่อยลบ row |
| ย้าย | SrOfficer ขึ้นไป; ต้องมีสิทธิ์ทั้งต้นทางและปลายทาง; ห้ามให้ depth เกิน 10 |
| คัดลอกโครงสร้าง | Manager/Admin |
| ApplyTemplate | `ApplyTemplate` = Manager/Admin; `ApplyTemplateToFolder/ToOrgUnit` เช็กสิทธิ์ `CanAdd`/ACL `Write`; ใช้ `storage.FolderTemplate/Item` (ลูกซ้อนผ่าน `ParentItemID`) |
| จำนวนไฟล์ | `FileCount` คำนวณสดใน SP (`FileStatus != 3 AND DeletedDate IS NULL`) ไม่ใช้ค่าในคอลัมน์ |

### 2.3 การประเมินสิทธิ์ (ต้องพอร์ตให้เหมือนเดิม)
ประเมินสิทธิ์ `Read/Write/Delete/Modify/FullControl` ของ user ต่อ folder:

```
CheckPermission(user, folder, perm):
  ถ้า user.AppRole >= 3:
      ถ้ามี Explicit Deny ที่ applicable และตรง perm → false
      ไม่งั้น → true            (Manager/Admin bypass)
  ไม่งั้น Evaluate(folder):
      applicable = ACL ของ folder ที่ PrincipalType ตรงกับ user:
          User(=UserID) | Role(=AppRole) | Department(=user.DepartmentId) | Division(=user.DivisionId)
      ถ้ามี applicable.IsDeny ที่ตรง perm → false          (Deny ชนะเสมอ)
      ถ้ามี applicable.Allow ที่ตรง perm → true
      ถ้า ไม่มี entry ใดใน folder นี้ที่ InheritanceBroken และมี parent → Evaluate(parent)
      ไม่งั้น → false                                       (default deny)
  MatchesFlag: FullControl ผ่านทุก perm
      Read=CanRead · Write=CanWrite|CanModify · Delete=CanDelete|CanModify · Modify=CanModify · FullControl=CanFullControl
```
- ACL ที่นับ = `RevokedDate IS NULL AND (ExpiryDate IS NULL OR ExpiryDate > now)` (`sp_GetPermissionsByFolder`)
- **แนวคิด 2 ชั้นสำหรับ non-privileged:** upload/สร้าง folder ผ่านถ้า `FolderAuthorityConfig.CanAdd` ของ level นั้น **หรือ** ACL `Write`
- `SetFolderPermission`: Manager/Admin; **revoke รายการเดิมของ principal+folder+IsDeny เดียวกัน** ("Replaced by new permission entry") แล้ว insert ใหม่; เขียน audit `Permission/GRANT|DENY`
- `PropagatePermissionsToFiles`: revoke สิทธิ์ไฟล์เดิมทุกไฟล์ในโฟลเดอร์แล้วคัดลอกสิทธิ์ folder (ที่ยังไม่ revoke/หมดอายุ) ลง `security.FilePermission`; **ตอนอัปโหลดไฟล์ใหม่ระบบก็ propagate อัตโนมัติ**
- ⚠ แคชสิทธิ์/ACL/ผู้ใช้เป็น `Dictionary` ใน instance ของ service ต่อ session (WinForms) — ใน API ต้องเป็นแคชต่อ request หรือ TTL สั้น + invalidate เมื่อแก้สิทธิ์ (`InvalidateCache`, `InvalidateUserCache`)

### 2.4 ไฟล์
| เรื่อง | กฎ |
|---|---|
| ชนิดไฟล์ที่อนุญาต | `.pdf .doc .docx .xls .xlsx .ppt .pptx .jpg .png .gif .zip` |
| ขนาดสูงสุด | **100 MB** ต่อไฟล์ |
| ตรวจ folder | ต้องมี, ไม่ถูกลบ, ไม่ถูก archive |
| ตรวจสิทธิ์ | privileged ผ่าน; อื่นๆ ต้อง `CanAdd` (Authority) หรือ ACL `Write` |
| Quota | `ValidateBatchAgainstOrgQuota` ก่อนทั้งชุด (ทั้งชุดล้มถ้าเต็ม) — ⚠ การเช็ก quota ราย folder (`Folder.QuotaBytes`) ไม่ทำงานจริง เพราะ field นี้ไม่ได้ map จาก DB (ดู OPEN_QUESTIONS) |
| ชื่อซ้ำ | ปกติเปลี่ยนเป็น `name copy(N).ext` (`ResolveFileName`); `OverwriteExisting=true` = "replace": ชื่อเดิม + `Version+1`, ไฟล์กายภาพใหม่ชื่อ `<base>_<yyyyMMddHHmmssfff><ext>`, **soft-delete แถวเก่า** หลังแถวใหม่ถูกบันทึก |
| Checksum | SHA-256 (`Checksum`) |
| Virus scan | **ปิดอยู่** (ถือว่า Clean, `VirusScanStatus=1`) แม้มี ClamAV config |
| เส้นทางเก็บ | `<NetworkDrivePath>\<OrgUnitID>\<FolderID>\<storedName>` (`NetworkDriveHelper.BuildPath`) |
| ตรวจหลังเขียน | ขนาดบน share ต้องตรงกับขนาดที่รับ ถ้าไม่ตรง = ลบไฟล์แล้วล้มเหลว |
| หลังบันทึก | propagate สิทธิ์ folder → file; อัปเดต `FileCount`/ขนาด folder; ถ้ามีข้อผิดพลาดขั้นตอนย่อยจะไม่ rollback การอัปโหลด |
| ดาวน์โหลด | ต้องผ่าน Authority/ACL (privileged ผ่าน); ไฟล์ที่ลบแล้วโหลดไม่ได้; audit `File/DOWNLOAD` · มี flow ขออนุมัติดาวน์โหลดแยก (`SubmitDownloadRequest` → `GetApprovedDownloadRequest` → `ConsumeDownloadApproval` ใช้ได้ครั้งเดียว) ซึ่งฝั่ง UI เป็นผู้เลือกเรียก |
| ซ่อน/แสดง | `HideFiles`/`UnhideFiles` (audit `File/HIDE|UNHIDE`) |
| ย้าย/คัดลอก | ย้าย: ไฟล์ต้อง Active; ต้องมีสิทธิ์ปลายทาง; คัดลอก: ต้องเขียนปลายทางได้, ไฟล์ที่ถูกลบคัดลอกไม่ได้ |
| เปลี่ยนชื่อ | ชื่อต้องไม่ว่าง, ไฟล์ต้องไม่ถูกลบ (`sp_RenameFileDocument` เช็ก `DeletedDate IS NULL`), ต้อง `Edit` |

### 2.5 Approval (workflow.ApprovalRequest/Step)
- **ส่งคำขอ** (`SubmitPermissionRequest`): Manager/Admin; ถ้ามี `FolderID` ต้องเป็น folder ระดับ **HC/SC (≤2)** เท่านั้น; ต้องมี Subject และอย่างน้อย 1 step; `ExpiryDate` เริ่มต้น **+1 วัน**; เรียง step ตาม `StepOrder`
- **อนุมัติ step** (`ApproveStep`): Manager/Admin; step ต้องเป็น Pending(1) หรือ Delegated(4); request ต้อง Pending
  - ปกติ: ถ้ามี step ถัดไป (`StepOrder` มากกว่า, Pending) → แจ้งผู้อนุมัติถัดไป; ถ้าไม่มี → request = Approved(2) แล้ว **ทำผลข้างเคียงตาม `RequestType`**
  - `CREATE_HC`: **อนุมัติคนแรกจบ** (ปิด step ที่เหลือเป็น 4) → สร้าง 1HC folder (`FolderService.CreateHCFolderAfterApproval`) **ก่อน** mark Approved; ล้มแล้ว throw
  - `CHANGE_PERMISSION`: parse `Remark` เป็น `SetPermissionRequest` แล้วเรียก `SetFolderPermission`
  - `DELETE_FOLDER`: `SoftDelete` folder
  - `EXTERNAL_SHARE` (หรือ Remark มี `ExternalShareID:<n>`): ExternalShare `Pending→Active`, ใส่ `ApprovedDate/ApproverUserID`, token ทุกตัว → `Active`
  - `INTERNAL_SHARE` (Remark ขึ้นต้น `InternalShareFile…`): parse Remark → insert `security.FilePermission` (GrantedBy = ผู้ขอ)
  - แจ้งผู้ขอ (`ApprovalRequestApproved`)
  - ⚠ **ผลข้างเคียงทั้งหมด (นอกจาก CREATE_HC) ไม่อยู่ใน transaction และกลืน exception** (log เท่านั้น) — API ควรใช้ transaction เดียวและตัดสินใจเรื่อง rollback
- **ปฏิเสธ step** (`RejectStep`): Manager/Admin; ปฏิเสธ → request = Rejected(3)
- **ถอนคำขอ** (`WithdrawRequest` — ปัจจุบันไม่มีหน้าจอเรียก): ปิด step ที่ค้างเป็น Rejected(3) และตั้ง request = **4 (Expired)** (ใช้ค่าเดียวกับหมดอายุ)
- **Escalation** (`ProcessEscalations`, ปัจจุบันรันที่ **timer ในฝั่ง client** ทุก `EscalationTimerIntervalSeconds` default 60s): request ที่ `RequestStatus=1 AND ExpiryDate < now` → step ปัจจุบันเป็น Delegated(4), เพิ่ม step ใหม่ให้ **role 3 (Manager) หรือ 4 (Admin)** (ถ้า ApproverID เดิม = 3 → 4, ไม่งั้น → 3), แจ้งผู้ขอและผู้ถือ role นั้นทั้งหมด → **ใน API ต้องเป็น scheduled job เดียว**
- **Download approval:** `SubmitDownloadRequest` (ทุก role ส่งได้ ต้องมีเหตุผลและ approver) → อนุมัติ → `GetApprovedDownloadRequest` → `ConsumeDownloadApproval` (ใช้ครั้งเดียว)
- ส่ง notification ทุกขั้น (`EMS.sp_InsertNotification`) และ audit `Workflow/*`, `Folder/*`, `FileSharing/*`, `Download/*`
- ⚠ **`Remark` เป็นพื้นที่เก็บ payload แบบมีโครงสร้าง** (`ExternalShareID:<n>`, `InternalShareFile…`, JSON/ข้อความสิทธิ์) — ไม่มีคอลัมน์แยก; API ควรออกแบบ payload ให้ชัด (หรือเพิ่มคอลัมน์) แต่ต้องอ่านข้อมูลเดิมที่เก็บรูปแบบเก่าได้

### 2.6 Sharing
- **Internal share** (`CreateInternalShare`): ผู้แชร์ต้องมีสิทธิ์เพียงพอ; วันหมดอายุห้ามย้อนหลัง และไม่เกิน **1 ปี**; **ต้องผ่าน approval `INTERNAL_SHARE` เมื่อผู้แชร์ `AppRole < 3` หรือแชร์ให้ `PrincipalType = 3` (Department)** นอกนั้นสร้าง `security.FilePermission` ทันที; Revoke: เจ้าของหรือ Admin
- **External share** (`CreateExternalShare`): ระบุ `FileID` **หรือ** `FolderID` อย่างใดอย่างหนึ่ง (ไม่ทั้งคู่; CHECK `CK_ExternalShare_FileOrFolder`); ต้องมีสิทธิ์ Read; **ห้ามแชร์ HC (level 1)** และห้ามแชร์โฟลเดอร์ที่มีไฟล์ HC; อายุไม่เกิน **90 วัน**; ตั้งรหัสผ่าน (hash) + จำกัดจำนวนดาวน์โหลด + `NotifyOnAccess` ได้; สร้างเป็น `Pending` พร้อม token (GUID) และเปิด approval ให้ **Manager ทุกคน (ไม่รวมผู้ขอ), ถ้าไม่มี → Admin**; request หมดอายุใน **7 วัน** (`PendingApprovalExpiryDays`)
- การจัดการ: `Approve/Reject` (เฉพาะ Pending), `Revoke`/`Toggle` (Disable↔Enable; เฉพาะสถานะที่อนุญาต) โดยเจ้าของหรือ Admin; ดู access log ได้เฉพาะเจ้าของ/Admin
- การเข้าถึง token ภายนอก (`ShareAccessService.ValidateAndGrantAccess`: ตรวจ token, สถานะ, วันหมดอายุ, รหัสผ่าน, limit ดาวน์โหลด) — **ปัจจุบันหน้าจอ `AccessShareForm` ไม่ถูกเปิดจากที่ใด (dead)** → ต้องยืนยันว่า API ต้องมี endpoint สาธารณะนี้หรือไม่ (ดู OPEN_QUESTIONS)

### 2.7 Quota (`FolderQuotaService`)
- โควตาเก็บเป็นคอลัมน์ `quota_size` บน **`EMS.m_SubCommittee`, `EMS.m_Division`, `EMS.m_Department`** (ไม่ใช่ตารางแยก); `FolderQuotaConfig.Save/Delete` เขียนคอลัมน์นี้ (`Delete` = ตั้ง 0)
- เกณฑ์เตือน: `WarnThresholdPct` (ค่า default ในโค้ด 80) < `CriticalThresholdPct` (95) < 100; ระดับ `Normal/Warning/Critical/Full`
- `EnforceQuota`: บล็อกการสร้าง/อัปโหลดเมื่อ "เต็ม" ด้วยข้อความ "พื้นที่ folder เต็ม …"
- คำขอเพิ่มโควตา (`dms.FolderQuotaChangeRequest`): ขนาดที่ขอต้อง > 0 และ > ปัจจุบัน, ต้องระบุเหตุผล; Approve/Reject เฉพาะ Pending (Reject ต้องมีเหตุผล); Cancel ได้เฉพาะของตนเองที่ยัง Pending

### 2.8 Org / HR master / Menu / Visibility
- **OrgUnit** (Admin เท่านั้น): สร้าง — ชื่อไทยบังคับ, `OrgUnitCode` ห้ามซ้ำ (`sp_InsertOrgUnit` RAISERROR) และ service สร้างรหัสไม่ซ้ำโดยลองซ้ำหลายครั้ง; แก้ได้เฉพาะ ชื่อไทย/อังกฤษ/ลำดับ (`sp_UpdateOrgUnit`); ย้ายได้ (`MoveOrgUnit`); ปิด/ลบต้อง **ไม่มี Folder/UserAccount Active ผูกอยู่** (`sp_HasActiveDependents` ตรวจเฉพาะ 2 ตารางนี้ — ตารางอื่นที่มี FK ไป `OrgUnit` ยังเหลือ); `ForceDelete` soft-delete folder ที่ผูกด้วย
- **HR master** (`OrgMasterService`: Division/Department/Position(=`m_Role`)/Level(=`m_Position`)/Mapping): CRUD + import Excel (ตรวจหัวคอลัมน์แรก "รหัสฝ่าย"); ทุกการแก้ audit `OrgMaster/SAVE_*|DELETE_*|IMPORT_ORG_MASTER`
- **Menu** (`EMS.MenuItem`, Admin เท่านั้น): `MenuKey` ต้องไม่ซ้ำ, ชื่อบังคับ; `sp_DeleteMenuItem` ลบจริง (คอมเมนต์อ้าง cascade แต่ไม่เห็น FK) — ⚠ `FormClassName` คือชื่อคลาส WinForms; ดู OPEN_QUESTIONS เรื่อง mapping เมนูใหม่
- **UserOrgVisibility** (`security.UserOrgVisibility`): Admin Grant/Revoke การมองเห็น OrgUnit ต่อผู้ใช้ (PK = UserID+OrgUnitID)

## 3. KMS

### 3.1 วงจรบทความ
`Draft(1) → Review(2) → Published(3) → Archived(4)`; Archived แล้ว **เปลี่ยนสถานะไม่ได้อีก** (`ChangeStatus`) — ⚠ service ไม่ได้บังคับ role/ผู้ตรวจ ตามคอมเมนต์ในโค้ด (ตรวจเฉพาะ UI) · Audit: `SUBMIT_REVIEW|PUBLISH|ARCHIVE`
- สร้าง: ต้องมีชื่อ, Category, ArticleCode ไม่ซ้ำ (รวมที่ soft-delete แล้ว); `Update` เพิ่ม `t_KBVersion` เมื่อ `ContentHTML` เปลี่ยนเท่านั้น (ordinal compare) และเพิ่ม `CurrentVersion`
- แก้ไขไม่เปลี่ยน `ArticleCode`, `CategoryID` (ใช้ "ย้ายบทความ"), `Status`, `ReviewDueDate`, `IsOfficialPolicy`
- ลบ = soft delete (`IsDelete`) + ลบ link สองทาง + audit; link บทความเป็นแบบสองทาง (`LinkArticles/UnlinkArticles`)
- `SaveArticleAttachments` **ลบ attachment เดิมทั้งหมดก่อน** — เรียกเฉพาะบทความที่ยังไม่มีไฟล์

### 3.2 Category
- ชื่อ/รหัสบังคับ; ห้ามตั้ง parent เป็นตัวเองหรือหมวดย่อยของตัวเอง; **ลำดับชั้นไม่จำกัดความลึก** (`ParentCategoryID`)
- `CategoryID` อาจเป็น IDENTITY หรือ INT ธรรมดา — `KBCategoryRepository.Insert` ตรวจแล้วใช้ `MAX+1` ใน transaction แบบ Serializable ถ้าไม่ใช่ IDENTITY (ดู data dictionary `KMS.m_KBCategory`)
- `ImportTypeDigit` unique, 1–9, ห้ามอยู่ใต้ `LW`
- ปิดใช้งาน = `IsActive=0`

### 3.3 Import (รายละเอียดเต็มอยู่ใน `AGENTS.md` หัวข้อ "KMS Import (MOD-006)")
สรุปที่ API ต้องรักษา:
- ไฟล์มี 3 ชนิดไม่ปนกัน: **Law / Decree / NonLaw** ตรวจจากรหัสแรกในคอลัมน์ `ArticleCode` ตาม Template; Template ต้องตรงกับชนิดไฟล์ (`LayoutType`), Decree Template ต้อง map `LawReference`
- **รหัส Code รวม ยาว 29 ตัวอักษร** (ไม่รับ 27): Law ลงท้าย `00000`, 5 ตัวแรก=รหัสกฎหมาย (ตำแหน่ง 4–5 = `00` เป็นกฎหมาย, อื่นๆ = พระราชกฤษฎีกา), ตำแหน่ง 6–9=เลขมาตรา, เก็บ 24 ตัวแรก; NonLaw ตำแหน่ง 25 = ตัวเลขประเภทเอกสาร (`ImportTypeDigit`) เก็บ 29 ตัว
- หมวดปี: กฎหมายที่มี category ลูกรายปี (`PLI002535`) ต้องเลือกลูกตามปีใน ArticleCode (ขาดปี = Error); NonLaw อยู่ใน `<ประเภท><พ.ศ.>`
- **Re-upload = update** รหัสที่มีอยู่ (ไม่เพิ่มซ้ำ): เขียนทับเฉพาะคอลัมน์ที่ Excel มีค่า (ไม่ว่าง) ผ่าน whitelist `ImportUpdatableColumns`; **ไม่แตะ `ArticleCode`/`CategoryID`**; Law เพิ่ม version เมื่อเนื้อหาต่าง; รหัสที่ soft-delete = Error
- ข้อความ: ContentHTML แปลงด้วย `ConvertPlainTextToHtml` (encode, `<br>`, `&nbsp;`); Title/Summary เป็น plain text เก็บตามที่พิมพ์ (แปลง LF→CRLF); Title ของ Law = `มาตรา N` (derive)
- ไฟล์แนบ: ไฟล์ชื่อเดียวกันหลายมาตราใช้ FileID เดียว (`SharedFileCache`); เช็กไฟล์ที่มีใน DMS โฟลเดอร์ปลายทางก่อนอัปโหลดใหม่ (ห้ามสร้าง `copy(N)`); **DMS folder ปลายทางฝัง `437` ในโค้ด** (Editor ใช้ folder 1)
- การย้ายบทความ (`KBArticleMoveService`): เปลี่ยนแค่ `CategoryID` + UpdatedBy/Date ไม่สร้าง version; มีคำเตือน (ไม่ใช่ block) เมื่อข้าม Law↔NonLaw ฯลฯ; audit `MOVE_KB_ARTICLE` ต่อบทความ
- Display Profile/Import Template: ชื่อห้ามซ้ำ, ตั้งค่า Template ต้องครบ (`GetTemplateProblems`), deactivate/activate แยกกัน, audit ทุกครั้ง

## 4. RGP (Project)

- **เลขที่โครงการ** (`c_project_no`): สร้างจาก `RunningNumber` (`running_type='PRJ'`, format เช่น `PPP-YY-######`) **ใน transaction + `UPDLOCK,ROWLOCK`** และรีเซ็ตเมื่อขึ้นปีใหม่; **Task code**: `running_type='TK'` (ล้มถ้าไม่มีแถวนี้)
- ตาราง `RunningNumber` อยู่ฐาน **ProjectDb (BUI_RG เดิม)** — คนละฐานกับ `RGP.*`
- **สร้างโครงการ:** `c_status='Open'`; ไม่ copy state/document จาก template ในฝั่ง service (UI "stage" ไว้แล้วบันทึกทีหลัง) — API ต้องรองรับ "สร้างโครงการพร้อมลูก (state/doc) ในครั้งเดียว"
- **ลบโครงการ** (soft): ถูกบล็อกถ้ามี progress (`HasActiveProgress`)
- **ปิดโครงการ** (`CloseProject`): ถูกบล็อกถ้า state ที่ `f_required='Y'` ยังไม่ Completed — ⚠ method นี้ไม่ถูกเรียกจากหน้าจอ (dead)
- **ความคืบหน้า:** บันทึก `t_project_progress` → ตั้งสถานะ state จาก % (0=Pending, 100=Completed, อื่น=InProgress) → คำนวณสถานะโครงการใหม่: ทุก required state Completed และมี progress → `Completed`; มี progress อย่างน้อยหนึ่ง → `InProgress`; ไม่มี → `Open`
- **Task:** `UpdateStatus` — `OnHold` ตรึง % ไว้ที่ค่าเดิม; หลังเปลี่ยนสถานะ **sync % ของ state = ค่าเฉลี่ย % ของ task** (`CalcStatePctFromTasks`) แล้วบันทึก progress "Auto-sync จาก Tasks"; บันทึก `t_project_task_status_log` ทุกครั้ง; audit `UPDATE_PROJECT_TASK_STATUS`
- soft delete: task/comment/project/state (`f_active`); `Delete` จริงเฉพาะ `t_project_state` (ลบ state ต้องไม่มี progress), `t_project_member`, `t_project_state_member`, `t_project_doc_workflow`, template และลูก
- Audit ใช้ตาราง `RGP.t_project_audit_log` ผ่าน `ProjectAuditService` (ไม่ใช่ `audit.AuditLog`), ผล `Result: 1=สำเร็จ, 2=ล้มเหลว`
- ไฟล์แนบโครงการ: เก็บใน DMS (`storage.FileDocument`) + ผูกด้วย `storage.t_project_attachment (i_project_id,i_file_id)` unique
- Template: `m_project_template` (+ `f_is_legal_dict`), `m_template_state`, `m_template_doc`; ลบ template ต้องไม่มีโครงการใช้ (`Delete` ตรวจ `t_project`) และลบลูกก่อน; อ้างอิงเอกสารมาสเตอร์จาก `BUI_RG.dbo.m_document(_type)`
- Project member role ดึง SubCommittee/Division/Department จาก **BisDb**

## 5. WFE

### 5.1 Template (`WFE.s_WFDefinition`)
`Draft(0) → SubmitForApproval → PendingApproval(1) → Approve → Active(2)` · Reject กลับเป็น `Draft`; `PublishTemplate` ตั้ง Active ตรง ๆ; `DeactivateTemplate`; ลบ template ไม่ได้ถ้ามี instance ที่ยังทำงาน (`HasActiveInstances` — ⚠ method ใน repository ไม่มีผู้เรียก ดู OPEN_QUESTIONS)
- `IsActive` ถูกตั้งคู่กับสถานะ: Submit/Reject = false, Approve/Publish = true
- Designer เก็บ layout เต็มใน `TemplateDefinition` (JSON) ไม่ใช่ใน `s_WFStep/s_WFConnection` — Service มี `SyncStepsFromTemplateDefinition` เป็น fallback เมื่อแถว step ไม่ครบ

### 5.2 Instance / Step
- สร้าง instance: template ต้องมีและ `IsActive`; ต้องมีสิทธิ์สร้าง (`CanCreateWorkflowInstance`); **ต้องมี step ชนิด `Start`**; สร้างผ่าน `WFE.sp_CreateWFInstance` (Status=0, `TemplateVersion` = เวอร์ชันของ template) แล้วสร้าง step instance แรก (assign ให้ `AssignedUser` ของ step หรือผู้สร้าง, `SLADeadline = now+24h` ค่าเริ่มต้น) แล้วอัปเดต instance เป็น `InProgress` + `CurrentStepId`
- `WFE.sp_CreateWFStepInstance`: **คำนวณ `WorkflowStepInstanceId = MAX+1` ภายใต้ `TABLOCKX,HOLDLOCK`** (PK คอมโพสิต `WorkflowStepInstanceId,WFStepInstanceId`); `AssignedTo` ว่าง → ใช้ `InitiatedBy` ของ instance → `'system'`; `Status=1`, `SLAStatus='1'`; `SLADeadline` ถูกแปลงเป็นสตริง ISO-8601 (`CONVERT … 126`) ก่อน INSERT ลงคอลัมน์ `datetime` — **API ต้องเรียก SP นี้เท่านั้น ห้าม INSERT ตรง**
- Complete/Reject step: ผู้ทำต้องเป็น `AssignedTo`; step ที่ completed แล้วทำซ้ำไม่ได้; `StepResolverService` เลือก step ถัดไปจาก `s_WFConnection` + เงื่อนไข (`ConditionExpression` ผ่าน `ConditionEvaluatorService`)
- Suspend/Resume/Cancel: Cancel ไม่ได้ถ้า instance เสร็จหรือถูก cancel แล้ว; audit `WorkflowInstance*`
- ⚠ Audit ของ WFE ไม่ใส่ `Module` (ระบุแค่ `Action`/`TableName`)

### 5.3 Delegation (`dbo.WFDelegation`, ปัจจุบัน 0 แถว)
- `sp_WF_CreateDelegation`: **ปิด delegation active เดิมของ step instance นั้นก่อน**, คำนวณ `DelegationDepth = MAX+1`, ถ้า > `@MaxDelegationDepth` (default 3) → RAISERROR "Maximum delegation depth exceeded"; ใส่ `IsActive=1, IsDeleted=0`, คืน ID ทาง OUTPUT
- `DelegateTask`: validate (รวมเช็ก depth ≥ 3), ตั้ง step instance เป็น `Delegated`; `DeactivateDelegation` ตั้ง `IsActive=0`

### 5.4 SLA
- สถานะ: ครบกำหนดแล้ว = `Overdue`; ใช้เวลา ≥ threshold% = `AtRisk`; อื่นๆ = `OnTime` (threshold จาก `WorkflowSLAWarningThresholdPercent` หรือค่าเฉพาะ step)
- รายงาน SLA ใช้ SP `dbo.sp_WF_GetSLAComplianceMetrics` / `sp_WF_GetTaskDistribution` (พารามิเตอร์: `@WorkflowDefinitionId`, `@FromDate`, `@ToDate`; กรองด้วย `AssignedDate`) และ SQL ตรงใน `WFReportRepository` (by template, weekly trend, cycle time)
- งานเบื้องหลัง SLA/Escalation (`WFESLABackgroundJob`) **ไม่ได้ถูกเรียก (dead)** — คอนฟิก `WorkflowSLAJobIntervalMinutes`, `WorkflowEscalationEnabled`, `WorkflowAutoRejectOnOverdue` มีแต่ไม่ถูกใช้ผ่านงานที่ทำงานจริง

## 6. จุดที่ SP/ตารางบังคับกฎอยู่แล้ว (ไม่ต้องเขียนซ้ำ แต่ต้องไม่ทำลาย)
| ที่ | กฎ |
|---|---|
| `EMS.sp_InsertOrgUnit` | รหัสห้ามซ้ำในแถวที่ไม่ถูกลบ (RAISERROR) |
| `EMS.sp_CreateMenuItem/UpdateMenuItem` | `MenuName`/`MenuKey` บังคับ, `MenuKey` ไม่ซ้ำ (THROW 50001) |
| `dbo.sp_InsertSubCommittee` | ห้ามมี `OrgUnitID` ซ้ำใน `m_SubCommittee` |
| `storage.sp_RenameFileDocument` | เปลี่ยนชื่อไฟล์ที่ลบแล้วไม่ได้ |
| `audit.sp_QueryAuditLog` | ต้องส่งทุกพารามิเตอร์ (NULL = ไม่กรอง); `@PageNumber`/`@PageSize` บังคับ |
| `storage.ExternalShare` | CHECK: ต้องมี `FileID` xor `FolderID` |
| `security.UserOrgVisibility` | PK (`UserID`,`OrgUnitID`) |
| `storage.ShareAccessLog` | ชื่อ index `CK_ShareAccessLog_Immutable` — แนวคิดเป็น log ที่ห้ามแก้ (ไม่มี UPDATE/DELETE ในโค้ด) |
| `KMS.t_KBArticle` / `KMS.m_KBCategory` | unique `ArticleCode` / `CategoryCode` / `ImportTypeDigit` |
| `workflow.ApprovalStep` | unique (`RequestID`,`StepOrder`) |
