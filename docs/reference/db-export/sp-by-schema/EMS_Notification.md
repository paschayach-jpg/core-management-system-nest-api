`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [EMS].[sp_InsertNotification]    Script Date: 14/10/2569 9:59:15 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [EMS].[sp_InsertNotification]
    @RecipientUserId INT,
    @EventType       NVARCHAR(100),
    @RelatedEntityId NVARCHAR(100) = NULL,
    @MessageText     NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO EMS.Notification (RecipientUserId, EventType, RelatedEntityId, MessageText)
    VALUES (@RecipientUserId, @EventType, @RelatedEntityId, @MessageText);
    SELECT SCOPE_IDENTITY() AS NewNotificationId;
END

`