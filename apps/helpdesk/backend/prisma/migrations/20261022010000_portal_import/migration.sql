-- The portal's helpdesk data moves here (D145): a map of what was copied, and
-- a marker on the audit rows that came from the portal. Adding a column is not
-- an UPDATE, so the append-only trigger does not object.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[AuditLog] ADD [origin] VARCHAR(20);

-- CreateTable
CREATE TABLE [dbo].[PortalImport] (
    [id] NVARCHAR(36) NOT NULL,
    [entity] NVARCHAR(60) NOT NULL,
    [sourceId] NVARCHAR(200) NOT NULL,
    [targetId] NVARCHAR(200) NOT NULL,
    [runId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PortalImport_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PortalImport_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PortalImport_entity_sourceId_key] UNIQUE NONCLUSTERED ([entity],[sourceId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PortalImport_entity_targetId_idx] ON [dbo].[PortalImport]([entity], [targetId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
