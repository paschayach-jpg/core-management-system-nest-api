`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_InsertFolder]    Script Date: 14/10/2569 10:02:33 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_InsertFolder]
    @FolderName          NVARCHAR(255),
    @ParentFolderID      INT,
    @OrgUnitID           INT,
    @TemplateID          INT,
    @ConfidentialityLevel TINYINT,
    @FolderDepth         TINYINT,
    @PhysicalPath        NVARCHAR(500),
    @InheritPermission   BIT,
    @CreatedBy           INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO storage.Folder
        (FolderName, ParentFolderID, OrgUnitID, TemplateID, ConfidentialityLevel,
         FolderDepth, PhysicalPath, InheritPermission, CreatedBy)
    VALUES
        (@FolderName, @ParentFolderID, @OrgUnitID, @TemplateID, @ConfidentialityLevel,
         @FolderDepth, @PhysicalPath, @InheritPermission, @CreatedBy);
    SELECT SCOPE_IDENTITY() AS NewFolderID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_UpdateFolder]    Script Date: 14/10/2569 10:02:20 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_UpdateFolder]
    @FolderID             INT,
    @FolderName           NVARCHAR(255),
    @ParentFolderID       INT           = NULL,
    @FolderDepth          INT           = NULL,
    @PhysicalPath         NVARCHAR(500) = NULL,
    @ConfidentialityLevel TINYINT,
    @InheritPermission    BIT,
    @UpdatedBy            INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE storage.Folder
    SET    FolderName           = @FolderName,
           ParentFolderID       = COALESCE(@ParentFolderID, ParentFolderID),
           FolderDepth          = COALESCE(@FolderDepth,    FolderDepth),
           PhysicalPath         = COALESCE(@PhysicalPath,   PhysicalPath),
           ConfidentialityLevel = @ConfidentialityLevel,
           InheritPermission    = @InheritPermission,
           UpdatedBy            = @UpdatedBy,
           UpdatedDate          = GETDATE()
    WHERE  FolderID = @FolderID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_UpdateFolderFileCount]    Script Date: 14/10/2569 10:02:08 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_UpdateFolderFileCount]
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    
    -- อัพเดท FileCount สำหรับโฟลเดอร์ที่ระบุ
    UPDATE storage.Folder
    SET FileCount = (
        SELECT COUNT(*)
        FROM storage.FileDocument fd
        WHERE fd.FolderID = @FolderID
          AND fd.FileStatus != 3  -- ไม่นับไฟล์ที่ถูกลบ (Status 3 = Deleted)
          AND fd.DeletedDate IS NULL
    )
    WHERE FolderID = @FolderID;
    
    PRINT 'Updated FileCount for FolderID: ' + CAST(@FolderID AS VARCHAR(10));
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFolderByID]    Script Date: 14/10/2569 10:02:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ─────────────────────────────────────────────────────────────
-- 1. sp_GetFolderByID
-- ─────────────────────────────────────────────────────────────
ALTER PROCEDURE [storage].[sp_GetFolderByID]
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.[FolderID], f.[FolderGUID], f.[FolderName], f.[ParentFolderID], f.[OrgUnitID], f.[TemplateID],
           f.[ConfidentialityLevel], f.[FolderDepth], f.[PhysicalPath], f.[FolderSizeBytes],
           (SELECT COUNT(*) FROM storage.FileDocument fd
            WHERE fd.FolderID = f.FolderID AND fd.FileStatus != 3 AND fd.DeletedDate IS NULL) AS FileCount,
           f.[IsArchived], f.[ArchivedBy], f.[ArchivedDate], f.[IsDeleted], f.[DeletedBy], f.[DeletedDate],
           f.[RecycleBinExpiry], f.[InheritPermission], f.[CreatedBy], f.[CreatedDate], f.[UpdatedBy], f.[UpdatedDate]
    FROM   [storage].[Folder] f
    WHERE  f.[FolderID] = @FolderID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFolderChildren]    Script Date: 14/10/2569 10:01:51 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ─────────────────────────────────────────────────────────────
-- 2. sp_GetFolderChildren
-- ─────────────────────────────────────────────────────────────
ALTER PROCEDURE [storage].[sp_GetFolderChildren]
    @ParentFolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.[FolderID], f.[FolderGUID], f.[FolderName], f.[ParentFolderID], f.[OrgUnitID], f.[TemplateID],
           f.[ConfidentialityLevel], f.[FolderDepth], f.[PhysicalPath], f.[FolderSizeBytes],
           (SELECT COUNT(*) FROM storage.FileDocument fd
            WHERE fd.FolderID = f.FolderID AND fd.FileStatus != 3 AND fd.DeletedDate IS NULL) AS FileCount,
           f.[IsArchived], f.[ArchivedBy], f.[ArchivedDate], f.[IsDeleted], f.[DeletedBy], f.[DeletedDate],
           f.[RecycleBinExpiry], f.[InheritPermission], f.[CreatedBy], f.[CreatedDate], f.[UpdatedBy], f.[UpdatedDate]
    FROM   [storage].[Folder] f
    WHERE  f.[ParentFolderID] = @ParentFolderID AND f.[IsDeleted] = 0;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFolderDescendants]    Script Date: 14/10/2569 10:01:44 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ─────────────────────────────────────────────────────────────
-- 1. sp_GetFolderDescendants  (recursive CTE)
--    ลบ FileCount ออกจาก CTE แล้วคำนวณ live ใน outer SELECT
-- ─────────────────────────────────────────────────────────────
ALTER PROCEDURE [storage].[sp_GetFolderDescendants]
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    WITH FolderHierarchy AS (
        SELECT f.FolderID, f.FolderGUID, f.FolderName, f.ParentFolderID,
               f.OrgUnitID, f.TemplateID, f.ConfidentialityLevel, f.FolderDepth,
               f.PhysicalPath, f.FolderSizeBytes,
               f.IsArchived, f.ArchivedBy, f.ArchivedDate,
               f.IsDeleted, f.DeletedBy, f.DeletedDate, f.RecycleBinExpiry,
               f.InheritPermission,
               f.CreatedBy, f.CreatedDate, f.UpdatedBy, f.UpdatedDate
        FROM   storage.Folder f
        WHERE  f.FolderID = @FolderID
          UNION ALL  
        SELECT f.FolderID, f.FolderGUID, f.FolderName, f.ParentFolderID,
               f.OrgUnitID, f.TemplateID, f.ConfidentialityLevel, f.FolderDepth,
               f.PhysicalPath, f.FolderSizeBytes,
               f.IsArchived, f.ArchivedBy, f.ArchivedDate,
               f.IsDeleted, f.DeletedBy, f.DeletedDate, f.RecycleBinExpiry,
               f.InheritPermission,
               f.CreatedBy, f.CreatedDate, f.UpdatedBy, f.UpdatedDate
        FROM   storage.Folder f
        INNER  JOIN FolderHierarchy fh ON f.ParentFolderID = fh.FolderID
    )
    SELECT fh.FolderID, fh.FolderGUID, fh.FolderName, fh.ParentFolderID,
           fh.OrgUnitID, fh.TemplateID, fh.ConfidentialityLevel, fh.FolderDepth,
           fh.PhysicalPath, fh.FolderSizeBytes,
           (SELECT COUNT(*)
            FROM   storage.FileDocument fd
            WHERE  fd.FolderID = fh.FolderID
              AND  fd.FileStatus != 3
              AND  fd.DeletedDate IS NULL) AS FileCount,
           fh.IsArchived, fh.ArchivedBy, fh.ArchivedDate,
           fh.IsDeleted, fh.DeletedBy, fh.DeletedDate, fh.RecycleBinExpiry,
           fh.InheritPermission,
           fh.CreatedBy, fh.CreatedDate, fh.UpdatedBy, fh.UpdatedDate,
           ISNULL(u.DisplayName, u.ADUserName) AS CreatedByName
    FROM   FolderHierarchy fh
    LEFT   JOIN EMS.UserAccount u ON u.UserID = fh.CreatedBy;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFolderSiblings]    Script Date: 14/10/2569 10:01:35 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ─────────────────────────────────────────────────────────────
-- 5. sp_GetFolderSiblings (แก้ไขส่วนที่ขาดหายไปให้สมบูรณ์)
-- ─────────────────────────────────────────────────────────────
ALTER PROCEDURE [storage].[sp_GetFolderSiblings]
    @ParentFolderID INT = NULL,
    @OrgUnitID      INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.FolderID, f.FolderGUID, f.FolderName, f.ParentFolderID,
           f.OrgUnitID, f.TemplateID, f.ConfidentialityLevel, f.FolderDepth,
           f.PhysicalPath, f.FolderSizeBytes,
           (SELECT COUNT(*)
            FROM   storage.FileDocument fd
            WHERE  fd.FolderID = f.FolderID
              AND  fd.FileStatus != 3
              AND  fd.DeletedDate IS NULL) AS FileCount,
           f.IsArchived, f.ArchivedBy, f.ArchivedDate,
           f.IsDeleted, f.DeletedBy, f.DeletedDate, f.RecycleBinExpiry,
           f.InheritPermission,
           f.CreatedBy, f.CreatedDate, f.UpdatedBy, f.UpdatedDate,
           ISNULL(u.DisplayName, u.ADUserName) AS CreatedByName
    FROM   storage.Folder f
    LEFT   JOIN EMS.UserAccount u ON u.UserID = f.CreatedBy
    WHERE  f.IsDeleted = 0
      AND  f.OrgUnitID = @OrgUnitID
      AND  (
            (@ParentFolderID IS NULL AND f.ParentFolderID IS NULL)
            OR (f.ParentFolderID = @ParentFolderID)
           )
    ORDER BY f.FolderName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetRootFoldersByOrgUnit]    Script Date: 14/10/2569 10:01:27 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ─────────────────────────────────────────────────────────────
-- 3. sp_GetRootFoldersByOrgUnit
-- ─────────────────────────────────────────────────────────────
ALTER PROCEDURE [storage].[sp_GetRootFoldersByOrgUnit]
    @OrgUnitID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.[FolderID], f.[FolderGUID], f.[FolderName], f.[ParentFolderID], f.[OrgUnitID], f.[TemplateID],
           f.[ConfidentialityLevel], f.[FolderDepth], f.[PhysicalPath], f.[FolderSizeBytes],
           (SELECT COUNT(*) FROM storage.FileDocument fd
            WHERE fd.FolderID = f.FolderID AND fd.FileStatus != 3 AND fd.DeletedDate IS NULL) AS FileCount,
           f.[IsArchived], f.[ArchivedBy], f.[ArchivedDate], f.[IsDeleted], f.[DeletedBy], f.[DeletedDate],
           f.[RecycleBinExpiry], f.[InheritPermission], f.[CreatedBy], f.[CreatedDate], f.[UpdatedBy], f.[UpdatedDate]
    FROM   [storage].[Folder] f
    WHERE  f.[OrgUnitID] = @OrgUnitID AND f.[ParentFolderID] IS NULL AND f.[IsDeleted] = 0;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFoldersByOrgUnit]    Script Date: 14/10/2569 10:01:11 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ─────────────────────────────────────────────────────────────
-- 2. sp_GetFoldersByOrgUnit
-- ─────────────────────────────────────────────────────────────
ALTER PROCEDURE [storage].[sp_GetFoldersByOrgUnit]
    @OrgUnitID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.FolderID, f.FolderGUID, f.FolderName, f.ParentFolderID,
           f.OrgUnitID, f.TemplateID, f.ConfidentialityLevel, f.FolderDepth,
           f.PhysicalPath, f.FolderSizeBytes,
           (SELECT COUNT(*)
            FROM   storage.FileDocument fd
            WHERE  fd.FolderID = f.FolderID
              AND  fd.FileStatus != 3
              AND  fd.DeletedDate IS NULL) AS FileCount,
           f.IsArchived, f.ArchivedBy, f.ArchivedDate,
           f.IsDeleted, f.DeletedBy, f.DeletedDate, f.RecycleBinExpiry,
           f.InheritPermission,
           f.CreatedBy, f.CreatedDate, f.UpdatedBy, f.UpdatedDate,
           ISNULL(u.DisplayName, u.ADUserName) AS CreatedByName
    FROM   storage.Folder f
    LEFT   JOIN EMS.UserAccount u ON u.UserID = f.CreatedBy
    WHERE  f.OrgUnitID = @OrgUnitID
      AND  f.IsDeleted = 0
    ORDER BY f.FolderDepth, f.FolderName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetDeletedFoldersByOrgUnit]    Script Date: 14/10/2569 10:01:03 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [storage].[sp_GetDeletedFoldersByOrgUnit]
    @OrgUnitID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT [FolderID], [FolderGUID], [FolderName], [ParentFolderID], [OrgUnitID], [TemplateID],
           [ConfidentialityLevel], [FolderDepth], [PhysicalPath], [FolderSizeBytes], [FileCount],
           [IsArchived], [ArchivedBy], [ArchivedDate], [IsDeleted], [DeletedBy], [DeletedDate],
           [RecycleBinExpiry], [InheritPermission], [CreatedBy], [CreatedDate], [UpdatedBy], [UpdatedDate]
    FROM   [storage].[Folder]
    WHERE  [OrgUnitID] = @OrgUnitID AND [IsDeleted] = 1;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetAllFolders]    Script Date: 14/10/2569 10:00:55 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ─────────────────────────────────────────────────────────────
-- 3. sp_GetAllFolders
-- ─────────────────────────────────────────────────────────────
ALTER PROCEDURE [storage].[sp_GetAllFolders]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.FolderID, f.FolderGUID, f.FolderName, f.ParentFolderID,
           f.OrgUnitID, f.TemplateID, f.ConfidentialityLevel, f.FolderDepth,
           f.PhysicalPath, f.FolderSizeBytes,
           (SELECT COUNT(*)
            FROM   storage.FileDocument fd
            WHERE  fd.FolderID = f.FolderID
              AND  fd.FileStatus != 3
              AND  fd.DeletedDate IS NULL) AS FileCount,
           f.IsArchived, f.ArchivedBy, f.ArchivedDate,
           f.IsDeleted, f.DeletedBy, f.DeletedDate, f.RecycleBinExpiry,
           f.InheritPermission,
           f.CreatedBy, f.CreatedDate, f.UpdatedBy, f.UpdatedDate,
           ISNULL(u.DisplayName, u.ADUserName) AS CreatedByName
    FROM   storage.Folder f
    LEFT   JOIN EMS.UserAccount u ON u.UserID = f.CreatedBy
    WHERE  f.IsDeleted = 0
    ORDER BY f.FolderDepth, f.FolderName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_SoftDeleteFolder]    Script Date: 14/10/2569 10:00:47 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_SoftDeleteFolder]
    @FolderID  INT,
    @DeletedBy INT
AS
BEGIN
    SET NOCOUNT ON;
    WITH FolderCTE AS (
        SELECT FolderID FROM storage.Folder WHERE FolderID = @FolderID
        UNION ALL
        SELECT f.FolderID FROM storage.Folder f
        INNER  JOIN FolderCTE cte ON f.ParentFolderID = cte.FolderID
    )
    UPDATE storage.Folder
    SET    IsDeleted = 1, DeletedBy = @DeletedBy,
           DeletedDate = GETDATE(), RecycleBinExpiry = DATEADD(DAY, 30, GETDATE())
    WHERE  FolderID IN (SELECT FolderID FROM FolderCTE);
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_RestoreFolder]    Script Date: 14/10/2569 10:00:38 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_RestoreFolder]
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    WITH FolderCTE AS (
        SELECT FolderID FROM storage.Folder WHERE FolderID = @FolderID
        UNION ALL
        SELECT f.FolderID FROM storage.Folder f
        INNER  JOIN FolderCTE cte ON f.ParentFolderID = cte.FolderID
    )
    UPDATE storage.Folder
    SET    IsDeleted = 0, DeletedBy = NULL, DeletedDate = NULL, RecycleBinExpiry = NULL
    WHERE  FolderID IN (SELECT FolderID FROM FolderCTE);
END

`