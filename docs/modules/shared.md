# Shared + Auth — สรุปการพัฒนา

module `auth` (ยืนยันตัวตน) และ `shared` (สิ่งที่ DMS/KMS/RGP/WFE ใช้ร่วมกัน) · ผู้พัฒนา: แกนกลางของโครงการ · เอกสาร endpoint ฉบับเต็ม: `/docs` (Swagger) หรือ `npm run openapi:export`

## 1. Endpoint ที่ให้บริการ

| กลุ่ม | Path (ใต้ `/api/v1`) | สิทธิ์ | ที่มาในระบบเดิม |
|---|---|---|---|
| Auth | `POST /auth/login` · `POST /auth/exchange` | public (rate-limit 10/นาที) | `Program.Main` login + `AdAuthService` |
| Auth | `GET /auth/me` · `POST /auth/consent` · `POST /auth/logout` | ผู้ใช้ที่ login | PDPA dialog, audit LOGOUT |
| ผู้ใช้ | `GET /users/lookup?q=` | ทุกคนที่ login | (ใหม่) ใช้ในหน้าแชร์/อนุมัติ |
| ผู้ใช้ | `GET /users` · `GET /users/:id` · `GET /users/positions` | Manager+ | `UserAccountRepository`, UserManagementForm |
| ผู้ใช้ | `POST /users` · `PATCH /users/:id` · `DELETE /users/:id` (ปิดบัญชี) | Admin | `UserAdminController` (เดิมไม่เช็ก role — C15) |
| หน่วยงาน | `GET /org-units` · `/:id` · `/:id/dependents` · `/by-confidentiality/:level` · `/relationships` | ทุกคนที่ login | `OrgStructureService` |
| หน่วยงาน | `POST /org-units` · `PATCH /:id` · `PUT /:id/parent` · `DELETE /:id[?force=true]` · `POST/DELETE /relationships` | Admin | `OrgStructureService` (Admin-only เดิม) |
| ข้อมูลหลัก HR | `GET/POST/PATCH/DELETE /hr/{divisions,departments,positions,position-levels,position-mappings}` | อ่าน: ทุกคน · เขียน: Admin | `OrgMasterService` |
| เมนู | `GET /menus` (ต้นไม้ตามบทบาท) | ทุกคนที่ login | `MenuService.GetRootMenus/GetChildMenus` |
| เมนู | `GET /menus/manage` `/statistics` `/key-available` · `POST/PUT/DELETE` · `POST /menus/reorder` | Admin | `MenuService` |
| ค่าตั้งระบบ | `GET /system-config[/:key]` · `PUT /system-config/:key` | Admin | `ConfigManager` + `dbo.SystemConfig` |
| แจ้งเตือน | `GET /notifications` · `/unread-count` · `POST /:id/read` · `POST /read-all` | เจ้าของ | (inbox ใหม่) — เดิมมีแต่ INSERT |
| Audit | `GET /audit-logs` | Manager+ | `AuditService.Query` (เดิม `AppRole < 3` ห้าม) |
| Audit | `GET /audit-logs/workflow-instances/:id` | ทุกคนที่ login | `GetAuditLogsByWorkflowInstance` |
| (provider) | `NotificationsService.send()`, `SystemConfigService.get*()` | module อื่นเรียกใช้ | `NotificationService.Send`, `ConfigManager.Get` |

## 2. กฎธุรกิจที่พอร์ตมา
- **OrgUnit** (`shared/org-units/org-units.service.ts`): ลำดับชั้น SubCommittee→Division→Department (SubCommittee ห้ามมี parent, Division parent ไม่บังคับแต่ต้องเป็น SubCommittee, Department ต้องมี parent เป็น Division, parent ต้อง active); ชื่อไทยห้ามซ้ำใน parent เดียวกัน; รหัสว่าง/ซ้ำ → สร้างให้ (`SC-001`/`DIV-001`/`DEPT-001`) และลองใหม่ได้ 3 ครั้งเมื่อชนกัน; SubCommittee สร้าง/ลบแถว `m_SubCommittee` คู่กันใน transaction เดียว; ลบต้องไม่มี dependents ยกเว้น `force` (soft delete โฟลเดอร์ทั้งหมดของหน่วยงาน)
- **Login** (`auth/services/auth.service.ts`): ผู้ใช้ใหม่ = Officer/OrgUnit เริ่มต้น/ยังไม่ consent · บัญชีปิดเข้าไม่ได้ · sync ข้อมูลพนักงานเมื่อเปลี่ยน · บันทึกเวลา+IP login · แยกรหัสผิด (401) กับ AD ล่ม (503)
- **สิทธิ์ตามชั้นความลับ** (`user-context.service.ts`): `EMS.sp_ResolveFolderAuthority` → dictionary ตามชั้น 1–4 · SP ยังไม่ deploy = ไม่มีสิทธิ์ (ไม่ทำให้ login ล้ม)
- **ผู้ใช้**: เขียน = Admin; ปิดบัญชีตัวเองไม่ได้; แก้แล้วล้าง cache ของ UserContext ทันที
- **Notification**: `send()` ไม่ทำให้งานหลักล้ม · `markRead` ตรวจเจ้าของ (SP เดิมไม่ตรวจ)

## 3. ส่วนที่ต่างจากระบบเดิม / ต้องตัดสินใจ
ดู [DECISIONS §D](../DECISIONS.md) ข้อ X-01 … X-09

## 4. ยังไม่ได้ทำ (deferred)
| เรื่อง | เหตุผล |
|---|---|
| นำเข้า Excel ข้อมูลหลัก HR (`OrgMasterService.ParseAndValidateExcel/ExecuteImport`) | ไม่ใช่ CRUD หลัก; ต้องยืนยันว่ายังใช้ (RECOMMENDATIONS F-06) |
| ค้นผู้ใช้จาก LDAP / `UpsertFromLdap` | ต้องใช้ LDAP credential (secret) และยืนยันว่ายังใช้; ปัจจุบัน user ถูกสร้างตอน login |
| sync ข้อมูลพนักงานจาก Employee API (`SyncEmployeeInfoFromApi`) เมื่อ AD ไม่ส่ง `employee_Info` | ต้องรู้ endpoint/สัญญาของ Employee API (`EmployeeApiBaseUrl/Token`) |
| `EMS.m_Employee` (ตารางพนักงานของ HR) | มี entity แล้วแต่ยังไม่มี endpoint — ไม่พบ use case ที่เรียกในโค้ดที่ compile |
| Menu API ภายนอก (`MenuApiUrl`) | ใช้ตาราง `EMS.MenuItem` เป็นแหล่งเดียว (OPEN_QUESTIONS B4 — รอยืนยัน) |

## 5. ต้องทดสอบกับ SQL Server จริง
1. `POST /auth/login` → สร้าง `EMS.UserAccount` ใหม่ (`sp_InsertUserAccount` คืน `SCOPE_IDENTITY` ในคอลัมน์แรกจริงหรือไม่) และ `sp_UpdateLastLogin`
2. `sp_ResolveFolderAuthority` คืนคอลัมน์ `ConfidentialityLevel`, `CanView…` ตามที่ map (ลองผู้ใช้ที่มี/ไม่มีแถว)
3. สร้าง OrgUnit ทั้ง 3 ระดับ (รวมกรณีรหัสซ้ำ → RAISERROR → ลองใหม่), ย้าย, ลบ/force ลบ, เชื่อม Division-SubCommittee
4. `GET /org-units` (hierarchy SP คืนทั้งที่ถูกลบ — API กรองเอง)
5. `GET /notifications` ประสิทธิภาพก่อน/หลังสร้าง index (`docs/db/001`)
6. `PUT /system-config/:key` แล้วอ่านซ้ำ (ล้าง cache) · `dbo.SystemConfig` ไม่มี DDL — ตรวจชื่อคอลัมน์
7. `GET /audit-logs` — `COUNT(*) OVER()` คืนใน `TotalCount`; workflow audit ใช้ชื่อตาราง `WFE.t_WFStepInstance` และคอลัมน์ `WFStepInstanceId`
8. HR masters: ตรวจ CHECK/FK เมื่อลบฝ่ายที่มีแผนก (ควรตอบ 409)

## 6. ขอแก้ core
ไม่มี
