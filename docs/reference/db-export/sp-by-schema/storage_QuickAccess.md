`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_AddQuickAccess]    Script Date: 14/10/2569 10:10:04 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_AddQuickAccess]
    @UserID   INT,
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (
        SELECT 1 FROM storage.QuickAccessFolder
        WHERE UserID = @UserID AND FolderID = @FolderID
    )
    BEGIN
        INSERT INTO storage.QuickAccessFolder (UserID, FolderID, AddedDate)
        VALUES (@UserID, @FolderID, GETDATE());
    END
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_GetQuickAccessByUser]    Script Date: 14/10/2569 10:09:56 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_GetQuickAccessByUser]
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT qa.QuickAccessID, qa.UserID, qa.FolderID, qa.AddedDate
    FROM   storage.QuickAccessFolder qa
    WHERE  qa.UserID = @UserID
    ORDER BY qa.AddedDate DESC;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [storage].[sp_RemoveQuickAccess]    Script Date: 14/10/2569 10:09:49 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [storage].[sp_RemoveQuickAccess]
    @UserID   INT,
    @FolderID INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM storage.QuickAccessFolder
    WHERE UserID = @UserID AND FolderID = @FolderID;
END

`