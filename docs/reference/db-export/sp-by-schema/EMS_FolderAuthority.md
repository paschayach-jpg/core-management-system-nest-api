`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetAllFolderAuthorityConfigs]    Script Date: 14/10/2569 9:55:28 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- 4. Update Stored Procedures ให้รองรับ LevelCode

-- GetAll
ALTER   PROCEDURE [EMS].[sp_GetAllFolderAuthorityConfigs]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM EMS.FolderAuthorityConfig
    WHERE IsActive = 1
    ORDER BY ConfigLabel, ConfidentialityLevel;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_ResolveFolderAuthority]    Script Date: 14/10/2569 9:55:19 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_ResolveFolderAuthority]
    @LevelCode      NVARCHAR(20)  = NULL,
    @PositionName   NVARCHAR(200) = NULL,
    @DepartmentCode NVARCHAR(50)  = NULL,
    @DivisionCode   NVARCHAR(50)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Priority 0: LevelCode + DepartmentCode
    IF @LevelCode IS NOT NULL AND @DepartmentCode IS NOT NULL
       AND EXISTS (SELECT 1 FROM EMS.FolderAuthorityConfig
                   WHERE IsActive = 1 AND LevelCode = @LevelCode AND DepartmentCode = @DepartmentCode)
    BEGIN
        SELECT ConfigID, ConfigLabel, PositionName, DepartmentCode, DivisionCode,
               LevelCode, ConfidentialityLevel,
               CanView, CanAdd, CanEdit, CanApprove, CanDownload,
               IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
        FROM   EMS.FolderAuthorityConfig
        WHERE  IsActive = 1 AND LevelCode = @LevelCode AND DepartmentCode = @DepartmentCode
        ORDER BY ConfidentialityLevel;
        RETURN;
    END

    -- Priority 1: LevelCode only
    IF @LevelCode IS NOT NULL AND EXISTS (
        SELECT 1 FROM EMS.FolderAuthorityConfig
        WHERE IsActive = 1 AND LevelCode = @LevelCode AND (DepartmentCode IS NULL OR DepartmentCode = ''))
    BEGIN
        SELECT ConfigID, ConfigLabel, PositionName, DepartmentCode, DivisionCode,
               LevelCode, ConfidentialityLevel,
               CanView, CanAdd, CanEdit, CanApprove, CanDownload,
               IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
        FROM   EMS.FolderAuthorityConfig
        WHERE  IsActive = 1 AND LevelCode = @LevelCode AND (DepartmentCode IS NULL OR DepartmentCode = '')
        ORDER BY ConfidentialityLevel;
        RETURN;
    END

    -- Priority 2: PositionName
    IF @PositionName IS NOT NULL AND EXISTS (
        SELECT 1 FROM EMS.FolderAuthorityConfig WHERE IsActive = 1 AND PositionName = @PositionName)
    BEGIN
        SELECT ConfigID, ConfigLabel, PositionName, DepartmentCode, DivisionCode,
               LevelCode, ConfidentialityLevel,
               CanView, CanAdd, CanEdit, CanApprove, CanDownload,
               IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
        FROM   EMS.FolderAuthorityConfig
        WHERE  IsActive = 1 AND PositionName = @PositionName
        ORDER BY ConfidentialityLevel;
        RETURN;
    END

    -- Priority 3: DepartmentCode
    IF @DepartmentCode IS NOT NULL AND EXISTS (
        SELECT 1 FROM EMS.FolderAuthorityConfig
        WHERE IsActive = 1 AND DepartmentCode = @DepartmentCode
          AND PositionName IS NULL AND (LevelCode IS NULL OR LevelCode = ''))
    BEGIN
        SELECT ConfigID, ConfigLabel, PositionName, DepartmentCode, DivisionCode,
               LevelCode, ConfidentialityLevel,
               CanView, CanAdd, CanEdit, CanApprove, CanDownload,
               IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
        FROM   EMS.FolderAuthorityConfig
        WHERE  IsActive = 1 AND DepartmentCode = @DepartmentCode
          AND  PositionName IS NULL AND (LevelCode IS NULL OR LevelCode = '')
        ORDER BY ConfidentialityLevel;
        RETURN;
    END

    -- Priority 4: DivisionCode
    SELECT ConfigID, ConfigLabel, PositionName, DepartmentCode, DivisionCode,
           LevelCode, ConfidentialityLevel,
           CanView, CanAdd, CanEdit, CanApprove, CanDownload,
           IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
    FROM   EMS.FolderAuthorityConfig
    WHERE  IsActive = 1 AND DivisionCode = @DivisionCode
      AND  PositionName IS NULL AND DepartmentCode IS NULL AND (LevelCode IS NULL OR LevelCode = '')
    ORDER BY ConfidentialityLevel;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_InsertFolderAuthorityConfig]    Script Date: 14/10/2569 9:55:04 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Fix sp_InsertFolderAuthorityConfig
ALTER PROCEDURE [EMS].[sp_InsertFolderAuthorityConfig]
    @ConfigLabel    NVARCHAR(200),
    @PositionName   NVARCHAR(200) = NULL,
    @DepartmentCode NVARCHAR(50)  = NULL,
    @DivisionCode   NVARCHAR(50)  = NULL,
    @LevelCode      NVARCHAR(10)  = NULL,
    @ConfidentialityLevel TINYINT = 0,
    @CanView    BIT = 0,
    @CanAdd     BIT = 0,
    @CanEdit    BIT = 0,
    @CanApprove BIT = 0,
    @CreatedBy  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    -- resolve level จาก LevelCode ถ้า ConfidentialityLevel ไม่ได้ส่งมา
    DECLARE @Level TINYINT = CASE
        WHEN @ConfidentialityLevel > 0 THEN @ConfidentialityLevel
        ELSE CASE @LevelCode
            WHEN '1HC' THEN 1 WHEN '2SC' THEN 2
            WHEN '3NC' THEN 3 WHEN '4PC' THEN 4 ELSE 0 END
    END;
    DECLARE @Code NVARCHAR(10) = CASE
        WHEN @LevelCode IS NOT NULL THEN @LevelCode
        ELSE CASE @Level WHEN 1 THEN '1HC' WHEN 2 THEN '2SC'
                         WHEN 3 THEN '3NC' WHEN 4 THEN '4PC' ELSE NULL END
    END;

    INSERT INTO EMS.FolderAuthorityConfig
        (ConfigLabel, PositionName, DepartmentCode, DivisionCode,
         LevelCode, ConfidentialityLevel,
         CanView, CanAdd, CanEdit, CanApprove, CreatedBy)
    VALUES
        (@ConfigLabel, @PositionName, @DepartmentCode, @DivisionCode,
         @Code, @Level,
         @CanView, @CanAdd, @CanEdit, @CanApprove, @CreatedBy);
    SELECT SCOPE_IDENTITY();
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_UpdateFolderAuthorityConfig]    Script Date: 14/10/2569 9:54:56 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Fix sp_UpdateFolderAuthorityConfig
ALTER PROCEDURE [EMS].[sp_UpdateFolderAuthorityConfig]
    @ConfigID        INT,
    @ConfigLabel     NVARCHAR(200),
    @PositionName    NVARCHAR(200) = NULL,
    @DepartmentCode NVARCHAR(50)  = NULL,
    @DivisionCode    NVARCHAR(50)  = NULL,
    @LevelCode       NVARCHAR(10)  = NULL,
    @ConfidentialityLevel TINYINT = 0,
    @CanView    BIT = 0,
    @CanAdd     BIT = 0,
    @CanEdit    BIT = 0,
    @CanApprove BIT = 0,
    @UpdatedBy  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Level TINYINT = CASE
        WHEN @ConfidentialityLevel > 0 THEN @ConfidentialityLevel
        ELSE CASE @LevelCode
            WHEN '1HC' THEN 1 WHEN '2SC' THEN 2
            WHEN '3NC' THEN 3 WHEN '4PC' THEN 4 ELSE 0 END
    END;
    DECLARE @Code NVARCHAR(10) = CASE
        WHEN @LevelCode IS NOT NULL THEN @LevelCode
        ELSE CASE @Level WHEN 1 THEN '1HC' WHEN 2 THEN '2SC'
                         WHEN 3 THEN '3NC' WHEN 4 THEN '4PC' ELSE NULL END
    END;

    UPDATE EMS.FolderAuthorityConfig SET
        ConfigLabel          = @ConfigLabel,
        PositionName         = @PositionName,
        DepartmentCode       = @DepartmentCode,
        DivisionCode         = @DivisionCode,
        LevelCode            = @Code,
        ConfidentialityLevel = @Level,
        CanView    = @CanView,  CanAdd     = @CanAdd,
        CanEdit    = @CanEdit,  CanApprove = @CanApprove,
        UpdatedBy  = @UpdatedBy, UpdatedDate = GETUTCDATE()
    WHERE ConfigID = @ConfigID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_DeleteFolderAuthorityConfig]    Script Date: 14/10/2569 9:54:47 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [EMS].[sp_DeleteFolderAuthorityConfig]
    @ConfigLabel NVARCHAR(200),
    @DeletedBy   INT
AS
BEGIN
    SET NOCOUNT ON;
    -- ลบทั้ง group (ทุก Level ของ ConfigLabel เดียวกัน)
    UPDATE EMS.FolderAuthorityConfig
    SET IsActive = 0, UpdatedBy = @DeletedBy, UpdatedDate = GETUTCDATE()
    WHERE ConfigLabel = @ConfigLabel;
END

`