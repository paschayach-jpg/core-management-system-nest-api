`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_CreateMenuItem]    Script Date: 14/10/2569 9:58:06 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [EMS].[sp_CreateMenuItem]
    @ParentMenuItemID     INT = NULL,
    @MenuName             NVARCHAR(255),
    @MenuKey              NVARCHAR(100),
    @FormClassName        NVARCHAR(500) = NULL,
    @IconKey              NVARCHAR(100) = NULL,
    @DisplayOrder         INT = 0,
    @IsActive             BIT = 1,
    @RequiredAppRole      INT = NULL,
    @Description          NVARCHAR(500) = NULL,
    @ModuleCode           NVARCHAR(50) = NULL,
    @Url                  NVARCHAR(500) = NULL,
    @CreatedByUserID      INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Validate inputs
    IF @MenuName IS NULL OR LTRIM(RTRIM(@MenuName)) = ''
        THROW 50001, 'MenuName is required.', 1;
    
    IF @MenuKey IS NULL OR LTRIM(RTRIM(@MenuKey)) = ''
        THROW 50001, 'MenuKey is required.', 1;

    -- Check key uniqueness
    IF EXISTS (SELECT 1 FROM EMS.MenuItem WHERE MenuKey = @MenuKey)
        THROW 50001, 'MenuKey already exists.', 1;

    -- Insert new menu item
    INSERT INTO EMS.MenuItem
        (ParentMenuItemID, MenuName, MenuKey, FormClassName, IconKey, DisplayOrder, 
         IsActive, RequiredAppRole, Description, ModuleCode, Url, CreatedByUserID, CreatedDate)
    VALUES
        (@ParentMenuItemID, @MenuName, @MenuKey, @FormClassName, @IconKey, @DisplayOrder,
         @IsActive, @RequiredAppRole, @Description, @ModuleCode, @Url, @CreatedByUserID, GETDATE());

    -- Return the new ID
    SELECT @@IDENTITY AS MenuItemID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_UpdateMenuItem]    Script Date: 14/10/2569 9:57:59 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_UpdateMenuItem]
    @MenuItemID           INT,
    @ParentMenuItemID     INT = NULL,
    @MenuName             NVARCHAR(255),
    @MenuKey              NVARCHAR(100),
    @FormClassName        NVARCHAR(500) = NULL,
    @IconKey              NVARCHAR(100) = NULL,
    @DisplayOrder         INT = 0,
    @IsActive             BIT = 1,
    @RequiredAppRole      INT = NULL,
    @Description          NVARCHAR(500) = NULL,
    @ModuleCode           NVARCHAR(50) = NULL,
    @Url                  NVARCHAR(500) = NULL,
    @ModifiedByUserID     INT
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Validate inputs
    IF @MenuName IS NULL OR LTRIM(RTRIM(@MenuName)) = ''
        THROW 50001, 'MenuName is required.', 1;
        
    -- Check if menu exists
    IF NOT EXISTS (SELECT 1 FROM EMS.MenuItem WHERE MenuItemID = @MenuItemID)
        THROW 50001, 'MenuItem not found.', 1;
        
    -- Check key uniqueness (excluding current item)
    IF EXISTS (SELECT 1 FROM EMS.MenuItem WHERE MenuKey = @MenuKey AND MenuItemID <> @MenuItemID)
        THROW 50001, 'MenuKey already exists.', 1;
        
    -- Update menu item
    UPDATE EMS.MenuItem
    SET          ParentMenuItemID = @ParentMenuItemID,
                 MenuName = @MenuName,
                 MenuKey = @MenuKey,
                 FormClassName = @FormClassName,
                 IconKey = @IconKey,
                 DisplayOrder = @DisplayOrder,
                 IsActive = @IsActive,
                 RequiredAppRole = @RequiredAppRole,
                 Description = @Description,
                 ModuleCode = @ModuleCode,
                 Url = @Url,
                 ModifiedDate = GETDATE(),
                 ModifiedByUserID = @ModifiedByUserID
    WHERE MenuItemID = @MenuItemID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_DeleteMenuItem]    Script Date: 14/10/2569 9:57:54 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [EMS].[sp_DeleteMenuItem]
    @MenuItemID INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Check if menu exists
    IF NOT EXISTS (SELECT 1 FROM EMS.MenuItem WHERE MenuItemID = @MenuItemID)
        THROW 50001, 'MenuItem not found.', 1;

    -- Delete will cascade due to foreign key constraint
    DELETE FROM EMS.MenuItem
    WHERE MenuItemID = @MenuItemID;
END

`