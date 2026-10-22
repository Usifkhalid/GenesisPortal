BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Company] (
    [id] CHAR(36) NOT NULL,
    [code] VARCHAR(10) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [domain] VARCHAR(255) NOT NULL,
    [accentColor] CHAR(7) NOT NULL,
    [logoUrl] NVARCHAR(500),
    [isActive] BIT NOT NULL CONSTRAINT [Company_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Company_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Company_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Company_code_key] UNIQUE NONCLUSTERED ([code]),
    CONSTRAINT [Company_domain_key] UNIQUE NONCLUSTERED ([domain])
);

-- CreateTable
CREATE TABLE [dbo].[Department] (
    [id] CHAR(36) NOT NULL,
    [companyId] CHAR(36) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Department_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Department_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Department_companyId_nameEn_key] UNIQUE NONCLUSTERED ([companyId],[nameEn])
);

-- CreateTable
CREATE TABLE [dbo].[UserProfile] (
    [id] CHAR(36) NOT NULL,
    [entraObjectId] CHAR(36) NOT NULL,
    [email] VARCHAR(320) NOT NULL,
    [companyId] CHAR(36) NOT NULL,
    [departmentId] CHAR(36),
    [displayNameEn] NVARCHAR(200) NOT NULL,
    [displayNameAr] NVARCHAR(200) NOT NULL,
    [jobTitle] NVARCHAR(200),
    [managerId] CHAR(36),
    [officeLocation] NVARCHAR(200),
    [phone] VARCHAR(50),
    [language] VARCHAR(5) NOT NULL CONSTRAINT [UserProfile_language_df] DEFAULT 'en',
    [isActive] BIT NOT NULL CONSTRAINT [UserProfile_isActive_df] DEFAULT 1,
    [lastSyncedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UserProfile_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UserProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserProfile_entraObjectId_key] UNIQUE NONCLUSTERED ([entraObjectId]),
    CONSTRAINT [UserProfile_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[RoleAssignment] (
    [id] CHAR(36) NOT NULL,
    [userId] CHAR(36) NOT NULL,
    [role] VARCHAR(30) NOT NULL,
    [scopeCompanyId] CHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RoleAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RoleAssignment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RoleAssignment_userId_role_scopeCompanyId_key] UNIQUE NONCLUSTERED ([userId],[role],[scopeCompanyId])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] CHAR(36) NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [AuditLog_at_df] DEFAULT CURRENT_TIMESTAMP,
    [actorId] CHAR(36),
    [companyId] CHAR(36),
    [action] VARCHAR(100) NOT NULL,
    [entity] VARCHAR(100) NOT NULL,
    [entityId] VARCHAR(100),
    [before] NVARCHAR(max),
    [after] NVARCHAR(max),
    [ip] VARCHAR(45),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Notification] (
    [id] CHAR(36) NOT NULL,
    [userId] CHAR(36) NOT NULL,
    [companyId] CHAR(36) NOT NULL,
    [channel] VARCHAR(20) NOT NULL,
    [templateKey] VARCHAR(100) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL,
    [readAt] DATETIME2,
    [sentAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Notification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_companyId_isActive_idx] ON [dbo].[UserProfile]([companyId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_departmentId_idx] ON [dbo].[UserProfile]([departmentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_managerId_idx] ON [dbo].[UserProfile]([managerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RoleAssignment_scopeCompanyId_idx] ON [dbo].[RoleAssignment]([scopeCompanyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_companyId_at_idx] ON [dbo].[AuditLog]([companyId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog]([entity], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_actorId_at_idx] ON [dbo].[AuditLog]([actorId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_readAt_createdAt_idx] ON [dbo].[Notification]([userId], [readAt], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_companyId_idx] ON [dbo].[Notification]([companyId]);

-- AddForeignKey
ALTER TABLE [dbo].[Department] ADD CONSTRAINT [Department_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_departmentId_fkey] FOREIGN KEY ([departmentId]) REFERENCES [dbo].[Department]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_managerId_fkey] FOREIGN KEY ([managerId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_scopeCompanyId_fkey] FOREIGN KEY ([scopeCompanyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

