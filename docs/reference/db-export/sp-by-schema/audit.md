`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [audit].[sp_InsertAuditLog]    Script Date: 14/10/2569 10:15:26 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER   PROCEDURE [audit].[sp_InsertAuditLog]
        @UserID       INT,
        @UserName     NVARCHAR(100),
        @UserRole     TINYINT,
        @Module       VARCHAR(50),
        @Action       VARCHAR(50),
        @TableName    VARCHAR(100),
        @RecordID     INT,
        @OldValue     NVARCHAR(MAX),
        @NewValue     NVARCHAR(MAX),
        @IPAddress    VARCHAR(45),
        @MachineName  NVARCHAR(100),
        @SessionID    NVARCHAR(100),
        @Result       TINYINT,
        @ErrorMessage NVARCHAR(500),
        @AuditDate    DATETIME = NULL
    AS
    BEGIN
        SET NOCOUNT ON;

        INSERT INTO audit.AuditLog
            (AuditDate, UserID, UserName, UserRole, Module, Action,
             TableName, RecordID, OldValue, NewValue,
             IPAddress, MachineName, SessionID, Result, ErrorMessage)
        VALUES
            (ISNULL(@AuditDate, GETDATE()), @UserID, @UserName, @UserRole, @Module, @Action,
             @TableName, @RecordID, @OldValue, @NewValue,
             @IPAddress, @MachineName, @SessionID, @Result, @ErrorMessage);

        SELECT CONVERT(BIGINT, SCOPE_IDENTITY()) AS NewAuditID;
    END
	
USE [CMS_DB]
GO
/****** Object:  StoredProcedure [audit].[sp_QueryAuditLog]    Script Date: 14/10/2569 10:15:19 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO


ALTER PROCEDURE [audit].[sp_QueryAuditLog]
    @FromDate   DATETIME,
    @ToDate     DATETIME,
    @UserID     INT,
    @UserName   NVARCHAR(200),
    @Module     NVARCHAR(100),
    @Action     NVARCHAR(100),
    @Result     TINYINT,
    @PageNumber INT,
    @PageSize   INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Offset INT = (@PageNumber - 1) * @PageSize;
    SELECT COUNT(*) OVER () AS TotalCount,
           AuditID, AuditDate, UserID, UserName, UserRole, Module, Action,
           TableName, RecordID, OldValue, NewValue, IPAddress, MachineName,
           SessionID, Result, ErrorMessage
    FROM   audit.AuditLog
    WHERE  AuditDate >= @FromDate AND AuditDate <= @ToDate
      AND  (@UserID   IS NULL OR UserID   = @UserID)
      AND  (@UserName IS NULL OR UserName LIKE '%' + @UserName + '%')
      AND  (@Module   IS NULL OR Module   = @Module)
      AND  (@Action   IS NULL OR Action   = @Action)
      AND  (@Result   IS NULL OR Result   = @Result)
    ORDER  BY AuditDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
`