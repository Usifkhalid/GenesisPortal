-- NOT APPLIED. This is not in prisma/migrations on purpose: `prisma migrate
-- deploy` would run it. Read ../README.md before moving it there (D146).
--
-- Retires the IT helpdesk from the portal's database: the 14 tables the portal
-- used before the IT Helpdesk became an app of its own (apps/helpdesk,
-- mghelpdesk), and the notification rows and switches that belonged to them.
-- IRREVERSIBLE: take a fresh backup first and check the helpdesk app holds the
-- tickets (npm run helpdesk:migrate:from-portal -- --as <email> --verify).
--
-- Not touched: AuditLog (append-only, keeps the history of what was done in the
-- portal), FileScan (rows for ticket attachments are harmless), and the files
-- under STORAGE_DIR (delete the ticket attachments there by hand once the
-- helpdesk's copy has been checked).

BEGIN TRY

BEGIN TRAN;

-- Children before parents: every foreign key is NO ACTION.
DROP TABLE [dbo].[TicketEvent];
DROP TABLE [dbo].[TicketAttachment];
DROP TABLE [dbo].[TicketComment];
DROP TABLE [dbo].[Ticket];
DROP TABLE [dbo].[TicketSequence];
DROP TABLE [dbo].[CannedReply];
DROP TABLE [dbo].[SlaPolicy];
DROP TABLE [dbo].[BusinessCalendar];
DROP TABLE [dbo].[TicketCategory];
DROP TABLE [dbo].[TicketLocation];
DROP TABLE [dbo].[Holiday];
DROP TABLE [dbo].[SupportTeamMember];
DROP TABLE [dbo].[SupportTeamCompany];
DROP TABLE [dbo].[SupportTeam];

-- The portal hides these already; the helpdesk keeps its own copies.
DELETE FROM [dbo].[Notification] WHERE [templateKey] LIKE N'ticket.%';
DELETE FROM [dbo].[NotificationPreference] WHERE [category] = N'tickets';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
