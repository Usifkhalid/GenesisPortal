-- Session.sid becomes NVARCHAR. Prisma sends every string parameter as
-- NVARCHAR; compared with a VARCHAR key SQL Server converts the column and
-- scans the table instead of seeking, and the scans of people arriving
-- together blocked on each other's new rows until one was killed as a
-- deadlock victim. Session ids are ASCII, so nothing else changes.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Session] DROP CONSTRAINT [Session_pkey];
ALTER TABLE [dbo].[Session] ALTER COLUMN [sid] NVARCHAR(64) NOT NULL;
ALTER TABLE [dbo].[Session] ADD CONSTRAINT Session_pkey PRIMARY KEY CLUSTERED ([sid]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
