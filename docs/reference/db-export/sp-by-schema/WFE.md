`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [WFE].[sp_CreateWFInstance]    Script Date: 14/10/2569 10:16:29 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Create stored procedure for creating workflow instances
ALTER PROCEDURE [WFE].[sp_CreateWFInstance]
    @WFDefinitionId INT,
    @TemplateVersion INT,
    @InitiatedBy NVARCHAR(255),
    @InputParameters NVARCHAR(MAX) = NULL,
    @NewWFInstanceId INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON
    INSERT INTO WFE.t_WFInstance (WFDefinitionId, TemplateVersion, Status, InitiatedBy, InitiatedDate, InputParameters, IsDeleted)
    VALUES (@WFDefinitionId, @TemplateVersion, 0, @InitiatedBy, GETUTCDATE(), @InputParameters, 0)

    SET @NewWFInstanceId = SCOPE_IDENTITY()
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [WFE].[sp_CreateWFStepInstance]    Script Date: 14/10/2569 10:16:21 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [WFE].[sp_CreateWFStepInstance]
     @WFInstanceId INT = NULL,
    @WFStepId INT = NULL,
    @WorkflowInstanceId INT = NULL,
    @WorkflowStepId INT = NULL,
    @AssignedTo NVARCHAR(255) = NULL,
    @SLADeadline DATETIME = NULL,
    @NewWFStepInstanceId INT = NULL OUTPUT,
    @NewWorkflowStepInstanceId INT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ResolvedWFInstanceId INT = COALESCE(@WFInstanceId, @WorkflowInstanceId);
    DECLARE @ResolvedWFStepId INT = COALESCE(@WFStepId, @WorkflowStepId);
    DECLARE @NewWorkflowId INT;

    IF @ResolvedWFInstanceId IS NULL OR @ResolvedWFStepId IS NULL
    BEGIN
        RAISERROR('WFInstanceId and WFStepId are required.', 16, 1);
        RETURN;
    END;

    IF @AssignedTo IS NULL OR @AssignedTo = ''
    BEGIN
        SELECT @AssignedTo = InitiatedBy FROM WFE.t_WFInstance WHERE WFInstanceId = @ResolvedWFInstanceId;
    END;

    IF @AssignedTo IS NULL OR @AssignedTo = ''
        SET @AssignedTo = 'system';

    BEGIN TRAN;

    SELECT @NewWorkflowId = ISNULL(MAX(WorkflowStepInstanceId), 0) + 1
    FROM WFE.t_WFStepInstance WITH (TABLOCKX, HOLDLOCK);

    INSERT INTO WFE.t_WFStepInstance
        (WorkflowStepInstanceId, WFInstanceId, WFStepId, Status, AssignedTo, AssignedDate, StartedDate, SLADeadline, SLAStatus, IsDeleted)
    VALUES
        (@NewWorkflowId, @ResolvedWFInstanceId, @ResolvedWFStepId, 1, @AssignedTo, GETDATE(), GETDATE(),
         CASE WHEN @SLADeadline IS NULL THEN NULL ELSE CONVERT(NVARCHAR(100), @SLADeadline, 126) END,
         N'1', 0);

    SET @NewWFStepInstanceId = CONVERT(INT, SCOPE_IDENTITY());  -- single call, not two
    SET @NewWorkflowStepInstanceId = @NewWFStepInstanceId;

    COMMIT;
END;

`