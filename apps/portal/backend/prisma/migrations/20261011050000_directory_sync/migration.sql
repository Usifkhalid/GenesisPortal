-- Directory and user sync (session 14): the company setting that shows mobile
-- numbers, the Graph fields the directory keeps, a normalised search key, and
-- the SyncRun table. Hand-written to match schema.prisma.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Company] ADD [showMobileInDirectory] BIT NOT NULL
  CONSTRAINT [Company_showMobileInDirectory_df] DEFAULT 0;

ALTER TABLE [dbo].[UserProfile] ADD
  [mobilePhone] VARCHAR(50) NULL,
  [graphDepartment] NVARCHAR(200) NULL,
  [graphCompanyName] NVARCHAR(200) NULL,
  [searchKey] NVARCHAR(1000) NOT NULL CONSTRAINT [UserProfile_searchKey_df] DEFAULT '';

CREATE TABLE [dbo].[SyncRun] (
    [id] NVARCHAR(36) NOT NULL,
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [SyncRun_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [finishedAt] DATETIME2 NULL,
    [status] VARCHAR(20) NOT NULL,
    [source] VARCHAR(20) NOT NULL,
    [requestedById] NVARCHAR(36) NULL,
    [created] INT NOT NULL CONSTRAINT [SyncRun_created_df] DEFAULT 0,
    [updated] INT NOT NULL CONSTRAINT [SyncRun_updated_df] DEFAULT 0,
    [deactivated] INT NOT NULL CONSTRAINT [SyncRun_deactivated_df] DEFAULT 0,
    [warnings] NVARCHAR(MAX) NOT NULL CONSTRAINT [SyncRun_warnings_df] DEFAULT '[]',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SyncRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SyncRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [SyncRun_startedAt_idx] ON [dbo].[SyncRun]([startedAt]);

ALTER TABLE [dbo].[SyncRun] ADD CONSTRAINT [SyncRun_requestedById_fkey]
  FOREIGN KEY ([requestedById]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
