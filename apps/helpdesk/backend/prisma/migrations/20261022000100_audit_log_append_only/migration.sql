-- AuditLog is append-only in the database itself, not only in lib/prisma.js:
-- any UPDATE or DELETE, from any client, is refused. INSTEAD OF, so the
-- statement is never carried out, and it fires even when no row matches.
-- Hand-written: Prisma's schema has no notion of triggers.

BEGIN TRY

BEGIN TRAN;

-- CREATE TRIGGER must be the only statement in its batch, hence EXEC.
EXEC('
CREATE TRIGGER [dbo].[AuditLog_append_only] ON [dbo].[AuditLog]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51000, ''AuditLog is append-only: UPDATE and DELETE are not allowed.'', 1;
END
');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
