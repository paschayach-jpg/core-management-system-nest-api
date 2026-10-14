# DMS core — สรุปการพัฒนา

โมดูล `DmsCoreModule` (`src/modules/dms/core/**`) แทนส่วนแกนหลักของ DMS ในระบบ WinForms เดิม (`FolderService`, `FileService`, `FolderPermissionService`, `FolderTemplateRepository`, `UserOrgVisibilityService`, `QuickAccessService`, ถังขยะ) · route ขึ้นต้นด้วย `/dms` ทุกเส้น ต้องล็อกอิน (ไม่มี `@Public()`) · รวม 56 endpoint

โครงสร้างโค้ด: `rules/` (ฟังก์ชันล้วน ไม่แตะ I/O) → `*.repository.ts` (SQL/SP) → `*.service.ts` (กติกา + CRUD-log) → `*.controller.ts`; `access/folder-access.ts` รวมกติกา "สิทธิ์ 2 ชั้น"; `storage/file-storage.service.ts` จัดการไฟล์กายภาพ; `approval-handlers/` ผลข้างเคียงหลังอนุมัติ

## 1. Endpoint ที่ให้บริการ

"ล็อกอิน + Authority/ACL" = ผ่านถ้า Authority ของชั้นความลับอนุญาต **หรือ** ACL (FolderPermission) อนุญาต · Manager/Admin ข้ามชั้น Authority แต่ยังถูก Explicit Deny ของ ACL บล็อก

### โฟลเดอร์ (11)
| Method | Path | สิทธิ์ | คำอธิบาย / use case เดิม |
|---|---|---|---|
| GET | `/dms/folders` | ล็อกอิน (กรองตามหน่วยงานที่เห็น + สิทธิ์ดู) | รายการ flat ให้ client ประกอบต้นไม้ (`GetAccessibleFolders`) |
| GET | `/dms/folders/:id` | ดูได้ | รายละเอียด + path จาก Root |
| GET | `/dms/folders/:id/children` | ดูได้ | โฟลเดอร์ย่อยชั้นถัดไปที่ฉันเห็น |
| GET | `/dms/folders/:id/stats` | ดูได้ | จำนวนไฟล์/ขนาด นับสดจาก `FileDocument` |
| POST | `/dms/folders` | เพิ่มได้ (Authority CanAdd / ACL Write) | สร้างโฟลเดอร์ย่อยหรือ Root (กฎ Root 1HC/2SC/3NC/4PC) · 201; Root 1HC ต้องอนุมัติ → 202 |
| PATCH | `/dms/folders/:id` | แก้ไขได้ | เปลี่ยนชื่อ (Root หลักเปลี่ยนชื่อไม่ได้) |
| PUT | `/dms/folders/:id/parent` | SrOfficer+ | ย้ายโฟลเดอร์ |
| POST | `/dms/folders/:id/copy-structure` | Manager+ | คัดลอกโครงสร้าง (ไม่รวมไฟล์) |
| PUT | `/dms/folders/:id/confidentiality` | Manager+ | เปลี่ยนชั้นความลับ (BR-001-07) |
| DELETE | `/dms/folders/:id` | ลบโฟลเดอร์ได้ (Modify) | soft delete ผ่าน `storage.sp_SoftDeleteFolder` · มีไฟล์ → 409 `FOLDER_HAS_FILES` |
| POST | `/dms/folders/:id/delete-requests` | ลบโฟลเดอร์ได้ | ยื่นคำขอ `DELETE_FOLDER` (202) ผ่าน `DMS_APPROVAL_PORT` |

### ไฟล์ (11)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| POST | `/dms/folders/:folderId/files` | เพิ่มได้ | อัปโหลด multipart (ฟิลด์ `files` ≤20 ไฟล์) · ตรวจชนิด/100 MB · โควตาทั้งชุดก่อน · ชื่อซ้ำ → `copy(N)` หรือ `overwriteExisting=true` → Version+1 · ตอบผลรายไฟล์ |
| GET | `/dms/folders/:folderId/files` | ดูได้ | รายการแบ่งหน้า (sortBy name/size/uploadedDate/version/extension) |
| POST | `/dms/folders/:folderId/files/check-duplicates` | เพิ่มได้ | ชื่อใดซ้ำก่อนอัปโหลด |
| POST | `/dms/files/move` | `canMoveWithin` ทั้งต้นทางและปลายทาง (Authority เพิ่ม/แก้ไข หรือ ACL Write/Modify; Admin ผ่าน) | ย้ายหลายไฟล์ ตอบผลรายไฟล์ |
| GET | `/dms/files/:id` | ดูได้ | รายละเอียดไฟล์ |
| GET | `/dms/files/:id/versions` | ดูได้ | ประวัติเวอร์ชัน (ชื่อเดียวกันในโฟลเดอร์เดียวกัน) |
| GET | `/dms/files/:id/download-access` | ดูได้ | ดาวน์โหลดได้ทันทีหรือต้องขออนุมัติ |
| GET | `/dms/files/:id/download` | ประตูดาวน์โหลด (ข้างล่าง) | stream (`StreamableFile`) ตรวจ SHA-256 ระหว่างส่ง · log `DOWNLOAD_FILE` |
| PATCH | `/dms/files/:id` | แก้ไขได้ | เปลี่ยนชื่อ (ต้องคงนามสกุล) |
| POST | `/dms/files/:id/copy` | อ่านไฟล์ต้นทางได้ และเพิ่มในปลายทางได้ | คัดลอกไฟล์ (คัดลอกไฟล์กายภาพ + ชื่อใหม่ถ้าซ้ำ) |
| DELETE | `/dms/files/:id` | ลบไฟล์ได้ (Delete) | ลบลงถังขยะ (soft delete) |

### ACL / สิทธิ์ (8)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/dms/folders/:id/permissions` | Manager+ หรือมี Modify บนโฟลเดอร์ | ดู ACL (`?includeHistory`) |
| GET | `/dms/folders/:id/my-permissions` | ล็อกอิน | สิทธิ์ของฉัน (ผ่าน `PermissionEvaluator` ตัวเดียวกับที่บังคับจริง) |
| PUT | `/dms/folders/:id/permissions` | Manager+ | ตั้งสิทธิ์: เพิกถอนแถวเดิมของ principal+folder+IsDeny เดียวกันแล้ว insert ใหม่ |
| DELETE | `/dms/folders/:id/permissions/:permissionId` | Manager+ | เพิกถอน |
| POST | `/dms/folders/:id/permissions/propagate` | Manager+ | กระจายสิทธิ์โฟลเดอร์ลงไฟล์ (`PROPAGATE_TO_FILES`) |
| GET | `/dms/files/:id/permissions` | Manager+ | สิทธิ์ระดับไฟล์ |
| PUT | `/dms/files/:id/permissions` | Manager+ | ตั้งสิทธิ์ไฟล์ (รวม `canDownload`) |
| DELETE | `/dms/files/:id/permissions/:permissionId` | Manager+ | เพิกถอนสิทธิ์ไฟล์ |

### ถังขยะ (5)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/dms/recycle-bin/folders` | ล็อกอิน (Manager+ เห็นทั้งหมด · อื่นๆ เห็นที่ตนลบ) | โฟลเดอร์ที่ยังกู้ได้ (≤30 วัน) |
| POST | `/dms/recycle-bin/folders/:id/restore` | สิทธิ์เดียวกับการลบ | กู้คืนทั้งต้นไม้ย่อย (แม่เดิม หรือระบุ `newParentFolderId`) |
| DELETE | `/dms/recycle-bin/folders/:id` | Manager+ | ลบถาวร (DB ก่อน แล้วไฟล์กายภาพ) |
| GET | `/dms/recycle-bin/files` | เหมือนโฟลเดอร์ | ไฟล์ในถังขยะ |
| POST | `/dms/recycle-bin/files/:id/restore` | เพิ่มในโฟลเดอร์เดิมได้ | กู้คืนไฟล์ (ชื่อชนกับไฟล์ที่ใช้งาน → `copy(N)`) |

### แม่แบบโฟลเดอร์ (10)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/dms/folder-templates` | ล็อกอิน (`includeInactive` เฉพาะ Manager+) | รายการ |
| GET | `/dms/folder-templates/:id` | ล็อกอิน | แม่แบบ + รายการทั้งหมด |
| POST / PATCH / DELETE | `/dms/folder-templates[/:id]` | Manager+ | CRUD แม่แบบ (ลบไม่ได้ถ้ามีโฟลเดอร์อ้างอิง → 409 `TEMPLATE_IN_USE`) |
| POST / PATCH / DELETE | `/dms/folder-templates/:id/items[/:itemId]` | Manager+ | CRUD รายการ (ลบพร้อมลูกหลาน) |
| POST | `/dms/folders/:id/apply-template` | Manager+ และเพิ่มได้ | สร้างโฟลเดอร์ตามแม่แบบใต้โฟลเดอร์นี้ (`ApplyTemplate`) |
| POST | `/dms/folder-templates/:id/apply-to-org-unit` | Manager+ | สร้าง Root 2SC/3NC/4PC ใหม่ของหน่วยงาน + โครงสร้างจากแม่แบบ (`ApplyTemplateToOrgUnit`) |

### ทางลัด (3) และการมองเห็นหน่วยงาน (8)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET / PUT / DELETE | `/dms/quick-access[/:folderId]` | ล็อกอิน (ของฉันเท่านั้น) | ทางลัดโฟลเดอร์ผ่าน `sp_GetQuickAccessByUser/AddQuickAccess/RemoveQuickAccess` |
| GET | `/dms/org-visibility/me` | ล็อกอิน | ผังหน่วยงานที่ฉันเห็น + ธง `isHidden` |
| GET / PUT | `/dms/org-visibility/me/hidden` | ล็อกอิน | หน่วยงานที่ซ่อน (`EMS.sp_GetHiddenOrgUnitIds/sp_SaveHiddenOrgUnitIds`) |
| GET | `/dms/org-visibility/users/:userId` | Admin | การมองเห็นของผู้ใช้ + รายการ grant |
| PUT / DELETE | `/dms/org-visibility/users/:userId/org-units/:orgUnitId` | Admin | grant / revoke |
| GET / PUT | `/dms/org-visibility/users/:userId/hidden` | Admin | ดู/ตั้งรายการที่ซ่อนของผู้ใช้ |

### Port ที่ module นี้ให้
- `DMS_FILE_PORT` (`DmsFilePortAdapter`) — ฝากไฟล์/อ่านไฟล์แบบตรวจสิทธิ์ของผู้ใช้
- `DMS_FILE_UNCHECKED_PORT` (`DmsFileUncheckedAdapter`) — อ่านไฟล์โดยไม่ตรวจสิทธิ์ผู้ใช้ (ให้ KMS/RGP/approvals ที่ตรวจสิทธิ์ด้วยวิธีของตนเอง)
- ฝั่งที่ **ใช้** (inject แบบ `@Optional()`): `DMS_QUOTA_PORT`, `DMS_APPROVAL_PORT`, `DMS_APPROVAL_HANDLERS` — ลงทะเบียน handler `CREATE_HC`, `DELETE_FOLDER`, `CHANGE_PERMISSION` ใน `onModuleInit`

### งานเบื้องหลัง
`RecycleBinPurgeJob` — `@Cron('0 30 2 * * *')` ลบถาวรโฟลเดอร์ที่ `RecycleBinExpiry` หมด **ปิดเป็นค่าเริ่มต้น** เปิดด้วย SystemConfig `Dms.RecycleBin.AutoPurge = true` (ขนาดชุดต่อรอบ `Dms.RecycleBin.PurgeBatchSize` ค่าเริ่มต้น 20 จำกัด 1–200)

## 2. กฎธุรกิจที่พอร์ตมา (พร้อมไฟล์ที่ทำ)

| กฎ | ไฟล์ |
|---|---|
| Root หลัก 4 ชนิด: 1HC/2SC/3NC/4PC ชื่อขึ้นต้นด้วยรหัสตามชั้นความลับ; 2SC/3NC/4PC มีได้อย่างละ 1 ต่อหน่วยงาน; สร้างได้ใต้ Root หลักเท่านั้น | `rules/folder.rules.ts` (`assertRootCreationAllowed`, `assertUnderMainRoot`) |
| ความลึกไม่เกิน 10 ชั้น · ชื่อต้องห้าม/ซ้ำ (ไม่สนตัวพิมพ์) · ลูกสืบทอดชั้นความลับ + InheritPermission จากแม่ | `rules/folder.rules.ts`, `folders/folders.service.ts` |
| 1HC ต้องผ่านอนุมัติ `CREATE_HC` (ผ่าน port) | `folders/folders.service.ts#create`, `approval-handlers/` |
| โควตาต่อหน่วยงานผ่าน `DMS_QUOTA_PORT` (`enforceQuota` ก่อนสร้าง, `validateBatch` ก่อนอัปโหลดทั้งชุด, `sendAlertIfNeeded` หลังสำเร็จ — แจ้งเตือนล้มไม่ทำให้งานล้ม) | `folders.service.ts`, `files.service.ts` |
| ย้ายโฟลเดอร์ SrOfficer+ · คัดลอกโครงสร้าง/เปลี่ยนชั้นความลับ Manager+ | `folders.service.ts`, `folders.controller.ts` |
| ลบโฟลเดอร์: soft delete ทั้งต้นไม้ผ่าน `sp_SoftDeleteFolder`; มีไฟล์ → 409 `FOLDER_HAS_FILES` → ยื่น `DELETE_FOLDER` | `folders.service.ts`, `approval-handlers/` |
| ถังขยะ 30 วัน: กู้คืนที่แม่เดิม/แม่ใหม่ (ตรวจชื่อซ้ำ, Root ซ้ำชั้น, ความลึก, ไม่ย้ายเข้าลูกหลานตัวเอง) · ลบถาวร Manager+ | `recycle-bin/recycle-bin.service.ts` |
| ชนิดไฟล์ `.pdf .doc .docx .xls .xlsx .ppt .pptx .jpg .png .gif .zip` · ≤100 MB · `copy(N)` (อัลกอริทึมเดิม ไม่สนตัวพิมพ์) · overwrite = Version+1 แล้ว soft-delete แถวเก่าหลังแถวใหม่บันทึกสำเร็จ | `rules/file.rules.ts`, `files/files.service.ts` |
| เก็บไฟล์ `<STORAGE_ROOT>/<OrgUnitID>/<FolderID>/<storedName>` · stream เขียน + SHA-256 ระหว่างเขียน · ตรวจขนาดหลังเขียน · ลบไฟล์กายภาพถ้า DB ล้ม · กัน path traversal | `storage/file-storage.service.ts` |
| สิทธิ์ 2 ชั้น (Authority OR ACL) + สิทธิ์ระดับไฟล์ override + ประตูดาวน์โหลด (Manager+ / Authority.CanDownload / FilePermission.CanDownload / ใบอนุมัติ `findApprovedDownload`→`consumeDownload`; ไม่ผ่าน → 403 `DOWNLOAD_APPROVAL_REQUIRED`) | `access/folder-access.ts`, `rules/file-acl.rules.ts`, `files.service.ts` |
| ตั้งสิทธิ์โฟลเดอร์: เพิกถอนแถวเดิม principal+folder+IsDeny เดียวกันแล้ว insert · กระจายสิทธิ์ลงไฟล์ · CHANGE_PERMISSION หลังอนุมัติ | `acl/folder-permissions.service.ts`, `acl/acl.repository.ts` |
| การมองเห็นหน่วยงาน: grant ชัดแจ้งชนะ; ไม่มี grant ตามบทบาท (Admin ทั้งหมด / Manager ตัวเอง+ลูกหลาน / อื่นๆ ตัวเอง) | `rules/org-visibility.rules.ts`, `visibility/` |
| แม่แบบโฟลเดอร์ (CRUD, สร้างจากแม่แบบทั้งต้นไม้ใน transaction เดียว) | `rules/template.rules.ts`, `templates/` |
| CRUD-log ทุก service (`CrudLoggedService`) — operation เช่น `CREATE_FOLDER`, `RESTORE_FOLDER`, `PURGE_FOLDER`, `DOWNLOAD_FILE`, `PROPAGATE_TO_FILES`, `APPLY_TEMPLATE`, `GRANT_VISIBILITY`, `DELETE_PHYSICAL_FILE` | ทุก `*.service.ts` |

## 3. ส่วนที่ต่างจากระบบเดิม / ต้องตัดสินใจ

| # | เรื่อง | ระบบเดิม | API นี้ | เหตุผล / ทางเลือก |
|---|---|---|---|---|
| 1 | ผลข้างเคียงหลังสร้าง/ลบ/ย้าย | ทำแยกกัน ไม่อยู่ใน transaction และกลืน exception | ทำใน transaction (`TransactionRunner`); ไฟล์กายภาพชดเชย (ลบไฟล์ที่เพิ่งเขียนถ้า DB ล้ม; ลบไฟล์จริงหลัง DB commit) | กันข้อมูลครึ่งๆ กลางๆ |
| 2 | ชื่อไฟล์กายภาพ | ใช้ชื่อเดิมของผู้ใช้ → อัปโหลดชื่อเดิมทับไฟล์ที่ soft-delete แล้ว | `<ชื่อปลอดภัย>_<timestamp>_<สุ่ม 6 hex><ext>` ไม่ซ้ำ | กันเขียนทับ/กู้คืนผิดไฟล์ |
| 3 | MIME ของไฟล์ | เชื่อ client | ใช้ตารางจากนามสกุล | กันปลอม `Content-Type` · `VirusScanStatus` คงค่า 0 (ยังไม่มีตัวสแกน) |
| 4 | **ซ่อน/แสดงไฟล์ (`HIDE_FILE/UNHIDE_FILE`)** | ไม่เคยบันทึกถาวร (ซ่อนเฉพาะใน UI) | **ไม่ทำ endpoint** | `storage.FileDocument` ไม่มีคอลัมน์ `IsHidden/HiddenBy/HiddenDate` · เสนอให้ DBA เพิ่มคอลัมน์ผ่านสคริปต์แล้วค่อยทำ |
| 5 | Root 1HC | สร้างตรง + ขออนุมัติ แยกขั้น | `POST /dms/folders` ระดับ 1 ส่ง `CREATE_HC` ผ่าน port (202); handler สร้างจริงเมื่ออนุมัติ ในนามผู้ขอ + ให้ผู้ขออ่านได้ทันที; ไม่มี port → 503 `APPROVAL_SERVICE_UNAVAILABLE` | ไม่ตรวจคำขอ `CREATE_HC` ที่รออยู่ซ้ำชื่อ (ตรวจชื่อซ้ำตอนอนุมัติจริง ล้ม = ย้อนทั้งคำขอ) |
| 6 | `sp_UpdateFolder` | ไม่ปรับ `OrgUnitID`/`FolderSizeBytes` | เขียน SQL ตรงตอนย้าย (ปรับ OrgUnit/ชั้นความลับ/ความลึกทั้งต้นไม้ย่อย) และ refresh `FileCount`/`FolderSizeBytes` ใน transaction | ค่าในคอลัมน์ตรงกับของจริง · สถิติ `GET :id/stats` นับสดอยู่แล้ว |
| 7 | ย้ายโฟลเดอร์ | คำนวณ path ไฟล์ใหม่ผิด | ไม่ย้ายไฟล์กายภาพ (ที่เก็บอิง `OrgUnit/FolderID` ที่ไม่เปลี่ยน ยกเว้นย้ายข้ามหน่วยงาน — ดู #8); Root ย้ายไม่ได้ | หลีกเลี่ยงบั๊กเดิม |
| 8 | ย้ายข้ามหน่วยงาน | — | ไฟล์กายภาพยังอยู่ใต้ `<OrgUnit เดิม>/<FolderID>` ระบบอ่านผ่านตำแหน่งที่คำนวณจาก `FolderID` + ตำแหน่งที่บันทึกใน `PhysicalPath` (ลองทุก candidate) | รองรับทั้งข้อมูลใหม่และข้อมูลที่ migrate มา |
| 9 | ชั้นความลับของโฟลเดอร์ย่อย | ต่างจากแม่ได้ | **ต้องเท่าแม่เสมอ** (`FOLDER_LEVEL_MISMATCH`, แม่แบบที่ระบุชั้นเองต่างจากปลายทาง → `TEMPLATE_LEVEL_MISMATCH`); ระบุชั้นเท่าแม่ → `InheritPermission=false` | ลูกไม่หลุดจากการควบคุมของ Root · เปลี่ยนชั้นผ่าน `PUT :id/confidentiality` (ปรับลูกหลานทั้งหมด + ตรวจชื่อ/Root ซ้ำ) |
| 10 | ลบโฟลเดอร์ | นับไฟล์เฉพาะโฟลเดอร์นั้น | นับไฟล์ทั้งต้นไม้ย่อย; ผู้อนุมัติ `DELETE_FOLDER` = Admin ที่ใช้งานอยู่ ยกเว้นผู้ขอ (ถ้ามี Admin คนเดียวเป็นผู้ขอเองก็ให้ใช้ผู้ขอ) | กันไฟล์หายตามโฟลเดอร์ย่อย |
| 11 | แม่แบบลึกเกิน 10 / ชื่อซ้ำ | ข้ามรายการเงียบๆ ได้โครงสร้างไม่ครบ | **ปฏิเสธทั้งชุด** (`FOLDER_DEPTH_EXCEEDED`, `TEMPLATE_DUPLICATE_NAMES`) ไม่สร้างอะไรเลย | สร้างทั้งหมดหรือไม่สร้าง |
| 12 | ดาวน์โหลด | อ่านไฟล์เข้าหน่วยความจำทั้งก้อน | stream + tap SHA-256 ระหว่างส่ง; checksum ไม่ตรง → log `FILE_INTEGRITY_FAILURE` · ใช้ใบอนุมัติตอนเปิดไฟล์ (`consumeDownload` ครั้งเดียว) · `DOWNLOAD_FILE` ลง CRUD-log (EXECUTE) | ไม่กินหน่วยความจำ |
| 13 | ประตูอ่านของ port | — | `DMS_FILE_PORT.openRead` ตรวจประตูดาวน์โหลดเต็ม · `DMS_FILE_UNCHECKED_PORT` ข้ามสิทธิ์ผู้ใช้ (ผู้เรียกรับผิดชอบสิทธิ์เอง) | ตาม contract ใน `src/modules/dms/ports/` |
| 14 | สิทธิ์ระดับไฟล์ | — | แถว `FilePermission` ที่ active เป็นตัวตัดสินของไฟล์นั้น (override สิทธิ์โฟลเดอร์; Deny ชนะ) · การกระจายสิทธิ์ลงไฟล์เพิกถอนสิทธิ์ตรงเดิมของไฟล์ก่อน (พฤติกรรมเดิม) และคัดลอก `CanDownload = 0` | ตรงกับ `FolderPermissionService` เดิม |
| 15 | เปลี่ยนชื่อไฟล์ | เปลี่ยนนามสกุลได้ | ต้องคงนามสกุลเดิม | กันเลี่ยงตรวจชนิดไฟล์ |
| 16 | ย้าย/คัดลอก/กู้คืนไฟล์ที่ชื่อชน | ปฏิเสธบ้าง เขียนทับบ้าง | ตั้งชื่อ `copy(N)` · คัดลอกแบบ replace = Version+1 | ไม่สูญเสียไฟล์ |
| 17 | ลบถาวร | ลบไฟล์จริงก่อน กลืนข้อผิดพลาดทีละขั้น | ลบแถว DB (ใบอนุมัติ → สิทธิ์ → ทางลัด → ไฟล์ → โฟลเดอร์) ใน transaction เดียว **ก่อน** แล้วค่อยลบไฟล์กายภาพ (ล้มบางไฟล์ไม่ย้อน DB — รายงาน `physicalFailed` + CRUD-log) · ถ้ามีบทความ KMS / ไฟล์แนบโครงการ / ลิงก์แชร์ภายนอกอ้างอิง → 409 `FOLDER_IN_USE` | ไม่ทำให้ข้อมูลที่ยังใช้งานกลายเป็นลิงก์เสีย |
| 18 | ไฟล์ในถังขยะ | — | ไฟล์ไม่มีวันหมดอายุของตัวเอง (หมดอายุตามโฟลเดอร์) | ตาราง `FileDocument` ไม่มี `RecycleBinExpiry` |
| 19 | ทางลัด / ซ่อนหน่วยงาน | — | ใช้ SP อย่างเดียว (ตาราง `QuickAccessFolder` และ view `EMS.UserOrgUnitHiddenView` ไม่มี DDL ใน export) | ไม่เดาโครงสร้างตาราง |
| 20 | payload ของ approval handler | ข้อความใน `Remark` | JSON (สร้างโดย `build*Payload`) · อ่านรูปแบบ Remark เดิมได้แบบทนความต่าง (`parseLegacyRemark`); payload เสีย → `APPROVAL_PAYLOAD_INVALID` | handler **โยน error** แทนการกลืน เพื่อให้ module อนุมัติย้อนทั้งคำขอ |

## 4. สิ่งที่ยังไม่ได้ทำ (deferred) และเหตุผล

- **ซ่อน/แสดงไฟล์** (`HIDE_FILE`/`UNHIDE_FILE`) — ดูข้อ 3 #4 (ต้องเพิ่มคอลัมน์ในฐานข้อมูลก่อน)
- **สแกนไวรัส** — `VirusScanStatus` คงค่า 0 (ยังไม่มีบริการสแกน)
- **Archive โฟลเดอร์/ไฟล์** (`IsArchived`) — ไม่อยู่ในขอบเขต; โมเดลอ่านธงนี้และปฏิเสธการใช้เป็นแม่/ปลายทาง แต่ไม่มี endpoint ตั้งค่า
- **ลบถาวรไฟล์เดี่ยว** — ถังขยะลบถาวรเป็นระดับโฟลเดอร์ (ตามระบบเดิม)
- **ย้ายไฟล์กายภาพเมื่อย้ายโฟลเดอร์ข้ามหน่วยงาน** — ไม่ย้าย อ่านตามตำแหน่งที่บันทึกไว้
- **งานลบถาวรหลาย instance** — ลบแบบ idempotent จึงรันซ้อนได้ แต่ควรเปิดเพียง instance เดียว (ไม่มี distributed lock)
- ตรวจคำขอ `CREATE_HC` ที่รออนุมัติซ้ำชื่อ

## 5. ต้องทดสอบกับ SQL Server จริง (เทสต์อัตโนมัติพิสูจน์ไม่ได้)

เทสต์หน่วยใช้ repository ปลอมทั้งหมด จึงยังไม่ได้ยืนยัน:

- **SQL ที่เขียนเอง**: recursive CTE (ต้นไม้ย่อย/path/Root), `INSERT … ; SELECT @@ROWCOUNT`, hint `UPDLOCK, HOLDLOCK` ใน `findActiveByName` (กันอัปโหลดชื่อซ้ำพร้อมกัน), `UPDATE … CROSS APPLY` ที่ปรับ counter, ลบรายการแม่แบบแบบ recursive, ลบถาวรเป็นชุดละ ≤900 พารามิเตอร์
- **Stored procedure**: `sp_InsertFolder`, `sp_SoftDeleteFolder`, `sp_RestoreFolder`, `sp_InsertFileDocument`, `sp_GetHiddenOrgUnitIds`, `sp_SaveHiddenOrgUnitIds` (รูปแบบ XML `<ids><id>n</id></ids>`), `sp_GetQuickAccessByUser/AddQuickAccess/RemoveQuickAccess`, `sp_GetOrgUnitHierarchy`
- **ชนิดข้อมูล**: `FolderSizeBytes`/`FileSizeBytes` เป็น bigint → mssql คืนเป็น string (แปลงเป็น `string` ใน DTO) · ตรวจว่าไม่มีส่วนใดแปลงเป็น number แล้วเสียความละเอียด
- **ตารางที่อ่านโดยไม่มี DDL ใน export**: `storage.t_project_attachment`, `storage.ExternalShare`, `KMS.t_KBArticleAttachment` (ใช้ตรวจ blocker ของการลบถาวร), `storage.QuickAccessFolder`, `EMS.UserOrgUnitHiddenView` — ตรวจชื่อคอลัมน์จริง
- **FK ตอนลบถาวร**: ลำดับลบ ใบอนุมัติ → สิทธิ์ → ทางลัด → ไฟล์ → โฟลเดอร์ ครบทุกตารางที่อ้างอิงจริงหรือไม่
- **อัปโหลด multipart จริง**: ชื่อไฟล์ภาษาไทย (`defParamCharset: 'utf8'`), ไฟล์ใหญ่ ~100 MB (ไม่กิน memory), ยกเลิกกลางทาง (ไฟล์ `.uploading` ไม่ค้าง), หลายไฟล์พร้อมกัน, ไฟล์ซ้ำชื่อพร้อมกัน 2 คำขอ
- **ดาวน์โหลด**: ไฟล์ที่ `PhysicalPath` เป็น Windows/UNC จากระบบเดิม (ระบบอ่านจาก 3 ส่วนท้ายและตำแหน่งที่คำนวณใหม่) · ปิด connection กลางทาง · checksum ไม่ตรง
- **`NetworkDrivePath`** ใน SystemConfig (ใช้เป็น prefix ของ `PhysicalPath` ที่บันทึก) กับ `STORAGE_ROOT` บนเครื่องจริง · สิทธิ์เขียนของบัญชีที่รันบริการ
- **Cron** `RecycleBinPurgeJob` ตั้งเวลา/ปิดเปิดด้วย SystemConfig จริง · พฤติกรรมเมื่อรันหลาย instance
- **การเชื่อมกับ module อนุมัติ/โควตา**: เมื่อ `DmsApprovalsModule` provide `DMS_APPROVAL_PORT` / `DMS_QUOTA_PORT` / `DMS_APPROVAL_HANDLERS` ครบ ให้ทดสอบเส้นทาง 1HC → อนุมัติ → โฟลเดอร์ถูกสร้าง, ลบโฟลเดอร์ที่มีไฟล์ → อนุมัติ → ถังขยะ, ขอดาวน์โหลด → อนุมัติ → ดาวน์โหลดได้ครั้งเดียว

## 6. ขอแก้ core (ถ้ามี)

1. **ให้ `ApprovalOutcomeHandler.onApproved` ส่ง `scope?: TransactionScope` เป็นพารามิเตอร์ที่ 3** (`src/modules/dms/ports/dms-approval.port.ts`) — สัญญาปัจจุบัน `onApproved(request, approver)` รับประกันว่า "รันใน transaction เดียวกับการเปลี่ยนสถานะคำขอ" แต่ handler ไม่มีทางรู้ว่า transaction ไหน จึงต้องเปิด transaction ของตัวเอง (ผลข้างเคียงและการอนุมัติ commit แยกกัน → ถ้า commit ของคำขอล้มหลังผลข้างเคียงสำเร็จจะเหลือโฟลเดอร์ที่ไม่มีคำขอรองรับ) · handler ของ DMS core รองรับพารามิเตอร์ที่ 3 ไว้แล้ว (ถ้าไม่ส่งมาก็เปิด transaction เอง) จึงแก้ฝั่ง port/approvals ได้โดยไม่ต้องแก้ฝั่งนี้
2. (ไม่บังคับ) เพิ่มคอลัมน์ `IsHidden BIT`, `HiddenBy INT NULL`, `HiddenDate DATETIME NULL` ใน `storage.FileDocument` ถ้าต้องการฟีเจอร์ซ่อนไฟล์ — ทำผ่านสคริปต์ของ DBA (นอกขอบเขต `src/database/**` ที่ codegen สร้าง)
