BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [sid] VARCHAR(64) NOT NULL,
    [data] NVARCHAR(max) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [userId] CHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Session_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([sid])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_expiresAt_idx] ON [dbo].[Session]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

