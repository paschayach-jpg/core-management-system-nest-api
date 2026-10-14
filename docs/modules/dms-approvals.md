# DMS Approvals — สรุปการพัฒนา

งานอนุมัติ (approval workflow), การแชร์ไฟล์/โฟลเดอร์ (ภายใน/ภายนอก + ลิงก์สาธารณะ), โควตาพื้นที่ และ config ระดับสิทธิ์ตามชั้นความลับ ของ DMS
โค้ดอยู่ที่ `src/modules/dms/approvals/**` · เทสต์ `test/unit/dms-approvals/**` · prefix ของทุก endpoint คือ `/api/v1/dms/...`

`DmsApprovalsModule` เป็น `@Global()` และ export 3 token ให้ `DmsCoreModule` ฉีดโดยไม่ต้อง import module นี้:
`DMS_APPROVAL_PORT` (ยื่นคำขอ/ขอดาวน์โหลด/ใช้สิทธิ์ดาวน์โหลด), `DMS_APPROVAL_HANDLERS` (Core ลงทะเบียนผลหลังอนุมัติ), `DMS_QUOTA_PORT` (Core ตรวจโควตา)
การเปิดไฟล์จริงของลิงก์สาธารณะใช้ `DMS_FILE_UNCHECKED_PORT` แบบ `@Optional()` — ถ้า Core ยังไม่มี port นี้ endpoint ดาวน์โหลดตอบ 503 `DMS_UNAVAILABLE`

## 1. Endpoint ที่ให้บริการ

รวม 49 endpoint: approvals 14 · shares 14 · public 2 · quota 10 · authority 9
คำว่า "ทุก role" = ต้อง login แต่ไม่จำกัดระดับ · Manager = AppRole ≥ 3 · Admin = AppRole 4

### 1.1 งานอนุมัติ — `/dms/approvals`

| Method | Path | สิทธิ์ | คำอธิบาย / อ้างอิง use case เดิม |
|---|---|---|---|
| GET | `/dms/approvals/pending` | ทุก role | คำขอที่รอฉันอนุมัติ (แบ่งหน้า) — มี step ของฉัน; Admin เห็น CREATE_HC ทั้งหมด; Manager/Admin เห็น DELETE_FOLDER ที่ค้าง (ApprovalInboxForm) |
| GET | `/dms/approvals/mine` | ทุก role | คำขอที่ฉันยื่น กรองตามสถานะได้ |
| GET | `/dms/approvals/by-folder/:folderId` | ทุก role + สิทธิ์ Read บนโฟลเดอร์ | คำขอทุกสถานะที่ผูกกับโฟลเดอร์ |
| POST | `/dms/approvals/download-requests` | ทุก role | ขออนุมัติดาวน์โหลดไฟล์ (SubmitDownloadRequest) ต้องมีเหตุผลและผู้อนุมัติ |
| GET | `/dms/approvals/download-requests/approved?fileId=` | ทุก role | มีคำขอดาวน์โหลดที่อนุมัติแล้วและยังไม่ใช้สิทธิ์หรือไม่ |
| POST | `/dms/approvals/download-requests/:id/consume` | ผู้ขอเท่านั้น | ใช้สิทธิ์ดาวน์โหลด (ใช้ได้ครั้งเดียว → RequestStatus 5) |
| POST | `/dms/approvals` | Manager+ | ยื่นคำขอเปลี่ยนสิทธิ์โฟลเดอร์ HC/SC พร้อมผู้อนุมัติเรียงลำดับ (SubmitPermissionRequest) |
| POST | `/dms/approvals/:id/withdraw` | ผู้ขอ | ถอนคำขอที่ยัง Pending (WithdrawRequest) |
| POST | `/dms/approvals/steps/:stepId/approve` | Manager+ และเป็นเจ้าของ step | อนุมัติ step (ApproveStep) |
| POST | `/dms/approvals/steps/:stepId/reject` | Manager+ และเป็นเจ้าของ step | ปฏิเสธ step |
| POST | `/dms/approvals/:id/approve` | Manager+ | อนุมัติทั้งคำขอ (ระบบเลือก step ที่ผู้เรียกลงมติได้ — ใช้กับ batch ใน ApprovalInboxForm) |
| POST | `/dms/approvals/:id/reject` | Manager+ | ปฏิเสธทั้งคำขอ |
| GET | `/dms/approvals/:id` | ผู้ขอ / ผู้อนุมัติใน step / Manager+ | รายละเอียดคำขอ |
| GET | `/dms/approvals/:id/steps` | เหมือนข้างบน | step ทั้งหมดของคำขอ |

### 1.2 การแชร์ — `/dms/shares`

| Method | Path | สิทธิ์ | คำอธิบาย / อ้างอิง use case เดิม |
|---|---|---|---|
| POST | `/dms/shares/internal` | ทุก role (ผู้แชร์ต้องเห็นไฟล์ได้) | แชร์ไฟล์ภายใน (CreateInternalShare) — ผู้แชร์ AppRole < 3 หรือแชร์ให้แผนก ต้องผ่านอนุมัติ |
| POST | `/dms/shares/internal/folders` | ทุก role | ขอแชร์สิทธิ์โฟลเดอร์ให้ผู้อื่น → คำขอ CHANGE_PERMISSION (RequestFolderShareApproval) |
| GET | `/dms/shares/internal/mine` | ทุก role | แชร์ภายในที่ฉันเป็นผู้ให้ |
| GET | `/dms/shares/internal` | Admin | แชร์ภายในทั้งหมด |
| DELETE | `/dms/shares/internal/:id` | ผู้ให้สิทธิ์ / Admin | ยกเลิกแชร์ภายใน |
| POST | `/dms/shares/external` | ทุก role | สร้างลิงก์แชร์ภายนอก (ไฟล์หรือโฟลเดอร์) เป็น Pending + token + คำขอ EXTERNAL_SHARE ใน transaction เดียว |
| GET | `/dms/shares/external/mine` | ทุก role | ลิงก์ของฉัน |
| GET | `/dms/shares/external` | Admin | ลิงก์ทั้งหมด |
| GET | `/dms/shares/external/:id` | เจ้าของ / Manager+ | รายละเอียด — token เห็นได้เฉพาะเจ้าของ |
| POST | `/dms/shares/external/:id/approve` | Manager+ (ผู้แชร์อนุมัติของตัวเองไม่ได้ ยกเว้น Admin) | อนุมัติ → Active (ApproveExternalShare) |
| POST | `/dms/shares/external/:id/reject` | Manager+ | ปฏิเสธ → Revoked |
| POST | `/dms/shares/external/:id/revoke` | เจ้าของ / Admin | ยกเลิกถาวร (ถ้ายัง Pending ปิดคำขอที่ค้างด้วย) |
| POST | `/dms/shares/external/:id/toggle` | เจ้าของ / Admin | เปิด/ปิดชั่วคราว (Active ↔ Disabled) |
| GET | `/dms/shares/external/:id/access-log` | เจ้าของ / Admin | log การเข้าถึงลิงก์ (แบ่งหน้า) |

### 1.3 ลิงก์สาธารณะ (ไม่ต้อง login) — `/dms/public/shares`

เป็น endpoint เดียวในงานนี้ที่ติด `@Public()` เพราะผู้รับลิงก์ภายนอกไม่มีบัญชี · จำกัด 10 ครั้ง/นาที/IP (`@Throttle`) · `Cache-Control: no-store`
ทั้งสองตัวติด `@ApiOperation({ security: [{}] })` ทำให้ e2e OpenAPI ที่ตรวจ "endpoint ที่ไม่ต้อง auth" ผ่านโดยไม่ต้องแก้รายการกลาง

| Method | Path เต็ม | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| POST | `/api/v1/dms/public/shares/{token}/open` | Public | ดูข้อมูลลิงก์ (ชื่อไฟล์/รายการไฟล์ของโฟลเดอร์) — ไม่นับเป็นการดาวน์โหลด |
| POST | `/api/v1/dms/public/shares/{token}/download` | Public | ดาวน์โหลด (นับจำนวนครั้งแบบ atomic; ลิงก์โฟลเดอร์ระบุ `fileId`) — ส่ง stream พร้อม `Content-Disposition` รองรับชื่อไทย |

รหัสผ่านของลิงก์ (ถ้ามี) ส่งใน body ของ POST ไม่ใส่ใน URL · ตอบ 403 ข้อความเดียวกันทุกกรณีที่ปฏิเสธ (ดูข้อ 3.14)

### 1.4 โควตา — `/dms/quota`

endpoint เดียวครอบ 3 ตารางหลัก (SubCommittee / Division / Department) แยกด้วย `unitType` ใน path (ดูข้อ 3.11)

| Method | Path | สิทธิ์ | คำอธิบาย / อ้างอิง use case เดิม |
|---|---|---|---|
| GET | `/dms/quota` | Manager+ | โควตาและการใช้พื้นที่ทุกหน่วยงาน พร้อมระดับ Normal/Warning/Critical/Full |
| GET | `/dms/quota/org-units/:orgUnitId/usage` | ทุก role | การใช้พื้นที่ของ EMS.OrgUnit ตามที่ใช้บังคับตอนสร้างโฟลเดอร์/อัปโหลด |
| POST | `/dms/quota/requests` | ทุก role | ยื่นคำขอเพิ่มโควตา (ต้องมากกว่าปัจจุบัน + เหตุผล) |
| GET | `/dms/quota/requests/mine` | ทุก role | คำขอของฉัน |
| GET | `/dms/quota/requests` | Manager+ | คำขอทั้งหมด (กรองสถานะ) |
| POST | `/dms/quota/requests/:id/approve` | Admin | อนุมัติ → ตั้งโควตาใหม่ใน transaction เดียว |
| POST | `/dms/quota/requests/:id/reject` | Admin | ปฏิเสธ |
| POST | `/dms/quota/requests/:id/cancel` | ผู้ขอ | ยกเลิกคำขอของตน |
| PUT | `/dms/quota/:unitType/:unitId` | Admin | ตั้งโควตา (ขนาดเป็นสตริงตัวเลข ไม่เกิน 15 หลัก — กัน bigint เสียความแม่น) |
| DELETE | `/dms/quota/:unitType/:unitId` | Admin | ล้างโควตา (ไม่จำกัด) |

### 1.5 ระดับสิทธิ์ตามชั้นความลับ (FolderAuthorityConfig) — `/dms/authority`

ทั้ง controller เป็น Admin

| Method | Path | คำอธิบาย / อ้างอิง use case เดิม |
|---|---|---|
| GET | `/dms/authority/configs` | รายการ config (แบ่งหน้า กรองได้) — เรียกผ่าน SP |
| GET | `/dms/authority/configs/:id` | config รายแถว |
| POST | `/dms/authority/configs` | สร้างกลุ่ม config (4 ชั้นความลับในคำขอเดียว) |
| PUT | `/dms/authority/configs/:id` | แก้ไข |
| DELETE | `/dms/authority/groups?label=` | ลบทั้งกลุ่ม (soft delete ทุกชั้นของ ConfigLabel เดียวกัน) |
| GET | `/dms/authority/resolve` | พรีวิวผล resolve (`sp_ResolveFolderAuthority`) พร้อมบอกว่าตรงด้วยกฎลำดับไหน (`matchedBy`) |
| GET | `/dms/authority/import/template` | ดาวน์โหลดไฟล์ template .xlsx |
| POST | `/dms/authority/import/preview` | อัปโหลด .xlsx (multipart ≤ 5MB) แล้วดูผลก่อนบันทึก — ไม่เขียน DB |
| POST | `/dms/authority/import/commit` | บันทึกผลนำเข้าทั้งก้อนใน transaction เดียว |

## 2. กฎธุรกิจที่พอร์ตมา (พร้อมไฟล์ที่ทำ)

โครงสร้าง: แยก `*.store.ts` (SQL/SP ล้วน) ออกจาก `*.service.ts` (กฎธุรกิจ) และเก็บกฎที่ไม่แตะ DB ไว้เป็นฟังก์ชันล้วนใน `common/` เพื่อให้ unit test ครอบกฎได้ด้วย fake in-memory + transaction จำลองที่ rollback จริง
ทุก service สืบทอด `CrudLoggedService` และทุก mutation ผ่าน `this.logged(...)`

**งานอนุมัติ** — `approvals/approvals.service.ts`, `approvals.store.ts`, `common/approval-flow.ts`, `common/approval-remark.ts`
- ชนิดคำขอ 8 ชนิดตาม CHECK ใน DB; อายุคำขอ: สิทธิ์ 1 วัน, ลบโฟลเดอร์ 7, ดาวน์โหลด 3, แชร์ 7 (`common/approval.constants.ts`)
- ผู้อนุมัติตั้งต้นเมื่อไม่ระบุ: CREATE_HC / DELETE_FOLDER → Admin (ตัดผู้ขอ; ถ้าไม่เหลือใช้ Admin ทั้งหมด), ชนิดอื่น → Manager ที่ไม่ใช่ผู้ขอ, ไม่มีเลย → Admin; ผู้อนุมัติที่เลือกเองต้องเป็นผู้ใช้ active ระดับ Manager+
- ลำดับ step: เรียงตาม StepOrder; อนุมัติ step ปัจจุบันแล้วไป step ถัดไป; CREATE_HC และกลุ่มที่ถูก escalate จบที่การอนุมัติคนแรก และปิด step ที่ค้างที่เหลืออัตโนมัติ (`decideAfterApprove`)
- ลงมติ + ผลข้างเคียงตามชนิดคำขอ ทำใน transaction เดียว โดยล็อกแถวคำขอก่อน (`UPDLOCK, ROWLOCK`) แล้วค่อยล็อกแถวแชร์ (ลำดับเดียวกันทุกที่ กัน deadlock)
- ผลข้างเคียง: EXTERNAL_SHARE → เปิดใช้ลิงก์ (`share-approval-outcomes.ts`), INTERNAL_SHARE → ให้สิทธิ์ระดับไฟล์; CREATE_HC / DELETE_FOLDER / CHANGE_PERMISSION → เรียก handler ที่ Core ลงทะเบียน (`approval-handler.registry.ts`) โดย**ส่ง `TransactionScope` ของ transaction ที่เปิดอยู่เป็นพารามิเตอร์ตัวที่ 3 เสมอ** (`onApproved(request, approver, scope)` / `onRejected(request, rejector, scope)`) เพื่อให้ผลข้างเคียงของ Core อยู่ใน transaction เดียวกับการเปลี่ยนสถานะคำขอ; ถ้าชนิดที่ Core ต้องจัดการยังไม่มี handler → 503 `APPROVAL_HANDLER_MISSING` และไม่เปลี่ยนสถานะ
- แจ้งเตือนผ่าน `NotificationsService` เก็บใน outbox แล้วส่งหลัง commit เท่านั้น (ตัวส่งกลืน error เอง ถ้าส่งก่อน commit แล้ว rollback จะมีแจ้งเตือนผิด)
- คำขอดาวน์โหลด: ยื่น → อนุมัติ → ค้นหา (`approved`) → ใช้สิทธิ์ครั้งเดียว (UPDATE เงื่อนไข RequestStatus=2 → 5 ในคำสั่งเดียว กันใช้ซ้ำพร้อมกัน)
- ยกระดับคำขอเกินเวลา: `approval-escalation.job.ts` (`@Cron` ทุก 10 วินาที + ช่วงเวลาจริงจาก `SystemConfig.EscalationTimerIntervalSeconds` ค่าเริ่มต้น 60) กันซ้ำ 2 ชั้น: flag ในโปรเซส + `sp_getapplock`
- Remark: payload ใหม่เป็น JSON ขึ้นต้น `CMS-PAYLOAD/1:` อ่านรูปแบบเก่าได้ (`ExternalShareID:<n>`, `InternalShareFile…`, ข้อความสิทธิ์แบบเดิม)

**แชร์** — `shares/shares.service.ts`, `shares.store.ts`, `public-share-access.service.ts`, `common/share-rules.ts`, `common/share-crypto.ts`
- แชร์ภายใน: วันหมดอายุห้ามย้อนหลังและไม่เกิน 1 ปี (ไม่ระบุ = ไม่หมดอายุ); principal ได้เฉพาะ 1–4 (User/Role/Department/Division) ตาม CHECK ของ `FolderPermission`
- แชร์ภายนอก: ห้ามไฟล์/โฟลเดอร์ชั้น HC, วันหมดอายุไม่เกิน 90 วัน, จำกัดจำนวนดาวน์โหลด (จำนวนเต็ม > 0), รหัสผ่านเก็บเป็น PBKDF2-SHA1 รูปแบบเดียวกับ `Rfc2898DeriveBytes` ของ .NET, token สุ่ม 128 บิตรูปแบบ GUID ตัวพิมพ์เล็ก
- สถานะแชร์ภายนอก: Pending / Active / Disabled / Expired / Revoked; `effectiveShareStatus` คำนวณ Expired จากวันหมดอายุตอนอ่าน และ `markExpired` เขียนกลับตอนมีการเข้าถึง
- ลิงก์สาธารณะ: `evaluateShareAccess` ตรวจสถานะ → วันหมดอายุ → รหัสผ่าน → จำนวนครั้ง; เหตุผลจริงบันทึกลง `storage.ShareAccessLog` แต่ผู้เรียกเห็นข้อความเดียวกันหมด

**โควตา** — `quota/quota.service.ts`, `quota.store.ts`, `common/quota-rules.ts`
- ระดับ Normal/Warning/Critical/Full ที่ 80% / 95% / 100% (ปรับเกณฑ์ได้ผ่าน SystemConfig — ดูข้อ 3.12)
- `enforceQuota` / `validateBatch` (ทั้งชุดล้มถ้าเกิน) / `sendAlertIfNeeded` (ไม่โยน error) ผ่าน `DmsQuotaPortProvider` (`dms-quota-port.provider.ts`)
- คำขอเพิ่มโควตา: ต้องมากกว่าค่าปัจจุบัน + เหตุผล; อนุมัติ = ตั้งโควตา + ปิดคำขอใน transaction เดียว; ถ้าหน่วยงานถูกลบไปแล้ว → `QUOTA_UNIT_NOT_FOUND` และ rollback

**ระดับสิทธิ์** — `authority/authority.service.ts`, `authority-import.service.ts`, `authority-excel.ts`, `authority-rules.ts`
- ชั้นความลับ 1HC / 2SC / 3NC / 4PC × สิทธิ์ ดู/เพิ่ม/แก้ไข/อนุมัติ; resolve ตามลำดับ Level+แผนก → Level → ตำแหน่ง → แผนก → ฝ่าย (หยุดที่ระดับแรกที่พบ — เป็นกฎของ `sp_ResolveFolderAuthority`)
- Excel: หาแถวหัว "รหัสพนักงาน" ใน 20 แถวแรก (มีแถวชื่อเรื่องข้างบนได้), ค่าในช่องสิทธิ์ต้องเป็น X, เตือนเมื่อรหัสพนักงานเป็นตัวเลข (เลข 0 นำหน้าหาย); `preview` ไม่เขียน DB, `commit` เขียนทั้งก้อนใน transaction เดียว

## 3. ส่วนที่ต่างจากระบบเดิม / ต้องตัดสินใจ

| # | เรื่อง | ระบบเดิม | API นี้ | เหตุผล / ทางเลือก |
|---|---|---|---|---|
| 1 | ผลข้างเคียงหลังอนุมัติล้มเหลว | กลืน error (try/catch) แล้วตั้งคำขอเป็น Approved ต่อ → คำขออนุมัติแต่ไม่มีผลจริง | ลงมติ + ผลข้างเคียงใน transaction เดียว ล้มแล้ว rollback ทั้งก้อน ตอบ `APPROVAL_SIDE_EFFECT_FAILED` | ป้องกันข้อมูลไม่ตรงกัน; อ่าน Remark ไม่ได้ก็ไม่อนุมัติ (`APPROVAL_PAYLOAD_INVALID`) |
| 2 | ใครลงมติได้ | UI เป็นตัวกรอง; service ไม่ตรวจว่าเป็นเจ้าของ step | ต้องเป็นเจ้าของ step หรือผู้รับมอบ; ข้อยกเว้นเฉพาะที่ UI เดิมยอม: Admin กับ CREATE_HC, Manager+ กับ DELETE_FOLDER | ปิดช่องที่ใครเรียก API ตรงก็อนุมัติแทนคนอื่นได้ |
| 3 | อายุลิงก์แชร์ภายนอกที่ไม่ระบุวันหมดอายุ | ไม่หมดอายุ; ไม่ตรวจวันหมดอายุที่อยู่ในอดีต | ไม่ระบุ = 90 วัน; อดีต = ปฏิเสธ (`SHARE_EXPIRY_IN_PAST`); เกิน 90 วัน = ปฏิเสธ | ลิงก์สาธารณะไม่ควรอยู่ตลอดไป — ถ้าธุรกิจต้องการไม่หมดอายุ แก้ที่ `resolveExternalShareExpiry` จุดเดียว |
| 4 | รูปแบบ Remark | ข้อความเฉพาะกิจ (`ExternalShareID:<n>` ฯลฯ) | เขียนเป็น JSON `CMS-PAYLOAD/1:{...}`; อ่านรูปแบบเก่าได้ (มี 40 คำขอเดิมในฐาน) | **ระบบ WinForms เดิมอ่านรูปแบบ JSON ไม่ได้** ระหว่างใช้ร่วมกัน คำขอที่ยื่นผ่าน API แล้วไปอนุมัติจาก WinForms จะ parse Remark ไม่ออก (ดูข้อ 7.2) |
| 5 | ตรวจสิทธิ์ตอนแชร์ภายนอกแบบไฟล์ | ส่ง `FileID` เข้าไปเป็น `folderId` ใน CheckPermission (ตรวจผิดโฟลเดอร์) | ตรวจที่โฟลเดอร์ของไฟล์ | บั๊กเดิม (OPEN_QUESTIONS C4) |
| 6 | Escalation | ใส่เลข role (3/4) ลงใน `ApproverID` ซึ่งเป็น FK ไป `UserAccount.UserID`; ยกซ้ำทุกรอบของ timer และ timer รันทุกเครื่อง | สร้าง step ใหม่ให้ผู้ใช้จริงของ role ปลายทาง (เดิมเป็น Manager+ → Admin, ต่ำกว่า → Manager) แล้ว**เลื่อน `ExpiryDate` ออกไป 1 วัน** (`ESCALATION_EXTENSION_DAYS`) กัน cron ยกคำขอเดิมซ้ำ; step เดิมตั้งเป็น 4 + `EscalatedDate`; รันที่ฝั่ง API ตัวเดียวพร้อม applock | OPEN_QUESTIONS C1; ถ้าต้องการเลื่อนไม่เท่า 1 วัน/ไม่เลื่อน แก้ค่าคงที่เดียว — แต่ถ้าไม่เลื่อน คำขอเดิมจะถูกยกซ้ำทุกรอบ |
| 7 | Withdraw และสถานะ 4 | Withdraw ใช้ RequestStatus 4 (Expired) ซ้อนกับ "หมดอายุ"; Step 4 = Delegated ซ้อนกับ "ยกระดับ/ปิดอัตโนมัติ" | คง 4 ตามเดิม ไม่เปลี่ยนความหมาย | WinForms ยังใช้ร่วม — เปลี่ยนความหมายจะทำให้หน้าจอเดิมแสดงผิด (OPEN_QUESTIONS C5; ดูข้อ 7.4) |
| 8 | RequestStatus = 5 | `ConsumeDownloadApproval` เขียน 5 แต่ enum กลางไม่มีค่านี้ | ใช้ค่าคงที่ `REQUEST_STATUS_CONSUMED = 5` ใน `approval.constants.ts` (ความหมาย "ใช้สิทธิ์ดาวน์โหลดแล้ว") | ตอบ OPEN_QUESTIONS A5; ขอเพิ่มใน enum กลางถ้าต้องการ (ข้อ 6) |
| 9 | อายุของคำขอดาวน์โหลดที่อนุมัติแล้ว | ไม่หมดอายุ — อนุมัติแล้วใช้เมื่อไรก็ได้ (ครั้งเดียว) | คงเดิม | ถ้าต้องการให้หมดอายุหลังอนุมัติ เป็นการตัดสินใจทางธุรกิจ (ข้อ 7.3) |
| 10 | อนุมัติผ่านหน้าจัดการแชร์ | อนุมัติแชร์แล้ว คำขอ/step ใน ApprovalRequest ค้าง Pending → โผล่ในกล่องงานตลอด | ปิดคำขอและ step ที่ค้างพร้อมกันใน transaction เดียว (`closeRequestForShare`); revoke ตอนยัง Pending ก็ปิดคำขอด้วย | กัน inbox มีงานผี |
| 11 | โควตา: ตารางและ ID | 3 ตารางหลักแยกกัน ID ซ้ำข้ามตารางได้ → ใช้ ID เดียวระบุหน่วยงานไม่ได้ | endpoint เดียว `/dms/quota` ระบุด้วย `unitType` + `unitId` เสมอ; "การใช้พื้นที่" มี 2 นิยาม: (ก) ตอน enforce ใช้ CTE ลำดับชั้นของ OrgUnit เหมือน `FolderQuotaService`, (ข) หน้ารายการ rollup ขนาดไฟล์ตามหน่วยงาน — 2 ตัวเลขนี้อาจต่างกันเล็กน้อยได้ | นิยามเดิมก็เป็นสองแบบอยู่แล้ว ไม่รวมเพื่อไม่เปลี่ยนพฤติกรรมการบังคับโควตา (ข้อ 7.6) |
| 12 | เกณฑ์ Warning/Critical ของโควตา | ค่าคงที่ในโค้ด 80/95 | อ่านจาก `SystemConfig` key `DmsQuotaWarnThresholdPct` / `DmsQuotaCriticalThresholdPct` ถ้าไม่มีหรือค่าไม่สมเหตุสมผลใช้ 80/95 | **key สองตัวนี้ผมตั้งชื่อเอง ยังไม่มีในฐาน** — ไม่ใส่ก็ทำงานเหมือนเดิม (ข้อ 7.5) |
| 13 | นำเข้าสิทธิ์จาก Excel | โค้ดเดิม (ที่ compile ไม่ได้) ไม่ได้เรียก `sp_UpsertUserAuthority` จริง; commit ย้อนเองด้วย undo stack; อัปเดตโดย soft delete + insert แถวใหม่ → ค่า `CanDownload` ของตำแหน่งหาย | อัปเดตแถวเดิมใน transaction เดียว (ไม่ลบ+สร้างใหม่ ค่า `CanDownload` จึงไม่หาย); ไม่เรียก `sp_UpsertUserAuthority` (ตาราง `EMS.UserAuthority` ไม่มี DDL) — ทำสิ่งที่โค้ดเดิมทำจริง คือสิทธิ์ 4 ชั้นของตำแหน่งที่มี config อยู่แล้ว + `UserAccount.LevelCode` | ตามที่โค้ดเดิมทำจริง: ตาราง `EMS.UserAuthority` ไม่มี DDL ในสคริปต์และไม่มีโค้ดอื่นใช้ (ควรให้ DBA ยืนยันว่าไม่มีตารางนี้ในฐานจริง) |
| 14 | ลิงก์สาธารณะ | `AccessShareForm` เป็น dead code ใน WinForms แต่ service มีตรรกะ `ValidateAndGrantAccess` | เปิดเป็น 2 endpoint สาธารณะ (หัวข้อ 1.3); ปฏิเสธทุกกรณีด้วย 403 ข้อความเดียว (token ผิดรูปแบบ/ไม่มี/หมดอายุ/รหัสผ่านผิด/ครบจำนวน/ถูกปิด); รหัสผ่านใน body; นับจำนวนดาวน์โหลดใน UPDATE เดียว (ไม่เกินเพดานแม้โหลดพร้อมกัน); เปิดไฟล์หลังตรวจ token แล้วเท่านั้น | ไม่ให้ผู้โจมตีเดา token / รู้ว่าลิงก์มีอยู่; token ที่ไม่มีในระบบบันทึก log ไม่ได้ (FK) — ถ้าทีมไม่ต้องการลิงก์สาธารณะ ลบ `PublicSharesController` ออกจาก module ได้ทั้งตัว (ข้อ 7.1) |
| 15 | ห้ามแชร์ภายนอกชั้น HC | ตรวจ `FileDocument.ConfidentialityLevel` ซึ่งไม่มีคอลัมน์ใน DB (ค่า 0 เสมอ → ไม่เคยบล็อกระดับไฟล์) | ใช้ระดับของโฟลเดอร์ที่ไฟล์อยู่ | OPEN_QUESTIONS C2 |
| 16 | ลิงก์แชร์แบบโฟลเดอร์ | — | ให้ดาวน์โหลดเฉพาะไฟล์ที่อยู่ในโฟลเดอร์นั้นโดยตรง (active) ไม่ลงโฟลเดอร์ย่อย | เลือกทางที่เปิดน้อยกว่า |
| 17 | ลำดับการอนุมัติหลาย step | เรียงตาม StepOrder ทีละคน (CREATE_HC: คนแรกที่อนุมัติจบ) | คงเดิม ตัดสินใจในฟังก์ชันเดียว `decideAfterApprove` | ถ้าธุรกิจต้องการ "ใครอนุมัติก็ได้" ทุกชนิด แก้จุดเดียว (ข้อ 7.7) |

## 4. สิ่งที่ยังไม่ได้ทำ (deferred) และเหตุผล

- **`sp_UpsertUserAuthority` / `EMS.UserAuthority`** — ไม่ทำ (ดูข้อ 3.13)
- **แชร์โฟลเดอร์แบบรวมโฟลเดอร์ย่อย** — ข้อ 3.16
- **ลบ config ระดับสิทธิ์รายแถว** — ตาราง `FolderAuthorityConfig` ไม่มี PK/unique index จึงลบ/แก้รายแถวให้ปลอดภัยไม่ได้ ทำเป็น "ลบทั้งกลุ่ม" ตาม ConfigLabel
- **อีเมล/SMS ถึงผู้รับลิงก์ภายนอก** — ระบบเดิมไม่มี; API คืน token ให้เจ้าของลิงก์เอาไปส่งเอง
- **การบังคับใช้การ consume คำขอดาวน์โหลดตอนดาวน์โหลดจริง** — อยู่ฝั่ง Core (ต้องเรียก `consumeDownload` ก่อนส่งไฟล์) งานนี้ให้แค่ port
- **ตรวจกับ SQL Server จริง** — ไม่มี DB ในสภาพแวดล้อมนี้ ดูหัวข้อ 5

## 5. ต้องทดสอบกับ SQL Server จริง (เทสต์อัตโนมัติพิสูจน์ไม่ได้)

เทสต์ unit ใช้ fake ของ store + transaction จำลองที่ rollback จริง จึงพิสูจน์กฎธุรกิจและการ rollback ได้ แต่ไม่พิสูจน์ SQL/SP/constraint ต่อไปนี้

1. **SQL ทั้งหมดใน `*.store.ts` รันได้และผลถูกต้อง** — โดยเฉพาะ `OUTPUT ... INTO @table`, `SELECT @@ROWCOUNT`, การแบ่งหน้า (`OFFSET/FETCH`) และ `ORDER BY` ที่ whitelist
2. **ผลของ `manager.query` กับคำสั่งที่ไม่มี result set** — โค้ดสมมติว่าได้ `undefined` จึงใช้ `SELECT @@ROWCOUNT AS Affected` ต่อท้าย; ยืนยันว่าตัวเลขตรง
3. **การล็อก** — `UPDLOCK, ROWLOCK` บนคำขอ → แชร์ ไม่ deadlock เมื่อ approve/reject/withdraw/escalate/revoke ยิงพร้อมกันบนคำขอเดียวกัน; `ApprovalStep` มี UNIQUE (RequestID, StepOrder) และ ~2.2 แสนแถว — ดู plan ของ `pagePendingFor`
4. **Constraint ที่ฐานจริง** — CHECK ของ `ExternalShare` (สถานะ, ไฟล์หรือโฟลเดอร์อย่างใดอย่างหนึ่ง), `ApprovalRequest.RequestStatus` 1–5, 8 RequestType, FK `ShareAccessLog.ExternalShareID`, `FolderPermission.PrincipalType` 1–4
5. **Trigger บนตารางที่เขียน** — ใช้ `OUTPUT INTO @table` กัน trigger แล้ว แต่ต้องยืนยันว่าไม่มี trigger ที่เปลี่ยนค่าที่อ่านกลับ
6. **ดาวน์โหลดพร้อมกันของลิงก์สาธารณะ** — ยิงพร้อมกันเกิน `DownloadLimit` แล้วต้องผ่านไม่เกินเพดาน และ `ShareAccessLog` ไม่ซ้ำ
7. **ใช้สิทธิ์ดาวน์โหลดซ้ำพร้อมกัน** — ยิง `consume` พร้อมกัน 2 ครั้ง ต้องสำเร็จ 1 ครั้ง
8. **`sp_getapplock` ของ escalation** — รัน API 2 instance พร้อมกัน ต้องมีตัวเดียวที่ยกระดับ; ยืนยันว่า lock ถูกปล่อยเมื่อ instance ล้ม
9. **ความเข้ากันของ hash รหัสผ่าน** — สร้างลิงก์ที่มีรหัสผ่านจาก WinForms แล้วเปิดผ่าน API (และกลับกัน) ต้องตรวจผ่าน (PBKDF2-SHA1, ค่า iteration/ขนาด salt ต้องตรงกับที่ `ShareService` เดิมใช้ — ตรวจ `share-crypto.ts` กับข้อมูลจริง)
10. **Remark เก่า 40 คำขอ** — ดึงคำขอเดิมที่มี Remark รูปแบบเก่า แล้วอนุมัติผ่าน API ต้องอ่านได้ครบ
11. **Excel จริงของฝ่ายบุคคล** — นำเข้าไฟล์ matrix จริง เทียบผลกับ WinForms (จำนวนแถว, คำเตือน, ตำแหน่งที่ไม่มี config)
12. **`sp_ResolveFolderAuthority`** — `matchedBy` ที่ API เดาจากแถวแรกต้องตรงกับที่ SP เลือกจริงทั้ง 5 กรณี
13. **โควตา** — เทียบ "การใช้พื้นที่" ของ `/org-units/:id/usage` กับ `FolderQuotaService` เดิมบนหน่วยงานที่มีโฟลเดอร์ซ้อนลึก; ตัวเลข `bigint` ขนาดใหญ่ (> 2^53 ไม่ควรเกิน แต่ DTO จำกัด 15 หลัก)
14. **handler ของ Core ใช้ scope จริง** — อนุมัติ CREATE_HC / DELETE_FOLDER / CHANGE_PERMISSION แล้วให้ handler ล้มกลางคัน ต้อง rollback ทั้งผลของ handler และสถานะคำขอ (เทสต์ unit พิสูจน์ได้เฉพาะฝั่งที่ส่ง scope ให้; ฝั่ง Core ที่ต้องใช้ scope ต้องยืนยันกับ SQL Server จริง) และไม่ค้างล็อก
15. **การแจ้งเตือน** — ผู้อนุมัติและผู้ขอได้รับแจ้งหลัง commit ตามจริง และไม่ได้รับเมื่อ rollback
16. **Performance** — `GET /dms/approvals/pending` และ `by-folder` บนข้อมูลจริง (ตรวจ index)

## 6. ขอแก้ core (ถ้ามี)

1. **สัญญา handler รับ transaction scope** — ฝั่งแกนกลางเพิ่มพารามิเตอร์ตัวที่ 3 แบบ optional ใน `src/modules/dms/ports/dms-approval.port.ts` แล้ว
   (`onApproved(request, approver, scope?: TransactionScope)` และ `onRejected?(request, rejector, scope?)`) ฝั่ง approvals ส่ง `scope` ของ transaction ที่เปิดอยู่ให้ทุกครั้ง
   (`applyApprovedOutcome` / `applyRejectedOutcome` ใน `approvals.service.ts`) และมีเทสต์พิสูจน์ใน `approvals.service.spec.ts` 3 ข้อ: handler ได้ scope ตัวเดียวกับที่ `TransactionRunner` เปิด (ไม่ใช่ของรอบก่อน) ขณะ transaction ยังไม่ commit และเห็นสถานะ Approved ของ transaction เดียวกัน,
   `onRejected` ได้ scope เช่นกัน, handler ที่เขียนผ่าน scope แล้วโยน error → การเขียนของ handler กับสถานะคำขอ rollback พร้อมกัน
   **หมายเหตุ branch นี้:** ผมแก้ไฟล์ port ใน worktree เพียงชั่วคราวให้ compile ได้ และ**ไม่ได้ commit ไฟล์ port** (แกนกลางถือไฟล์นี้) — ตอนรวม branch ให้ใช้ไฟล์ port ของแกนกลาง
   ข้อควรระวังฝั่ง Core: handler ต้องใช้ `scope.manager` / `scope.sp` ที่ได้รับเท่านั้น ถ้าเปิด transaction ใหม่เอง (ไม่ใช้ scope) ผลข้างเคียงจะหลุดจาก transaction เดียวกันและอาจรอล็อกที่ฝั่งอนุมัติถืออยู่ (เช่นแถวโฟลเดอร์/คำขอเดียวกัน)
2. **เพิ่ม `ApprovalRequestStatus.Consumed = 5` ใน `src/common/constants/enums.ts`** — ตอนนี้ใช้ค่าคงที่ใน module (ข้อ 3.8)
3. **Core ต้องเรียก** `DmsApprovalPort.findApprovedDownload` + `consumeDownload` ก่อนส่งไฟล์ที่ต้องขออนุมัติ และเรียก `DmsQuotaPort.enforceQuota` / `validateBatch` / `sendAlertIfNeeded` ตอนสร้างโฟลเดอร์/อัปโหลด
4. **Core ต้องลงทะเบียน handler 3 ชนิด** (CREATE_HC, DELETE_FOLDER, CHANGE_PERMISSION) ใน `DMS_APPROVAL_HANDLERS` ถ้าไม่ลง คำขอชนิดนั้นอนุมัติไม่ได้ (503 `APPROVAL_HANDLER_MISSING`) โดยตั้งใจ ไม่ใช่อนุมัติเงียบ ๆ
5. **ต้องมี provider ของ `DMS_FILE_UNCHECKED_PORT`** ใน Core ลิงก์สาธารณะจึงจะดาวน์โหลดได้จริง
6. ใส่ payload ของ CREATE_HC / CHANGE_PERMISSION ตามชนิดใน `common/approval-payloads.ts` (`CreateHcPayload`, `ChangePermissionPayload`) — Core อ่านได้จาก `request.payload`

## 7. คำถามเปิด (ต้องให้ทีมยืนยัน)

1. **ต้องการลิงก์แชร์สาธารณะจริงหรือไม่** — `AccessShareForm` เดิมเป็น dead code. ผมเปิด `POST /api/v1/dms/public/shares/{token}/open` และ `.../download` เป็น endpoint ที่ไม่ต้อง login (ออกแบบแบบปลอดภัย: ข้อความปฏิเสธเดียว, throttle, token แบบสุ่ม) ถ้าไม่ต้องการ ลบ `PublicSharesController` ออกจาก `DmsApprovalsModule` ได้เลย ส่วนที่เหลือไม่กระทบ หน้า front-end ที่ผู้รับลิงก์เปิดต้องมีเอง (API ไม่สร้างหน้าเว็บ)
2. **WinForms ใช้ร่วมกับ API ในช่วงเปลี่ยนผ่านหรือไม่** — ถ้าใช่ Remark แบบ JSON (`CMS-PAYLOAD/1:`) จะทำให้ WinForms อ่านคำขอที่ยื่นผ่าน API ไม่ออก ทางเลือก: (ก) ให้ API เขียนรูปแบบเก่าด้วยสำหรับชนิดที่มีรูปแบบเดิม, (ข) ปรับ WinForms ให้อ่าน JSON
3. **คำขอดาวน์โหลดที่อนุมัติแล้วควรหมดอายุหรือไม่** (เดิมไม่หมดอายุ) และใช้ได้กี่ครั้ง (เดิมครั้งเดียว)
4. **สถานะถอนคำขอ** — OPEN_QUESTIONS C5 เสนอให้ Withdraw ใช้ 5=Cancelled แต่ 5 ถูก `ConsumeDownloadApproval` ใช้เป็น "ใช้สิทธิ์แล้ว" อยู่ ถ้าจะแยก ต้องเพิ่มค่าใหม่และแก้ CHECK constraint (เป็นงาน DBA) ตอนนี้คง 4 ตามเดิม
5. **key `DmsQuotaWarnThresholdPct` / `DmsQuotaCriticalThresholdPct`** — ชื่อที่ผมตั้งเอง ต้องการให้เพิ่มลง `SystemConfig` หรือไม่ หรือคงค่าคงที่ 80/95
6. **นิยาม "การใช้พื้นที่" ของโควตา** — ใช้ 2 นิยามอยู่ (ข้อ 3.11) ต้องการให้รวมเป็นนิยามเดียวหรือไม่ และเป็นนิยามไหน
7. **ความหมายของหลาย step** — ปัจจุบันเรียงลำดับทีละคน (ยกเว้น CREATE_HC) ธุรกิจต้องการ "ผู้อนุมัติคนไหนก็ได้" หรือ "ต้องครบทุกคน" สำหรับชนิดอื่นหรือไม่
8. **แชร์โฟลเดอร์ต้องรวมโฟลเดอร์ย่อยหรือไม่** (ตอนนี้เฉพาะไฟล์โดยตรง)
9. **นโยบายอายุลิงก์ภายนอก 90 วัน** (ข้อ 3.3) และแชร์ภายใน 1 ปี ตรงกับนโยบายองค์กรหรือไม่
