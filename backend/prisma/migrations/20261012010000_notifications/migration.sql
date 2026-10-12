-- Notifications (session 22): a key that stops the same alert reaching a
-- person twice, an index for "my in-app notifications, unread first", and
-- one row per person, category and channel for their preferences.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Notification] ADD [dedupeKey] NVARCHAR(200);

-- DropIndex
DROP INDEX [Notification_userId_readAt_createdAt_idx] ON [dbo].[Notification];

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_channel_readAt_createdAt_idx] ON [dbo].[Notification]([userId], [channel], [readAt], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_dedupeKey_idx] ON [dbo].[Notification]([userId], [dedupeKey]);

-- CreateTable
CREATE TABLE [dbo].[NotificationPreference] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [category] VARCHAR(30) NOT NULL,
    [channel] VARCHAR(20) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [NotificationPreference_enabled_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationPreference_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NotificationPreference_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NotificationPreference_userId_category_channel_key] UNIQUE NONCLUSTERED ([userId],[category],[channel])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationPreference_companyId_idx] ON [dbo].[NotificationPreference]([companyId]);

-- AddForeignKey
ALTER TABLE [dbo].[NotificationPreference] ADD CONSTRAINT [NotificationPreference_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationPreference] ADD CONSTRAINT [NotificationPreference_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
