/*
  001_recommended_indexes.sql — ข้อเสนอ index สำหรับ API (ไม่ทำลายข้อมูล, รันซ้ำได้)

  สถานะ: ยังไม่เคยรัน · ต้องให้ DBA ตรวจและทดสอบบนฐานทดสอบก่อน (การสร้าง index บนตารางใหญ่ล็อกตาราง/ใช้ I/O — ใช้ ONLINE = ON ถ้า edition รองรับ)
  ผลต่อ WinForms เดิม: เพิ่ม index ไม่เปลี่ยนพฤติกรรมของ query เดิม

  หลักฐาน (จาก db-export): ตารางต่อไปนี้ไม่มี index รองรับคอลัมน์ที่ API ใช้กรอง
*/
USE [CMS_DB];
GO

/* 1) EMS.Notification — 525,748 แถว, export ไม่พบ PK/index ใดเลย
      API: GET /notifications  → WHERE RecipientUserId = @u [AND IsRead = 0] ORDER BY NotificationId DESC */
IF OBJECT_ID(N'EMS.Notification') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'EMS.Notification') AND name = N'IX_Notification_Recipient')
BEGIN
    CREATE NONCLUSTERED INDEX IX_Notification_Recipient
        ON EMS.Notification (RecipientUserId, IsRead, NotificationId DESC);
END
GO

/* 2) KMS.t_KBArticle — 19,080 แถว มีเฉพาะ PK และ UQ(ArticleCode)
      API: รายการ/ค้นตามหมวด + สถานะ + ยังไม่ถูกลบ */
IF OBJECT_ID(N'KMS.t_KBArticle') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'KMS.t_KBArticle') AND name = N'IX_KBArticle_Category_Status')
BEGIN
    CREATE NONCLUSTERED INDEX IX_KBArticle_Category_Status
        ON KMS.t_KBArticle (CategoryID, IsDelete, Status);
END
GO

/* 3) KMS.t_KBArticleLink — unique index เป็น (ArticleID, EntityType, EntityID)
      การค้นย้อนกลับ "บทความที่ลิงก์มาที่ entity นี้" (เช่น Law) ต้องใช้ (EntityType, EntityID) */
IF OBJECT_ID(N'KMS.t_KBArticleLink') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'KMS.t_KBArticleLink') AND name = N'IX_KBArticleLink_Entity')
BEGIN
    CREATE NONCLUSTERED INDEX IX_KBArticleLink_Entity
        ON KMS.t_KBArticleLink (EntityType, EntityID) INCLUDE (ArticleID);
END
GO
