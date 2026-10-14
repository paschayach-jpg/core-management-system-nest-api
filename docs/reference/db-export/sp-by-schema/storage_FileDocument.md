`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_InsertFileDocument]    Script Date: 14/10/2569 10:05:21 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- storage.FileDocument
-- ============================================================

ALTER PROCEDURE [storage].[sp_InsertFileDocument]
    @FolderID        INT,
    @OriginalFileName NVARCHAR(260),
    @StoredFileName  NVARCHAR(360),
    @FileExtension   VARCHAR(20),
    @MimeType        VARCHAR(100),
    @FileSizeBytes   BIGINT,
    @PhysicalPath    NVARCHAR(500),
    @Checksum        VARCHAR(64),
    @UploadedBy      INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO storage.FileDocument
        (FolderID, OriginalFileName, StoredFileName, FileExtension, MimeType,
         FileSizeBytes, PhysicalPath, Checksum, UploadedBy)
    VALUES
        (@FolderID, @OriginalFileName, @StoredFileName, @FileExtension, @MimeType,
         @FileSizeBytes, @PhysicalPath, @Checksum, @UploadedBy);
    SELECT SCOPE_IDENTITY() AS NewFileID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFileDocumentByID]    Script Date: 14/10/2569 10:05:12 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_GetFileDocumentByID]
    @FileID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.FileID, f.FileGUID, f.FolderID, f.OriginalFileName, f.StoredFileName,
           f.FileExtension, f.MimeType, f.FileSizeBytes, f.PhysicalPath, f.Checksum,
           f.VirusScanStatus, f.VirusScanDate, f.FileStatus,
           f.UploadedBy, f.UploadedDate,
           f.ArchivedBy, f.ArchivedDate,
           f.DeletedBy, f.DeletedDate, f.Version,
           ISNULL(u.DisplayName, u.ADUserName) AS UploadedByName
    FROM   storage.FileDocument f
    LEFT   JOIN EMS.UserAccount u ON u.UserID = f.UploadedBy
    WHERE  f.FileID = @FileID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFileDocumentsByFolder]    Script Date: 14/10/2569 10:04:59 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_GetFileDocumentsByFolder]
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.FileID, f.FileGUID, f.FolderID, f.OriginalFileName, f.StoredFileName,
           f.FileExtension, f.MimeType, f.FileSizeBytes, f.PhysicalPath, f.Checksum,
           f.VirusScanStatus, f.VirusScanDate, f.FileStatus,
           f.UploadedBy, f.UploadedDate,
           f.ArchivedBy, f.ArchivedDate,
           f.DeletedBy, f.DeletedDate, f.Version,
           ISNULL(fo.FolderName, '') AS FolderName,
           ISNULL(u.DisplayName, u.ADUserName) AS UploadedByName
    FROM   storage.FileDocument f
    LEFT JOIN storage.Folder fo ON fo.FolderID = f.FolderID
    LEFT JOIN EMS.UserAccount u ON u.UserID = f.UploadedBy
    WHERE  f.FolderID = @FolderID
      AND  f.FileStatus != 3;   -- ยกเว้นที่ถูกลบถาวร
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFileDocumentsByOrgUnit]    Script Date: 14/10/2569 10:04:51 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_GetFileDocumentsByOrgUnit]
    @OrgUnitID INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @FolderOrgUnits TABLE (OrgUnitID INT PRIMARY KEY);

    -- Sub Committee: sc.OrgUnitID is direct EMS.OrgUnit.OrgUnitID
    IF EXISTS (SELECT 1 FROM EMS.m_SubCommittee WHERE OrgUnitID = @OrgUnitID AND IsActive = 1 AND IsDeleted = 0)
        INSERT INTO @FolderOrgUnits SELECT @OrgUnitID;

    -- Division: DivisionID → OrgUnits at Division level AND all Department OrgUnits under this Division
    IF EXISTS (SELECT 1 FROM EMS.m_Division WHERE DivisionID = @OrgUnitID AND IsActive = 1)
    BEGIN
        -- Division-level OrgUnits (OrgUnitType = 2)
        INSERT INTO @FolderOrgUnits
        SELECT ou.OrgUnitID
        FROM   EMS.m_Division d
        JOIN   EMS.OrgUnit ou ON ou.OrgUnitCode = d.DivisionCode AND ou.OrgUnitType = 2 AND ou.IsDeleted = 0
        WHERE  d.DivisionID = @OrgUnitID;

        -- Department-level OrgUnits under this Division (OrgUnitType = 3)
        INSERT INTO @FolderOrgUnits
        SELECT ou.OrgUnitID
        FROM   EMS.m_Department dep
        JOIN   EMS.OrgUnit ou ON ou.OrgUnitCode = dep.DepartmentCode AND ou.OrgUnitType = 3 AND ou.IsDeleted = 0
        WHERE  dep.DivisionID = @OrgUnitID AND dep.IsActive = 1
          AND  ou.OrgUnitID NOT IN (SELECT OrgUnitID FROM @FolderOrgUnits);
    END

    -- Department: DepartmentID → ALL OrgUnit instances with same DepartmentCode
    IF EXISTS (SELECT 1 FROM EMS.m_Department WHERE DepartmentID = @OrgUnitID AND IsActive = 1)
        INSERT INTO @FolderOrgUnits
        SELECT ou.OrgUnitID
        FROM   EMS.m_Department dep
        JOIN   EMS.OrgUnit ou ON ou.OrgUnitCode = dep.DepartmentCode AND ou.OrgUnitType = 3 AND ou.IsDeleted = 0
        WHERE  dep.DepartmentID = @OrgUnitID;

    -- Fallback: treat as direct OrgUnitID
    IF NOT EXISTS (SELECT 1 FROM @FolderOrgUnits)
        INSERT INTO @FolderOrgUnits SELECT @OrgUnitID;

    SELECT
        fd.FileID, fd.FileGUID, fd.FolderID,
        COALESCE(f.FolderName, N'Folder ' + CAST(fd.FolderID AS NVARCHAR(20))) AS FolderName,
        fd.OriginalFileName, fd.StoredFileName, fd.FileExtension,
        fd.MimeType, fd.FileSizeBytes, fd.PhysicalPath, fd.Checksum,
        fd.VirusScanStatus, fd.VirusScanDate,
        fd.FileStatus, fd.UploadedBy, fd.UploadedDate,
        fd.ArchivedBy, fd.ArchivedDate,
        fd.DeletedBy, fd.DeletedDate, fd.Version
    FROM   storage.FileDocument fd
    INNER  JOIN storage.Folder f ON f.FolderID = fd.FolderID
    INNER  JOIN @FolderOrgUnits ids ON ids.OrgUnitID = f.OrgUnitID
    WHERE  fd.FileStatus != 3
      AND  f.IsDeleted   = 0
    ORDER  BY f.FolderName, fd.OriginalFileName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetAllFileDocumentsGroupedByFolder]    Script Date: 14/10/2569 10:04:43 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_GetAllFileDocumentsGroupedByFolder]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT      fd.FileID, fd.FileGUID, fd.FolderID,
                COALESCE(f.FolderName, N'Folder ' + CAST(fd.FolderID AS NVARCHAR(20))) AS FolderName,
                fd.OriginalFileName, fd.StoredFileName, fd.FileExtension,
                fd.MimeType, fd.FileSizeBytes, fd.PhysicalPath, fd.Checksum,
                fd.VirusScanStatus, fd.VirusScanDate,
                fd.FileStatus, fd.UploadedBy, fd.UploadedDate,
                fd.ArchivedBy, fd.ArchivedDate,
                fd.DeletedBy, fd.DeletedDate, fd.Version,
                ISNULL(u.DisplayName, u.ADUserName) AS UploadedByName
    FROM   storage.FileDocument fd
    LEFT   JOIN storage.Folder f ON f.FolderID = fd.FolderID
    LEFT   JOIN EMS.UserAccount u ON u.UserID = fd.UploadedBy
    WHERE  fd.FileStatus != 3   -- ไม่รวมที่ถูกลบ
    ORDER BY fd.FolderID, fd.OriginalFileName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_UpdateFileDocument]    Script Date: 14/10/2569 10:04:32 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_UpdateFileDocument]
    @FileID       INT,
    @FolderID     INT,
    @PhysicalPath NVARCHAR(500),
    @FileStatus   TINYINT,
    @ArchivedBy   INT,
    @ArchivedDate DATETIME,
    @DeletedBy    INT,
    @DeletedDate  DATETIME
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE storage.FileDocument
    SET    FolderID     = @FolderID,
           PhysicalPath = @PhysicalPath,
           FileStatus   = @FileStatus,
           ArchivedBy   = @ArchivedBy,
           ArchivedDate = @ArchivedDate,
           DeletedBy    = @DeletedBy,
           DeletedDate  = @DeletedDate
    WHERE  FileID = @FileID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_RenameFileDocument]    Script Date: 14/10/2569 10:04:24 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [storage].[sp_RenameFileDocument]
    @FileID           INT,
    @OriginalFileName NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE storage.FileDocument
    SET    OriginalFileName = @OriginalFileName
    WHERE  FileID = @FileID
      AND  DeletedDate IS NULL;   -- ไม่อนุญาตให้เปลี่ยนชื่อไฟล์ที่ถูกลบแล้ว
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_SoftDeleteFileDocument]    Script Date: 14/10/2569 10:04:16 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_SoftDeleteFileDocument]
    @FileID    INT,
    @DeletedBy INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE storage.FileDocument
    SET    FileStatus = 3, DeletedBy = @DeletedBy, DeletedDate = GETDATE()
    WHERE  FileID = @FileID;
END

`