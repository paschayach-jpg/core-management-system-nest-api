`sql

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [dbo].[sp_InsertSubCommittee]    Script Date: 14/10/2569 10:18:52 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_InsertSubCommittee]
    @OrgUnitID          INT,
    @SubCommitteeCode   NVARCHAR(20),
    @SubCommitteeNameTH NVARCHAR(200),
    @SubCommitteeNameEN NVARCHAR(200) = NULL,
    @CreatedBy          NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    
    IF EXISTS (SELECT 1 FROM EMS.m_SubCommittee WHERE OrgUnitID = @OrgUnitID)
    BEGIN
        RAISERROR(N'SubCommitteeID %d มีข้อมูลอยู่ใน m_SubCommittee แล้ว', 16, 1, @OrgUnitID);
        RETURN;
    END
    
    INSERT INTO EMS.m_SubCommittee
        (OrgUnitID, SubCommitteeCode, SubCommitteeNameTH, SubCommitteeNameEN, CreatedBy)
    VALUES
        (@OrgUnitID, @SubCommitteeCode, @SubCommitteeNameTH, @SubCommitteeNameEN, @CreatedBy);
        
    SELECT SCOPE_IDENTITY() AS SubCommitteeID;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [dbo].[sp_WF_CreateDelegation]    Script Date: 14/10/2569 10:18:41 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_WF_CreateDelegation]
    @WorkflowStepInstanceId INT,
    @DelegatedFrom          NVARCHAR(100),
    @DelegatedTo            NVARCHAR(100),
    @DelegationReason       NVARCHAR(500) = NULL,
    @MaxDelegationDepth     INT = 3,
    @StartDate              DATETIME = NULL,
    @EndDate                DATETIME = NULL,
    @Remarks                NVARCHAR(500) = NULL,
    @NewWFDelegationId      INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    -- Deactivate any previous active delegation for this step instance
    UPDATE dbo.WFDelegation
    SET    IsActive = 0
    WHERE  WorkflowStepInstanceId = @WorkflowStepInstanceId
      AND  IsActive = 1;

    -- Get current depth
    DECLARE @CurrentDepth INT = 0;
    SELECT @CurrentDepth = ISNULL(MAX(DelegationDepth), 0)
    FROM   dbo.WFDelegation
    WHERE  WorkflowStepInstanceId = @WorkflowStepInstanceId
      AND  IsDeleted = 0;

    DECLARE @NewDepth INT = @CurrentDepth + 1;

    IF @NewDepth > @MaxDelegationDepth
    BEGIN
        RAISERROR('Maximum delegation depth exceeded', 16, 1);
        RETURN;
    END

    -- Insert new delegation
    INSERT INTO dbo.WFDelegation (
        WorkflowStepInstanceId,
        DelegatedFrom,
        DelegatedTo,
        DelegationReason,
        DelegationDate,
        DelegationDepth,
        IsActive,
        IsDeleted,
        StartDate,
        EndDate,
        Remarks
    ) VALUES (
        @WorkflowStepInstanceId,
        @DelegatedFrom,
        @DelegatedTo,
        @DelegationReason,
        GETDATE(),
        @NewDepth,
        1,
        0,
        @StartDate,
        @EndDate,
        @Remarks
    );

    SET @NewWFDelegationId = SCOPE_IDENTITY();
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [dbo].[sp_WF_GetDelegationHistory]    Script Date: 14/10/2569 10:18:30 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_WF_GetDelegationHistory]
    @WorkflowStepInstanceId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT WFDelegationId,
           WorkflowStepInstanceId,
           DelegatedFrom,
           DelegatedTo,
           DelegationReason,
           DelegationDate,
           DelegationDepth,
           IsActive,
           IsDeleted,
           StartDate,
           EndDate,
           Remarks
    FROM   dbo.WFDelegation
    WHERE  WorkflowStepInstanceId = @WorkflowStepInstanceId
      AND  IsDeleted = 0
    ORDER BY DelegationDepth ASC;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [dbo].[sp_WF_GetSLAComplianceMetrics]    Script Date: 14/10/2569 10:18:21 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [dbo].[sp_WF_GetSLAComplianceMetrics]
    @WorkflowDefinitionId INT      = NULL,
    @FromDate             DATETIME = NULL,
    @ToDate               DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        COUNT(*)                                                                   AS TotalSteps,
        SUM(CASE WHEN wsi.SLAStatus = '1' THEN 1 ELSE 0 END)                       AS OnTimeCount,
        SUM(CASE WHEN wsi.SLAStatus = '2' THEN 1 ELSE 0 END)                       AS AtRiskCount,
        SUM(CASE WHEN wsi.SLAStatus = '3' THEN 1 ELSE 0 END)                       AS OverdueCount,
        ISNULL(
            CAST(SUM(CASE WHEN wsi.SLAStatus = '1' THEN 1 ELSE 0 END) AS float)
            / NULLIF(COUNT(*), 0) * 100, 0)                                       AS OnTimePercent,
        ISNULL(AVG(DATEDIFF(MINUTE,
            wsi.AssignedDate,
            ISNULL(wsi.CompletedDate, GETUTCDATE())) / 60.0), 0)                 AS AvgCompletionHours
    FROM   WFE.t_WFStepInstance wsi
    INNER  JOIN WFE.t_WFInstance wi
           ON wi.WFInstanceId = wsi.WFInstanceId AND wi.IsDeleted = 0
    WHERE  wsi.IsDeleted = 0
      AND  (@WorkflowDefinitionId IS NULL OR wi.WFDefinitionId = @WorkflowDefinitionId)
      AND  (@FromDate IS NULL OR wsi.AssignedDate >= @FromDate)
      AND  (@ToDate   IS NULL OR wsi.AssignedDate <= @ToDate);
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [dbo].[sp_WF_GetTaskDistribution]    Script Date: 14/10/2569 10:17:58 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROCEDURE [dbo].[sp_WF_GetTaskDistribution]
    @WorkflowDefinitionId INT      = NULL,
    @FromDate             DATETIME = NULL,
    @ToDate               DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        wsi.AssignedTo                                                             AS AssignedTo,
        COUNT(*)                                                                   AS TotalAssigned,
        SUM(CASE WHEN wsi.Status = 3 THEN 1 ELSE 0 END)                          AS Completed,
        SUM(CASE WHEN wsi.Status NOT IN (3, 4) THEN 1 ELSE 0 END)                AS Pending,
        SUM(CASE WHEN wsi.Status = 4 THEN 1 ELSE 0 END)                          AS Rejected,
        SUM(CASE WHEN wsi.SLAStatus = '3' THEN 1 ELSE 0 END)                       AS Overdue
    FROM   WFE.t_WFStepInstance wsi
    INNER  JOIN WFE.t_WFInstance wi
           ON wi.WFInstanceId = wsi.WFInstanceId AND wi.IsDeleted = 0
    WHERE  wsi.IsDeleted = 0
      AND  wsi.AssignedTo IS NOT NULL
      AND  (@WorkflowDefinitionId IS NULL OR wi.WFDefinitionId = @WorkflowDefinitionId)
      AND  (@FromDate IS NULL OR wsi.AssignedDate >= @FromDate)
      AND  (@ToDate   IS NULL OR wsi.AssignedDate <= @ToDate)
    GROUP  BY wsi.AssignedTo
    ORDER  BY Overdue DESC, TotalAssigned DESC;
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [dbo].[sp_UpsertSystemConfig]    Script Date: 14/10/2569 10:21:16 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_UpsertSystemConfig]
    @Key              NVARCHAR(200),
    @Value            NVARCHAR(2000),
    @UpdatedByUserId  INT
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.SystemConfig WHERE ConfigKey = @Key)
    BEGIN
        UPDATE dbo.SystemConfig
        SET    ConfigValue     = @Value,
               UpdatedByUserId = @UpdatedByUserId,
               UpdatedDate     = GETDATE()
        WHERE  ConfigKey = @Key;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.SystemConfig (ConfigKey, ConfigValue, UpdatedByUserId, UpdatedDate)
        VALUES (@Key, @Value, @UpdatedByUserId, GETDATE());
    END
END

USE [CMS_DB]
GO
/****** Object:  StoredProcedure [dbo].[sp_GetSystemConfig]    Script Date: 14/10/2569 10:20:57 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_GetSystemConfig]
    @Key NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT ConfigValue
    FROM   dbo.SystemConfig
    WHERE  ConfigKey = @Key;
END

`