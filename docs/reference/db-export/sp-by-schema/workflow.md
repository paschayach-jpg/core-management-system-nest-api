`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [workflow].[sp_GetApprovalRequestByID]    Script Date: 14/10/2569 10:13:59 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [workflow].[sp_GetApprovalRequestByID]
    @RequestID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT RequestID, RequestType, FolderID, FileID, PermissionID, RequestedBy,
           RequestedDate, RequestStatus, Subject, Remark, ExpiryDate,
           ResolvedBy, ResolvedDate, ResolveRemark
    FROM   workflow.ApprovalRequest
    WHERE  RequestID = @RequestID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [workflow].[sp_GetAllApprovalSteps]    Script Date: 14/10/2569 10:13:50 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [workflow].[sp_GetAllApprovalSteps]
    @RequestID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT StepID, RequestID, StepOrder, ApproverID, StepStatus,
           ActionDate, ActionRemark, DelegatedTo, NotifiedDate, EscalatedDate
    FROM   workflow.ApprovalStep
    WHERE  RequestID = @RequestID
    ORDER  BY StepOrder;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [workflow].[sp_GetExpiredPendingRequests]    Script Date: 14/10/2569 10:13:42 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [workflow].[sp_GetExpiredPendingRequests]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT RequestID, RequestType, FolderID, FileID, PermissionID, RequestedBy,
           RequestedDate, RequestStatus, Subject, Remark, ExpiryDate,
           ResolvedBy, ResolvedDate, ResolveRemark
    FROM   workflow.ApprovalRequest
    WHERE  RequestStatus = 1 AND ExpiryDate < GETDATE();
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [workflow].[sp_UpdateApprovalRequestStatus]    Script Date: 14/10/2569 10:13:35 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [workflow].[sp_UpdateApprovalRequestStatus]
    @RequestID     INT,
    @RequestStatus TINYINT,
    @ResolvedBy    INT,
    @ResolveRemark NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE workflow.ApprovalRequest
    SET    RequestStatus = @RequestStatus,
           ResolvedBy    = @ResolvedBy,
           ResolvedDate  = GETDATE(),
           ResolveRemark = @ResolveRemark
    WHERE  RequestID = @RequestID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [workflow].[sp_UpdateApprovalStepStatus]    Script Date: 14/10/2569 10:13:27 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [workflow].[sp_UpdateApprovalStepStatus]
    @StepID       INT,
    @StepStatus   TINYINT,
    @ActionRemark NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE workflow.ApprovalStep
    SET    StepStatus = @StepStatus, ActionDate = GETDATE(), ActionRemark = @ActionRemark
    WHERE  StepID = @StepID;
END

`