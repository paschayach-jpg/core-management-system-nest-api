`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_InsertFolderPermission]    Script Date: 14/10/2569 10:11:58 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- security.FolderPermission
-- ============================================================

ALTER PROCEDURE [security].[sp_InsertFolderPermission]
    @FolderID       INT,
    @PrincipalType  TINYINT,
    @PrincipalID    INT,
    @CanRead        BIT,
    @CanWrite       BIT,
    @CanDelete      BIT,
    @CanModify      BIT,
    @CanFullControl BIT,
    @IsDeny         BIT,
    @ExpiryDate     DATETIME,
    @GrantedBy      INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO security.FolderPermission
        (FolderID, PrincipalType, PrincipalID, CanRead, CanWrite, CanDelete,
         CanModify, CanFullControl, IsDeny, ExpiryDate, GrantedBy)
    VALUES
        (@FolderID, @PrincipalType, @PrincipalID, @CanRead, @CanWrite, @CanDelete,
         @CanModify, @CanFullControl, @IsDeny, @ExpiryDate, @GrantedBy);
    SELECT SCOPE_IDENTITY() AS NewPermissionID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_GetPermissionsByFolder]    Script Date: 14/10/2569 10:11:45 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [security].[sp_GetPermissionsByFolder]
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PermissionID, FolderID, PrincipalType, PrincipalID,
           CanRead, CanWrite, CanDelete, CanModify, CanFullControl, IsDeny,
           ExpiryDate, GrantedBy, GrantedDate, RevokedBy, RevokedDate, RevokeReason
    FROM   security.FolderPermission
    WHERE  FolderID = @FolderID
      AND  RevokedDate IS NULL
      AND  (ExpiryDate IS NULL OR ExpiryDate > GETDATE());
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_GetAllPermissionsByFolder]    Script Date: 14/10/2569 10:11:27 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [security].[sp_GetAllPermissionsByFolder]
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PermissionID, FolderID, PrincipalType, PrincipalID,
           CanRead, CanWrite, CanDelete, CanModify, CanFullControl, IsDeny,
           ExpiryDate, GrantedBy, GrantedDate, RevokedBy, RevokedDate, RevokeReason
    FROM   security.FolderPermission
  WHERE  FolderID = @FolderID
   ORDER  BY CASE WHEN RevokedDate IS NULL THEN 0 ELSE 1 END, GrantedDate DESC;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_GetPermissionsByPrincipal]    Script Date: 14/10/2569 10:11:17 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [security].[sp_GetPermissionsByPrincipal]
    @PrincipalType TINYINT,
    @PrincipalID   INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PermissionID, FolderID, PrincipalType, PrincipalID,
           CanRead, CanWrite, CanDelete, CanModify, CanFullControl, IsDeny,
           ExpiryDate, GrantedBy, GrantedDate, RevokedBy, RevokedDate, RevokeReason
    FROM   security.FolderPermission
    WHERE  PrincipalType = @PrincipalType AND PrincipalID = @PrincipalID
      AND  RevokedDate IS NULL
      AND  (ExpiryDate IS NULL OR ExpiryDate > GETDATE());
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_RevokePermission]    Script Date: 14/10/2569 10:11:09 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [security].[sp_RevokePermission]
    @PermissionID INT,
    @RevokedBy    INT,
    @RevokeReason NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE security.FolderPermission
    SET    RevokedBy   = @RevokedBy,
           RevokedDate = GETDATE(),
           RevokeReason = @RevokeReason
    WHERE  PermissionID = @PermissionID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_InsertFilePermission]    Script Date: 14/10/2569 10:11:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [security].[sp_InsertFilePermission]
    @FileID         INT,
    @PrincipalType  TINYINT,
    @PrincipalID    INT,
    @CanRead        BIT = 1,
    @CanWrite       BIT = 0,
    @CanDelete      BIT = 0,
    @CanModify      BIT = 0,
    @CanFullControl BIT = 0,
    @IsDeny         BIT = 0,
    @ExpiryDate     DATETIME2 = NULL,
    @GrantedBy      INT,
    @CanDownload    BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO security.FilePermission (
        FileID, PrincipalType, PrincipalID,
        CanRead, CanWrite, CanDelete, CanModify, CanFullControl, CanDownload,
        IsDeny, ExpiryDate, GrantedBy, GrantedDate
    )
    VALUES (
        @FileID, @PrincipalType, @PrincipalID,
        @CanRead, @CanWrite, @CanDelete, @CanModify, @CanFullControl, @CanDownload,
        @IsDeny, @ExpiryDate, @GrantedBy, GETDATE()
    );

    SELECT SCOPE_IDENTITY() AS FilePermissionID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_GetFilePermissionsByFile]    Script Date: 14/10/2569 10:10:53 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [security].[sp_GetFilePermissionsByFile]
    @FileID INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        FilePermissionID, FileID, PrincipalType, PrincipalID,
        CanRead, CanWrite, CanDelete, CanModify, CanFullControl, CanDownload,
        IsDeny, ExpiryDate, GrantedBy, GrantedDate, RevokedBy, RevokedDate, RevokeReason
    FROM security.FilePermission
    WHERE FileID = @FileID AND RevokedDate IS NULL
    ORDER BY GrantedDate DESC;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [security].[sp_RevokeFilePermission]    Script Date: 14/10/2569 10:10:46 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [security].[sp_RevokeFilePermission]
    @FilePermissionID INT,
    @RevokedBy        INT,
    @RevokeReason     NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE security.FilePermission
    SET    RevokedBy   = @RevokedBy,
           RevokedDate = GETDATE(),
           RevokeReason = @RevokeReason
    WHERE  FilePermissionID = @FilePermissionID;
END

`