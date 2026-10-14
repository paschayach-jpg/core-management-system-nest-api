`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_InsertFolderTemplate]    Script Date: 14/10/2569 10:08:15 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER   PROCEDURE [storage].[sp_InsertFolderTemplate]
    @TemplateCode   NVARCHAR(50),
    @TemplateName   NVARCHAR(200),
    @TargetType     NVARCHAR(50),
    @Description    NVARCHAR(500) = NULL,
    @OrgUnitID      INT           = NULL,
    @CreatedBy      INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO storage.FolderTemplate
        (TemplateCode, TemplateName, TargetType, Description, OrgUnitID, IsActive, CreatedBy, CreatedDate)
    VALUES
        (@TemplateCode, @TemplateName, @TargetType, @Description, @OrgUnitID, 1, @CreatedBy, GETDATE());

    SELECT SCOPE_IDENTITY() AS NewID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetAllFolderTemplates]    Script Date: 14/10/2569 10:08:07 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_GetAllFolderTemplates]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT      ft.TemplateID,
                ft.TemplateCode,
                ft.TemplateName,
                ft.TargetType,
                ft.Description,
                ft.OrgUnitID,
                ou.OrgUnitNameTH AS OrgUnitName,
                ft.IsActive,
                ft.CreatedBy,
                ft.CreatedDate
    FROM storage.FolderTemplate ft
    LEFT JOIN EMS.OrgUnit ou ON ft.OrgUnitID = ou.OrgUnitID
    WHERE ft.IsActive = 1
    ORDER BY ft.TemplateName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_UpdateFolderTemplate]    Script Date: 14/10/2569 10:07:56 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER   PROCEDURE [storage].[sp_UpdateFolderTemplate]
    @TemplateID     INT,
    @TemplateCode   NVARCHAR(50),
    @TemplateName   NVARCHAR(200),
    @TargetType     NVARCHAR(50),
    @Description    NVARCHAR(500) = NULL,
    @OrgUnitID      INT           = NULL,
    @IsActive       BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE storage.FolderTemplate
    SET
        TemplateCode  = @TemplateCode,
        TemplateName  = @TemplateName,
        TargetType    = @TargetType,
        Description   = @Description,
        OrgUnitID     = @OrgUnitID,
        IsActive      = @IsActive
    WHERE TemplateID = @TemplateID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_DeleteFolderTemplate]    Script Date: 14/10/2569 10:07:47 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [storage].[sp_DeleteFolderTemplate]
    @TemplateID INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM storage.FolderTemplateItem WHERE TemplateID = @TemplateID;
    DELETE FROM storage.FolderTemplate     WHERE TemplateID = @TemplateID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetFolderTemplateItems]    Script Date: 14/10/2569 10:07:37 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_GetFolderTemplateItems]
    @TemplateID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT ItemID, TemplateID, ParentItemID, FolderName, ConfidentialityLevel, SortOrder, InheritPermission
    FROM   storage.FolderTemplateItem
    WHERE  TemplateID = @TemplateID
    ORDER  BY SortOrder;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_InsertFolderTemplateItem]    Script Date: 14/10/2569 10:07:29 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_InsertFolderTemplateItem]
    @TemplateID          INT,
    @ParentItemID        INT,
    @FolderName          NVARCHAR(255),
    @ConfidentialityLevel TINYINT,
    @SortOrder           INT,
    @InheritPermission   BIT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO storage.FolderTemplateItem
        (TemplateID, ParentItemID, FolderName, ConfidentialityLevel, SortOrder, InheritPermission)
    VALUES
        (@TemplateID, @ParentItemID, @FolderName, @ConfidentialityLevel, @SortOrder, @InheritPermission);
    SELECT SCOPE_IDENTITY() AS NewItemID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_UpdateFolderTemplateItem]    Script Date: 14/10/2569 10:07:18 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [storage].[sp_UpdateFolderTemplateItem]
    @ItemID              INT,
    @FolderName          NVARCHAR(200),
    @ConfidentialityLevel TINYINT,
    @SortOrder           INT,
    @InheritPermission   BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE storage.FolderTemplateItem
    SET FolderName           = @FolderName,
        ConfidentialityLevel = @ConfidentialityLevel,
        SortOrder            = @SortOrder,
        InheritPermission    = @InheritPermission
    WHERE ItemID = @ItemID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_DeleteFolderTemplateItem]    Script Date: 14/10/2569 10:07:08 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [storage].[sp_DeleteFolderTemplateItem]
    @ItemID INT
AS
BEGIN
    SET NOCOUNT ON;
    -- Delete children recursively (simple 2-level; extend if deeper nesting needed)
    DELETE FROM storage.FolderTemplateItem
    WHERE ParentItemID IN (
        SELECT ItemID FROM storage.FolderTemplateItem WHERE ParentItemID = @ItemID
    );
    DELETE FROM storage.FolderTemplateItem WHERE ParentItemID = @ItemID;
    DELETE FROM storage.FolderTemplateItem WHERE ItemID = @ItemID;
END

`