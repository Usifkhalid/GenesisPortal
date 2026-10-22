-- D143: "Waiting on requester" becomes "Pending"; the requester confirms that a
-- ticket is solved (and rates it); a resolved ticket stays open with its SLA
-- clock running; the auto-close rule goes.

BEGIN TRY

BEGIN TRAN;

-- The index that served the auto-close job, then its column.
DROP INDEX [Ticket_status_autoCloseAt_idx] ON [dbo].[Ticket];
ALTER TABLE [dbo].[Ticket] DROP COLUMN [autoCloseAt];

-- AlterTable
ALTER TABLE [dbo].[Ticket] ADD [closeMode] NVARCHAR(20),
[closeReason] NVARCHAR(1000),
[rating] INT,
[ratedAt] DATETIME2,
[ratingFeedback] NVARCHAR(1000);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Ticket_status_resolvedAt_idx] ON [dbo].[Ticket]([status], [resolvedAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

-- Existing rows. Separate batch: it needs the columns above to exist.
BEGIN TRY

BEGIN TRAN;

-- The status itself, and the history that names it. Safe to run twice.
UPDATE [dbo].[Ticket] SET [status] = N'Pending' WHERE [status] = N'WaitingOnRequester';
UPDATE [dbo].[TicketEvent] SET [fromValue] = N'Pending'
  WHERE [type] IN (N'status', N'reopened') AND [fromValue] = N'WaitingOnRequester';
UPDATE [dbo].[TicketEvent] SET [toValue] = N'Pending'
  WHERE [type] IN (N'status', N'reopened') AND [toValue] = N'WaitingOnRequester';

-- A notification already sent carries the status words it was sent with.
UPDATE [dbo].[Notification]
  SET [payload] = REPLACE(REPLACE([payload], N'Waiting on you', N'Pending'), N'بانتظار ردّك', N'معلّق')
  WHERE [templateKey] = 'ticket.status' AND [payload] LIKE N'%Waiting on you%';

-- A ticket resolved under the old rule had its clock stopped since it was
-- resolved. Under the new one a resolved ticket is open and its clock runs:
-- start it again from here. The due dates already leave out the time the
-- ticket spent Pending, so they stay as they are.
UPDATE [dbo].[Ticket] SET [slaPausedAt] = NULL, [slaActive] = 1 WHERE [status] = N'Resolved';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
