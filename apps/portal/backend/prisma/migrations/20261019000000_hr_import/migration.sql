-- Session 33: HR's staff list (npm run import:hr): staff id, employment category,
-- hire date, and which profile fields HR owns so sync leaves them alone (D140).

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[UserProfile] ADD [employmentCategory] NVARCHAR(50),
[hireDate] DATE,
[hrFields] VARCHAR(200),
[hrImportedAt] DATETIME2,
[staffId] NVARCHAR(20);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_staffId_idx] ON [dbo].[UserProfile]([staffId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

