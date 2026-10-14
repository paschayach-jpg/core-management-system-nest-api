`sql
USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetUserAccountByADUserName]    Script Date: 14/10/2569 9:47:12 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [EMS].[sp_GetUserAccountByADUserName]
    @ADUserName NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserID, ADUserName, DisplayName, Email, AppRole, OrgUnitID,
           ConsentGiven, ConsentDate, IsActive, LastLoginDate, CreatedBy, CreatedDate,
           EmployeeCode, EmployeeTitleNameEn, EmployeeFirstNameEn, EmployeeLastNameEn,
           EmployeeTitleNameTh, EmployeeFirstNameTh, EmployeeLastNameTh,
           DepartmentId, DepartmentCode, DepartmentName, DepartmentNameEn,
           DivisionId, DivisionCode, DivisionName, DivisionNameEn,
           PositionName, LevelCode, UpdatedAt
    FROM   EMS.UserAccount
    WHERE  ADUserName = @ADUserName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetUserAccountByID]    Script Date: 14/10/2569 9:48:28 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [EMS].[sp_GetUserAccountByID]
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserID, ADUserName, DisplayName, Email, AppRole, OrgUnitID,
           ConsentGiven, ConsentDate, IsActive, LastLoginDate, CreatedBy, CreatedDate,
           EmployeeCode, EmployeeTitleNameEn, EmployeeFirstNameEn, EmployeeLastNameEn,
           EmployeeTitleNameTh, EmployeeFirstNameTh, EmployeeLastNameTh,
           DepartmentId, DepartmentCode, DepartmentName, DepartmentNameEn,
           DivisionId, DivisionCode, DivisionName, DivisionNameEn,
           PositionName, LevelCode, UpdatedAt
    FROM   EMS.UserAccount
    WHERE  UserID = @UserID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetUserAccountsByRole]    Script Date: 14/10/2569 9:49:14 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
 

-- 4. sp_GetUserAccountsByRole
ALTER PROCEDURE [EMS].[sp_GetUserAccountsByRole]
    @AppRole TINYINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserID, ADUserName, DisplayName, Email, AppRole, OrgUnitID,
           ConsentGiven, ConsentDate, IsActive, LastLoginDate, CreatedBy, CreatedDate,
           EmployeeCode, EmployeeTitleNameEn, EmployeeFirstNameEn, EmployeeLastNameEn,
           EmployeeTitleNameTh, EmployeeFirstNameTh, EmployeeLastNameTh,
           DepartmentId, DepartmentCode, DepartmentName, DepartmentNameEn,
           DivisionId, DivisionCode, DivisionName, DivisionNameEn,
           PositionName, LevelCode, UpdatedAt
    FROM   EMS.UserAccount
    WHERE  AppRole = @AppRole AND IsActive = 1;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_GetAllUserAccounts]    Script Date: 14/10/2569 9:49:36 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [EMS].[sp_GetAllUserAccounts]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserID, ADUserName, DisplayName, Email, AppRole, OrgUnitID,
           ConsentGiven, ConsentDate, IsActive, LastLoginDate, CreatedBy, CreatedDate,
           EmployeeCode, EmployeeTitleNameEn, EmployeeFirstNameEn, EmployeeLastNameEn,
           EmployeeTitleNameTh, EmployeeFirstNameTh, EmployeeLastNameTh,
           DepartmentId, DepartmentCode, DepartmentName, DepartmentNameEn,
           DivisionId, DivisionCode, DivisionName, DivisionNameEn,
           PositionName, LevelCode, UpdatedAt
    FROM   EMS.UserAccount
    ORDER  BY ADUserName;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_InsertUserAccount]    Script Date: 14/10/2569 9:49:52 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_InsertUserAccount]
    @ADUserName  NVARCHAR(100),
    @DisplayName NVARCHAR(200),
    @Email       NVARCHAR(254),
    @AppRole     TINYINT,
    @OrgUnitID   INT,
    @CreatedBy   INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO EMS.UserAccount (ADUserName, DisplayName, Email, AppRole, OrgUnitID, CreatedBy)
    VALUES (@ADUserName, @DisplayName, @Email, @AppRole, @OrgUnitID, @CreatedBy);
    SELECT SCOPE_IDENTITY() AS NewUserID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_UpdateLastLogin]    Script Date: 14/10/2569 9:50:05 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_UpdateLastLogin]
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE EMS.UserAccount SET LastLoginDate = GETDATE() WHERE UserID = @UserID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_UpdateUserConsent]    Script Date: 14/10/2569 9:50:23 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_UpdateUserConsent]
    @UserID      INT,
    @Email       NVARCHAR(254),
    @ConsentGiven BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE EMS.UserAccount
    SET    Email        = @Email,
           ConsentGiven = @ConsentGiven,
           ConsentDate  = CASE WHEN @ConsentGiven = 1 THEN GETDATE() ELSE NULL END
    WHERE  UserID = @UserID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_DeactivateUserAccount]    Script Date: 14/10/2569 9:50:35 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_DeactivateUserAccount]
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE EMS.UserAccount SET IsActive = 0 WHERE UserID = @UserID;
END

`