-- Why a booking was cancelled (session 16): required when an administrator
-- cancels someone else's meeting, optional for the organiser.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Booking] ADD [cancelReason] NVARCHAR(500);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
