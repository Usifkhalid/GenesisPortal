-- Every string key and lookup column becomes NVARCHAR (docs/DECISIONS.md D57).
-- Prisma sends string parameters as NVARCHAR; against a CHAR or VARCHAR column
-- SQL Server converts the column side and scans instead of seeking. Existing
-- ids, codes and emails are ASCII, so the data is kept as is.
-- Order: foreign keys, then the unique constraints, indexes and primary keys
-- that contain a changed column, then the columns, then all of it again.
-- Hand-written: Prisma's diff would not produce the drop and re-add cleanly.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Department] DROP CONSTRAINT [Department_companyId_fkey];
ALTER TABLE [dbo].[UserProfile] DROP CONSTRAINT [UserProfile_companyId_fkey];
ALTER TABLE [dbo].[UserProfile] DROP CONSTRAINT [UserProfile_departmentId_fkey];
ALTER TABLE [dbo].[UserProfile] DROP CONSTRAINT [UserProfile_managerId_fkey];
ALTER TABLE [dbo].[RoleAssignment] DROP CONSTRAINT [RoleAssignment_userId_fkey];
ALTER TABLE [dbo].[RoleAssignment] DROP CONSTRAINT [RoleAssignment_scopeCompanyId_fkey];
ALTER TABLE [dbo].[AuditLog] DROP CONSTRAINT [AuditLog_actorId_fkey];
ALTER TABLE [dbo].[AuditLog] DROP CONSTRAINT [AuditLog_companyId_fkey];
ALTER TABLE [dbo].[Notification] DROP CONSTRAINT [Notification_userId_fkey];
ALTER TABLE [dbo].[Notification] DROP CONSTRAINT [Notification_companyId_fkey];

ALTER TABLE [dbo].[Company] DROP CONSTRAINT [Company_code_key];
ALTER TABLE [dbo].[Company] DROP CONSTRAINT [Company_domain_key];
ALTER TABLE [dbo].[Department] DROP CONSTRAINT [Department_companyId_nameEn_key];
ALTER TABLE [dbo].[UserProfile] DROP CONSTRAINT [UserProfile_entraObjectId_key];
ALTER TABLE [dbo].[UserProfile] DROP CONSTRAINT [UserProfile_email_key];
ALTER TABLE [dbo].[RoleAssignment] DROP CONSTRAINT [RoleAssignment_userId_role_scopeCompanyId_key];
DROP INDEX [UserProfile_companyId_isActive_idx] ON [dbo].[UserProfile];
DROP INDEX [UserProfile_departmentId_idx] ON [dbo].[UserProfile];
DROP INDEX [UserProfile_managerId_idx] ON [dbo].[UserProfile];
DROP INDEX [RoleAssignment_scopeCompanyId_idx] ON [dbo].[RoleAssignment];
DROP INDEX [AuditLog_companyId_at_idx] ON [dbo].[AuditLog];
DROP INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog];
DROP INDEX [AuditLog_actorId_at_idx] ON [dbo].[AuditLog];
DROP INDEX [Notification_userId_readAt_createdAt_idx] ON [dbo].[Notification];
DROP INDEX [Notification_companyId_idx] ON [dbo].[Notification];
DROP INDEX [Session_userId_idx] ON [dbo].[Session];
ALTER TABLE [dbo].[Company] DROP CONSTRAINT [Company_pkey];
ALTER TABLE [dbo].[Department] DROP CONSTRAINT [Department_pkey];
ALTER TABLE [dbo].[UserProfile] DROP CONSTRAINT [UserProfile_pkey];
ALTER TABLE [dbo].[RoleAssignment] DROP CONSTRAINT [RoleAssignment_pkey];
ALTER TABLE [dbo].[AuditLog] DROP CONSTRAINT [AuditLog_pkey];
ALTER TABLE [dbo].[Notification] DROP CONSTRAINT [Notification_pkey];

ALTER TABLE [dbo].[Company] ALTER COLUMN [id] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[Company] ALTER COLUMN [code] NVARCHAR(10) NOT NULL;
ALTER TABLE [dbo].[Company] ALTER COLUMN [domain] NVARCHAR(255) NOT NULL;
ALTER TABLE [dbo].[Department] ALTER COLUMN [id] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[Department] ALTER COLUMN [companyId] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[UserProfile] ALTER COLUMN [id] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[UserProfile] ALTER COLUMN [entraObjectId] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[UserProfile] ALTER COLUMN [email] NVARCHAR(320) NOT NULL;
ALTER TABLE [dbo].[UserProfile] ALTER COLUMN [companyId] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[UserProfile] ALTER COLUMN [departmentId] NVARCHAR(36) NULL;
ALTER TABLE [dbo].[UserProfile] ALTER COLUMN [managerId] NVARCHAR(36) NULL;
ALTER TABLE [dbo].[RoleAssignment] ALTER COLUMN [id] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[RoleAssignment] ALTER COLUMN [userId] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[RoleAssignment] ALTER COLUMN [role] NVARCHAR(30) NOT NULL;
ALTER TABLE [dbo].[RoleAssignment] ALTER COLUMN [scopeCompanyId] NVARCHAR(36) NULL;
ALTER TABLE [dbo].[AuditLog] ALTER COLUMN [id] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[AuditLog] ALTER COLUMN [actorId] NVARCHAR(36) NULL;
ALTER TABLE [dbo].[AuditLog] ALTER COLUMN [companyId] NVARCHAR(36) NULL;
ALTER TABLE [dbo].[AuditLog] ALTER COLUMN [entity] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[AuditLog] ALTER COLUMN [entityId] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[Notification] ALTER COLUMN [id] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[Notification] ALTER COLUMN [userId] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[Notification] ALTER COLUMN [companyId] NVARCHAR(36) NOT NULL;
ALTER TABLE [dbo].[Session] ALTER COLUMN [userId] NVARCHAR(36) NULL;

ALTER TABLE [dbo].[Company] ADD CONSTRAINT [Company_pkey] PRIMARY KEY CLUSTERED ([id]);
ALTER TABLE [dbo].[Department] ADD CONSTRAINT [Department_pkey] PRIMARY KEY CLUSTERED ([id]);
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_pkey] PRIMARY KEY CLUSTERED ([id]);
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_pkey] PRIMARY KEY CLUSTERED ([id]);
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id]);
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([id]);
ALTER TABLE [dbo].[Company] ADD CONSTRAINT [Company_code_key] UNIQUE NONCLUSTERED ([code]);
ALTER TABLE [dbo].[Company] ADD CONSTRAINT [Company_domain_key] UNIQUE NONCLUSTERED ([domain]);
ALTER TABLE [dbo].[Department] ADD CONSTRAINT [Department_companyId_nameEn_key] UNIQUE NONCLUSTERED ([companyId], [nameEn]);
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_entraObjectId_key] UNIQUE NONCLUSTERED ([entraObjectId]);
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_email_key] UNIQUE NONCLUSTERED ([email]);
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_userId_role_scopeCompanyId_key] UNIQUE NONCLUSTERED ([userId], [role], [scopeCompanyId]);
CREATE NONCLUSTERED INDEX [UserProfile_companyId_isActive_idx] ON [dbo].[UserProfile]([companyId], [isActive]);
CREATE NONCLUSTERED INDEX [UserProfile_departmentId_idx] ON [dbo].[UserProfile]([departmentId]);
CREATE NONCLUSTERED INDEX [UserProfile_managerId_idx] ON [dbo].[UserProfile]([managerId]);
CREATE NONCLUSTERED INDEX [RoleAssignment_scopeCompanyId_idx] ON [dbo].[RoleAssignment]([scopeCompanyId]);
CREATE NONCLUSTERED INDEX [AuditLog_companyId_at_idx] ON [dbo].[AuditLog]([companyId], [at]);
CREATE NONCLUSTERED INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog]([entity], [entityId]);
CREATE NONCLUSTERED INDEX [AuditLog_actorId_at_idx] ON [dbo].[AuditLog]([actorId], [at]);
CREATE NONCLUSTERED INDEX [Notification_userId_readAt_createdAt_idx] ON [dbo].[Notification]([userId], [readAt], [createdAt]);
CREATE NONCLUSTERED INDEX [Notification_companyId_idx] ON [dbo].[Notification]([companyId]);
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

ALTER TABLE [dbo].[Department] ADD CONSTRAINT [Department_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_departmentId_fkey] FOREIGN KEY ([departmentId]) REFERENCES [dbo].[Department]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[UserProfile] ADD CONSTRAINT [UserProfile_managerId_fkey] FOREIGN KEY ([managerId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_scopeCompanyId_fkey] FOREIGN KEY ([scopeCompanyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
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
