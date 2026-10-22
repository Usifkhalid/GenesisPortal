-- Session 27: a malware-scan verdict per uploaded file (files are served only
-- once "clean"), and one lease row per background job so that two app
-- instances never run the same job in the same round.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[FileScan] (
    [storageKey] NVARCHAR(200) NOT NULL,
    [state] VARCHAR(20) NOT NULL,
    [uploadedById] NVARCHAR(36),
    [fileName] NVARCHAR(200),
    [link] NVARCHAR(200),
    [scannedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FileScan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FileScan_pkey] PRIMARY KEY CLUSTERED ([storageKey])
);

-- CreateTable
CREATE TABLE [dbo].[JobLease] (
    [name] NVARCHAR(60) NOT NULL,
    [lockedUntil] DATETIME2 NOT NULL,
    [holder] NVARCHAR(100) NOT NULL,
    [lastStartedAt] DATETIME2,
    [lastFinishedAt] DATETIME2,
    [lastResult] VARCHAR(20),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [JobLease_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [JobLease_pkey] PRIMARY KEY CLUSTERED ([name])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FileScan_state_createdAt_idx] ON [dbo].[FileScan]([state], [createdAt]);

-- Files uploaded before scanning existed were accepted on their signature
-- alone. They are recorded as clean so they stay visible; nothing uploaded
-- from now on is served without a verdict of its own.
INSERT INTO [dbo].[FileScan] ([storageKey], [state], [scannedAt], [updatedAt])
SELECT [key], 'clean', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM (
    SELECT [storageKey] AS [key] FROM [dbo].[TicketAttachment]
    UNION SELECT [logoKey] FROM [dbo].[Company] WHERE [logoKey] IS NOT NULL
    UNION SELECT [coverKey] FROM [dbo].[Announcement] WHERE [coverKey] IS NOT NULL
    UNION SELECT [photoKey] FROM [dbo].[Room] WHERE [photoKey] IS NOT NULL
) AS existing;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
