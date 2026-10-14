`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_InsertOrgUnit]    Script Date: 14/10/2569 9:52:28 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_InsertOrgUnit]
    @OrgUnitCode    NVARCHAR(20),
    @OrgUnitNameTH  NVARCHAR(200),
    @OrgUnitNameEN  NVARCHAR(200),
    @OrgUnitType    TINYINT,
    @ParentOrgUnitID INT,
    @SortOrder      INT,
    @CreatedBy      INT
AS
BEGIN
    SET NOCOUNT ON;
    
    -- ตรวจสอบรหัสซ้ำ
    IF EXISTS (SELECT 1 FROM EMS.OrgUnit WHERE OrgUnitCode = @OrgUnitCode AND IsDeleted = 0)
    BEGIN
        RAISERROR('รหัสหน่วยงาน %s มีอยู่ในระบบแล้ว', 16, 1, @OrgUnitCode);
        RETURN;
    END
    
    -- Insert ข้อมูล
    INSERT INTO EMS.OrgUnit (
        OrgUnitCode, OrgUnitNameTH, OrgUnitNameEN, OrgUnitType,
        ParentOrgUnitID, SortOrder, CreatedBy, CreatedDate,
        IsActive, IsDeleted
    )
    VALUES (
        @OrgUnitCode, @OrgUnitNameTH, @OrgUnitNameEN, @OrgUnitType,
        @ParentOrgUnitID, @SortOrder, @CreatedBy, GETDATE(),
        1, 0
    );
    
    SELECT SCOPE_IDENTITY() AS NewOrgUnitID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_UpdateOrgUnit]    Script Date: 14/10/2569 9:52:38 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_UpdateOrgUnit]
    @OrgUnitID      INT,
    @OrgUnitNameTH  NVARCHAR(200),
    @OrgUnitNameEN  NVARCHAR(200),
    @SortOrder      INT
AS
BEGIN
    SET NOCOUNT ON;
    
    UPDATE EMS.OrgUnit
    SET    OrgUnitNameTH = @OrgUnitNameTH,
           OrgUnitNameEN = @OrgUnitNameEN,
           SortOrder     = @SortOrder
    WHERE  OrgUnitID = @OrgUnitID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetOrgUnitByID]    Script Date: 14/10/2569 9:52:47 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

ALTER PROCEDURE [EMS].[sp_GetOrgUnitByID]
    @OrgUnitID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT      OrgUnitID,
                OrgUnitCode,
                OrgUnitNameTH,
                OrgUnitNameEN,
                OrgUnitType,
                ParentOrgUnitID,
                SortOrder,
                IsActive,
                IsDeleted,
                DeletedBy,
                DeletedDate,
                CreatedBy,
                CreatedDate
    FROM EMS.OrgUnit
    WHERE OrgUnitID = @OrgUnitID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetOrgUnitHierarchy]    Script Date: 14/10/2569 9:52:55 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

ALTER PROCEDURE [EMS].[sp_GetOrgUnitHierarchy]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT    OrgUnitID,
              OrgUnitCode,
              OrgUnitNameTH,
              OrgUnitNameEN,
              OrgUnitType,
              ParentOrgUnitID,
              SortOrder,
              IsActive,
              IsDeleted,
              DeletedBy,
              DeletedDate,
              CreatedBy,
              CreatedDate
    FROM EMS.OrgUnit
    ORDER BY OrgUnitType, SortOrder, OrgUnitNameTH;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetOrgUnitByConfidentialityLevel]    Script Date: 14/10/2569 9:53:03 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

ALTER PROCEDURE [EMS].[sp_GetOrgUnitByConfidentialityLevel]
    @ConfidentialityLevel TINYINT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DISTINCT
           ou.OrgUnitID,
           ou.OrgUnitCode,
           ou.OrgUnitNameTH,
           ou.OrgUnitNameEN,
           ou.OrgUnitType,
           ou.ParentOrgUnitID,
           ou.SortOrder,
           ou.IsActive,
           ou.IsDeleted,
           ou.DeletedBy,
           ou.DeletedDate,
           ou.CreatedBy,
           ou.CreatedDate
    FROM EMS.OrgUnit ou
    INNER JOIN storage.Folder f
        ON f.OrgUnitID = ou.OrgUnitID
    WHERE ou.IsActive = 1
      AND ou.IsDeleted = 0
      AND f.ConfidentialityLevel = @ConfidentialityLevel
      AND f.IsDeleted = 0;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_HasActiveDependents]    Script Date: 14/10/2569 9:53:12 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_HasActiveDependents]
    @OrgUnitID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM storage.Folder    WHERE OrgUnitID = @OrgUnitID AND IsDeleted = 0
        UNION ALL
        SELECT 1 FROM EMS.UserAccount  WHERE OrgUnitID = @OrgUnitID AND IsActive  = 1
    )
        SELECT 1 AS HasDependents;
    ELSE
        SELECT 0 AS HasDependents;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_SoftDeleteOrgUnit]    Script Date: 14/10/2569 9:53:20 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

ALTER PROCEDURE [EMS].[sp_SoftDeleteOrgUnit]
    @OrgUnitID INT,
    @DeletedBy INT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE EMS.OrgUnit
    SET IsDeleted = 1,
        IsActive = 0,
        DeletedBy = @DeletedBy,
        DeletedDate = GETDATE()
    WHERE OrgUnitID = @OrgUnitID;
END


`