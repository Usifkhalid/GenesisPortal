BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Announcement] (
    [id] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36),
    [titleEn] NVARCHAR(200) NOT NULL CONSTRAINT [Announcement_titleEn_df] DEFAULT '',
    [titleAr] NVARCHAR(200) NOT NULL CONSTRAINT [Announcement_titleAr_df] DEFAULT '',
    [summaryEn] NVARCHAR(400) NOT NULL CONSTRAINT [Announcement_summaryEn_df] DEFAULT '',
    [summaryAr] NVARCHAR(400) NOT NULL CONSTRAINT [Announcement_summaryAr_df] DEFAULT '',
    [bodyEn] NVARCHAR(max) NOT NULL CONSTRAINT [Announcement_bodyEn_df] DEFAULT '',
    [bodyAr] NVARCHAR(max) NOT NULL CONSTRAINT [Announcement_bodyAr_df] DEFAULT '',
    [category] NVARCHAR(20) NOT NULL,
    [coverKey] NVARCHAR(200),
    [coverUrl] NVARCHAR(500),
    [coverAltEn] NVARCHAR(300) NOT NULL CONSTRAINT [Announcement_coverAltEn_df] DEFAULT '',
    [coverAltAr] NVARCHAR(300) NOT NULL CONSTRAINT [Announcement_coverAltAr_df] DEFAULT '',
    [isPinned] BIT NOT NULL CONSTRAINT [Announcement_isPinned_df] DEFAULT 0,
    [publishAt] DATETIME2,
    [expiresAt] DATETIME2,
    [authorId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Announcement_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Announcement_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AnnouncementRead] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [announcementId] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [readAt] DATETIME2 NOT NULL CONSTRAINT [AnnouncementRead_readAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AnnouncementRead_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AnnouncementRead_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AnnouncementRead_userId_announcementId_key] UNIQUE NONCLUSTERED ([userId],[announcementId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Announcement_companyId_publishAt_idx] ON [dbo].[Announcement]([companyId], [publishAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Announcement_publishAt_idx] ON [dbo].[Announcement]([publishAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AnnouncementRead_announcementId_idx] ON [dbo].[AnnouncementRead]([announcementId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AnnouncementRead_companyId_idx] ON [dbo].[AnnouncementRead]([companyId]);

-- AddForeignKey
ALTER TABLE [dbo].[Announcement] ADD CONSTRAINT [Announcement_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Announcement] ADD CONSTRAINT [Announcement_authorId_fkey] FOREIGN KEY ([authorId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AnnouncementRead] ADD CONSTRAINT [AnnouncementRead_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AnnouncementRead] ADD CONSTRAINT [AnnouncementRead_announcementId_fkey] FOREIGN KEY ([announcementId]) REFERENCES [dbo].[Announcement]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AnnouncementRead] ADD CONSTRAINT [AnnouncementRead_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

