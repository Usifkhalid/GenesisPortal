BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Company] (
    [id] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(10) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [domain] NVARCHAR(255) NOT NULL,
    [accentColor] CHAR(7) NOT NULL,
    [logoUrl] NVARCHAR(500),
    [logoKey] NVARCHAR(200),
    [isActive] BIT NOT NULL CONSTRAINT [Company_isActive_df] DEFAULT 1,
    [showMobileInDirectory] BIT NOT NULL CONSTRAINT [Company_showMobileInDirectory_df] DEFAULT 0,
    [workdayStartMin] INT NOT NULL CONSTRAINT [Company_workdayStartMin_df] DEFAULT 480,
    [workdayEndMin] INT NOT NULL CONSTRAINT [Company_workdayEndMin_df] DEFAULT 1080,
    [workingDays] VARCHAR(20) NOT NULL CONSTRAINT [Company_workingDays_df] DEFAULT '0,1,2,3,4',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Company_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Company_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Company_code_key] UNIQUE NONCLUSTERED ([code]),
    CONSTRAINT [Company_domain_key] UNIQUE NONCLUSTERED ([domain])
);

-- CreateTable
CREATE TABLE [dbo].[CompanyDomain] (
    [id] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [domain] NVARCHAR(255) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CompanyDomain_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CompanyDomain_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CompanyDomain_domain_key] UNIQUE NONCLUSTERED ([domain])
);

-- CreateTable
CREATE TABLE [dbo].[Department] (
    [id] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [Department_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Department_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Department_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Department_companyId_nameEn_key] UNIQUE NONCLUSTERED ([companyId],[nameEn]),
    CONSTRAINT [Department_companyId_nameAr_key] UNIQUE NONCLUSTERED ([companyId],[nameAr])
);

-- CreateTable
CREATE TABLE [dbo].[UserProfile] (
    [id] NVARCHAR(36) NOT NULL,
    [entraObjectId] NVARCHAR(36) NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [departmentId] NVARCHAR(36),
    [displayNameEn] NVARCHAR(200) NOT NULL,
    [displayNameAr] NVARCHAR(200) NOT NULL,
    [jobTitle] NVARCHAR(200),
    [managerId] NVARCHAR(36),
    [officeLocation] NVARCHAR(200),
    [phone] VARCHAR(50),
    [mobilePhone] VARCHAR(50),
    [graphDepartment] NVARCHAR(200),
    [graphCompanyName] NVARCHAR(200),
    [staffId] NVARCHAR(20),
    [employmentCategory] NVARCHAR(50),
    [hireDate] DATE,
    [hrFields] VARCHAR(200),
    [hrImportedAt] DATETIME2,
    [searchKey] NVARCHAR(1000) NOT NULL CONSTRAINT [UserProfile_searchKey_df] DEFAULT '',
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
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(30) NOT NULL,
    [scopeCompanyId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RoleAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RoleAssignment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RoleAssignment_userId_role_scopeCompanyId_key] UNIQUE NONCLUSTERED ([userId],[role],[scopeCompanyId])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] NVARCHAR(36) NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [AuditLog_at_df] DEFAULT CURRENT_TIMESTAMP,
    [actorId] NVARCHAR(36),
    [companyId] NVARCHAR(36),
    [action] VARCHAR(100) NOT NULL,
    [entity] NVARCHAR(100) NOT NULL,
    [entityId] NVARCHAR(100),
    [before] NVARCHAR(max),
    [after] NVARCHAR(max),
    [ip] VARCHAR(45),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Notification] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [channel] VARCHAR(20) NOT NULL,
    [templateKey] VARCHAR(100) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL,
    [dedupeKey] NVARCHAR(200),
    [readAt] DATETIME2,
    [sentAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Notification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([id])
);

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

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [sid] NVARCHAR(64) NOT NULL,
    [data] NVARCHAR(max) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [userId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Session_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([sid])
);

-- CreateTable
CREATE TABLE [dbo].[FileScan] (
    [storageKey] NVARCHAR(200) NOT NULL,
    [state] VARCHAR(20) NOT NULL,
    [uploadedById] NVARCHAR(36),
    [fileName] NVARCHAR(200),
    [link] NVARCHAR(200),
    [scannedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FileScan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FileScan_pkey] PRIMARY KEY CLUSTERED ([storageKey])
);

-- CreateTable
CREATE TABLE [dbo].[JobLease] (
    [name] NVARCHAR(60) NOT NULL,
    [lockedUntil] DATETIME2 NOT NULL,
    [holder] NVARCHAR(100) NOT NULL,
    [lastStartedAt] DATETIME2,
    [lastFinishedAt] DATETIME2,
    [lastResult] VARCHAR(20),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [JobLease_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [JobLease_pkey] PRIMARY KEY CLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[SyncRun] (
    [id] NVARCHAR(36) NOT NULL,
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [SyncRun_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [finishedAt] DATETIME2,
    [status] VARCHAR(20) NOT NULL,
    [source] VARCHAR(20) NOT NULL,
    [requestedById] NVARCHAR(36),
    [created] INT NOT NULL CONSTRAINT [SyncRun_created_df] DEFAULT 0,
    [updated] INT NOT NULL CONSTRAINT [SyncRun_updated_df] DEFAULT 0,
    [deactivated] INT NOT NULL CONSTRAINT [SyncRun_deactivated_df] DEFAULT 0,
    [warnings] NVARCHAR(max) NOT NULL CONSTRAINT [SyncRun_warnings_df] DEFAULT '[]',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SyncRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SyncRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SupportTeam] (
    [id] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(10) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [servesAllCompanies] BIT NOT NULL CONSTRAINT [SupportTeam_servesAllCompanies_df] DEFAULT 1,
    [isActive] BIT NOT NULL CONSTRAINT [SupportTeam_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SupportTeam_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SupportTeam_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SupportTeam_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[SupportTeamCompany] (
    [id] NVARCHAR(36) NOT NULL,
    [teamId] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SupportTeamCompany_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SupportTeamCompany_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SupportTeamCompany_teamId_companyId_key] UNIQUE NONCLUSTERED ([teamId],[companyId])
);

-- CreateTable
CREATE TABLE [dbo].[SupportTeamMember] (
    [id] NVARCHAR(36) NOT NULL,
    [teamId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(20) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SupportTeamMember_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SupportTeamMember_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SupportTeamMember_teamId_userId_key] UNIQUE NONCLUSTERED ([teamId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[TicketCategory] (
    [id] NVARCHAR(36) NOT NULL,
    [teamId] NVARCHAR(36) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [defaultPriority] NVARCHAR(5) NOT NULL CONSTRAINT [TicketCategory_defaultPriority_df] DEFAULT 'P3',
    [sortOrder] INT NOT NULL CONSTRAINT [TicketCategory_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [TicketCategory_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TicketCategory_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TicketCategory_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TicketCategory_teamId_nameEn_key] UNIQUE NONCLUSTERED ([teamId],[nameEn])
);

-- CreateTable
CREATE TABLE [dbo].[TicketLocation] (
    [id] NVARCHAR(36) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [TicketLocation_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [TicketLocation_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TicketLocation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TicketLocation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TicketLocation_nameEn_key] UNIQUE NONCLUSTERED ([nameEn])
);

-- CreateTable
CREATE TABLE [dbo].[SlaPolicy] (
    [id] NVARCHAR(36) NOT NULL,
    [teamId] NVARCHAR(36) NOT NULL,
    [priority] NVARCHAR(5) NOT NULL,
    [firstResponseMinutes] INT NOT NULL,
    [resolveMinutes] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SlaPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SlaPolicy_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SlaPolicy_teamId_priority_key] UNIQUE NONCLUSTERED ([teamId],[priority])
);

-- CreateTable
CREATE TABLE [dbo].[BusinessCalendar] (
    [id] NVARCHAR(36) NOT NULL,
    [teamId] NVARCHAR(36) NOT NULL,
    [timeZone] NVARCHAR(64) NOT NULL CONSTRAINT [BusinessCalendar_timeZone_df] DEFAULT 'Africa/Cairo',
    [workingDays] NVARCHAR(20) NOT NULL CONSTRAINT [BusinessCalendar_workingDays_df] DEFAULT '0,1,2,3,4',
    [startMin] INT NOT NULL CONSTRAINT [BusinessCalendar_startMin_df] DEFAULT 480,
    [endMin] INT NOT NULL CONSTRAINT [BusinessCalendar_endMin_df] DEFAULT 1020,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BusinessCalendar_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BusinessCalendar_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BusinessCalendar_teamId_key] UNIQUE NONCLUSTERED ([teamId])
);

-- CreateTable
CREATE TABLE [dbo].[Holiday] (
    [id] NVARCHAR(36) NOT NULL,
    [date] NVARCHAR(10) NOT NULL,
    [nameEn] NVARCHAR(200) NOT NULL,
    [nameAr] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Holiday_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Holiday_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Holiday_date_key] UNIQUE NONCLUSTERED ([date])
);

-- CreateTable
CREATE TABLE [dbo].[TicketSequence] (
    [id] NVARCHAR(36) NOT NULL,
    [prefix] NVARCHAR(10) NOT NULL,
    [year] INT NOT NULL,
    [last] INT NOT NULL CONSTRAINT [TicketSequence_last_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TicketSequence_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TicketSequence_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TicketSequence_prefix_year_key] UNIQUE NONCLUSTERED ([prefix],[year])
);

-- CreateTable
CREATE TABLE [dbo].[Ticket] (
    [id] NVARCHAR(36) NOT NULL,
    [number] NVARCHAR(30) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [teamId] NVARCHAR(36) NOT NULL,
    [categoryId] NVARCHAR(36) NOT NULL,
    [locationId] NVARCHAR(36),
    [requesterId] NVARCHAR(36) NOT NULL,
    [createdById] NVARCHAR(36) NOT NULL,
    [source] NVARCHAR(20) NOT NULL CONSTRAINT [Ticket_source_df] DEFAULT 'portal',
    [assigneeId] NVARCHAR(36),
    [subject] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(max) NOT NULL,
    [priority] NVARCHAR(5) NOT NULL,
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [Ticket_status_df] DEFAULT 'New',
    [firstResponseDueAt] DATETIME2 NOT NULL,
    [resolveDueAt] DATETIME2 NOT NULL,
    [firstRespondedAt] DATETIME2,
    [resolvedAt] DATETIME2,
    [closedAt] DATETIME2,
    [slaPausedMinutes] INT NOT NULL CONSTRAINT [Ticket_slaPausedMinutes_df] DEFAULT 0,
    [slaPausedAt] DATETIME2,
    [nextDueAt] DATETIME2 NOT NULL,
    [nextRiskAt] DATETIME2 NOT NULL,
    [slaActive] BIT NOT NULL CONSTRAINT [Ticket_slaActive_df] DEFAULT 1,
    [closeMode] NVARCHAR(20),
    [closeReason] NVARCHAR(1000),
    [rating] INT,
    [ratingFeedback] NVARCHAR(1000),
    [ratedAt] DATETIME2,
    [assetTag] NVARCHAR(100),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Ticket_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Ticket_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Ticket_number_key] UNIQUE NONCLUSTERED ([number])
);

-- CreateTable
CREATE TABLE [dbo].[TicketComment] (
    [id] NVARCHAR(36) NOT NULL,
    [ticketId] NVARCHAR(36) NOT NULL,
    [authorId] NVARCHAR(36) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [isInternal] BIT NOT NULL CONSTRAINT [TicketComment_isInternal_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TicketComment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TicketComment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TicketAttachment] (
    [id] NVARCHAR(36) NOT NULL,
    [ticketId] NVARCHAR(36) NOT NULL,
    [commentId] NVARCHAR(36),
    [uploadedById] NVARCHAR(36) NOT NULL,
    [fileName] NVARCHAR(200) NOT NULL,
    [contentType] NVARCHAR(100) NOT NULL,
    [size] INT NOT NULL,
    [storageKey] NVARCHAR(200) NOT NULL,
    [isInternal] BIT NOT NULL CONSTRAINT [TicketAttachment_isInternal_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TicketAttachment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TicketAttachment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TicketAttachment_storageKey_key] UNIQUE NONCLUSTERED ([storageKey])
);

-- CreateTable
CREATE TABLE [dbo].[TicketEvent] (
    [id] NVARCHAR(36) NOT NULL,
    [ticketId] NVARCHAR(36) NOT NULL,
    [actorId] NVARCHAR(36),
    [type] NVARCHAR(30) NOT NULL,
    [fromValue] NVARCHAR(200),
    [toValue] NVARCHAR(200),
    [commentId] NVARCHAR(36),
    [isInternal] BIT NOT NULL CONSTRAINT [TicketEvent_isInternal_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TicketEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TicketEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CannedReply] (
    [id] NVARCHAR(36) NOT NULL,
    [teamId] NVARCHAR(36) NOT NULL,
    [titleEn] NVARCHAR(200) NOT NULL,
    [titleAr] NVARCHAR(200) NOT NULL,
    [bodyEn] NVARCHAR(max) NOT NULL,
    [bodyAr] NVARCHAR(max) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [CannedReply_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [CannedReply_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CannedReply_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CannedReply_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CompanyDomain_companyId_idx] ON [dbo].[CompanyDomain]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_companyId_isActive_idx] ON [dbo].[UserProfile]([companyId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_departmentId_idx] ON [dbo].[UserProfile]([departmentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_managerId_idx] ON [dbo].[UserProfile]([managerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProfile_staffId_idx] ON [dbo].[UserProfile]([staffId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RoleAssignment_scopeCompanyId_idx] ON [dbo].[RoleAssignment]([scopeCompanyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_companyId_at_idx] ON [dbo].[AuditLog]([companyId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog]([entity], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_actorId_at_idx] ON [dbo].[AuditLog]([actorId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_channel_readAt_createdAt_idx] ON [dbo].[Notification]([userId], [channel], [readAt], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_companyId_idx] ON [dbo].[Notification]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_dedupeKey_idx] ON [dbo].[Notification]([userId], [dedupeKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationPreference_companyId_idx] ON [dbo].[NotificationPreference]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_expiresAt_idx] ON [dbo].[Session]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FileScan_state_createdAt_idx] ON [dbo].[FileScan]([state], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SyncRun_startedAt_idx] ON [dbo].[SyncRun]([startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SupportTeamCompany_companyId_idx] ON [dbo].[SupportTeamCompany]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SupportTeamMember_userId_idx] ON [dbo].[SupportTeamMember]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TicketCategory_teamId_isActive_sortOrder_idx] ON [dbo].[TicketCategory]([teamId], [isActive], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Ticket_requesterId_status_idx] ON [dbo].[Ticket]([requesterId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Ticket_teamId_status_slaActive_nextDueAt_idx] ON [dbo].[Ticket]([teamId], [status], [slaActive], [nextDueAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Ticket_assigneeId_status_idx] ON [dbo].[Ticket]([assigneeId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Ticket_companyId_createdAt_idx] ON [dbo].[Ticket]([companyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Ticket_status_resolvedAt_idx] ON [dbo].[Ticket]([status], [resolvedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TicketComment_ticketId_createdAt_idx] ON [dbo].[TicketComment]([ticketId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TicketAttachment_ticketId_idx] ON [dbo].[TicketAttachment]([ticketId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TicketAttachment_commentId_idx] ON [dbo].[TicketAttachment]([commentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TicketEvent_ticketId_createdAt_idx] ON [dbo].[TicketEvent]([ticketId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CannedReply_teamId_isActive_sortOrder_idx] ON [dbo].[CannedReply]([teamId], [isActive], [sortOrder]);

-- AddForeignKey
ALTER TABLE [dbo].[CompanyDomain] ADD CONSTRAINT [CompanyDomain_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

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

-- AddForeignKey
ALTER TABLE [dbo].[NotificationPreference] ADD CONSTRAINT [NotificationPreference_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationPreference] ADD CONSTRAINT [NotificationPreference_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SyncRun] ADD CONSTRAINT [SyncRun_requestedById_fkey] FOREIGN KEY ([requestedById]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SupportTeamCompany] ADD CONSTRAINT [SupportTeamCompany_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[SupportTeam]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SupportTeamCompany] ADD CONSTRAINT [SupportTeamCompany_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SupportTeamMember] ADD CONSTRAINT [SupportTeamMember_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[SupportTeam]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SupportTeamMember] ADD CONSTRAINT [SupportTeamMember_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketCategory] ADD CONSTRAINT [TicketCategory_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[SupportTeam]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SlaPolicy] ADD CONSTRAINT [SlaPolicy_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[SupportTeam]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BusinessCalendar] ADD CONSTRAINT [BusinessCalendar_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[SupportTeam]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Ticket] ADD CONSTRAINT [Ticket_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Ticket] ADD CONSTRAINT [Ticket_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[SupportTeam]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Ticket] ADD CONSTRAINT [Ticket_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[TicketCategory]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Ticket] ADD CONSTRAINT [Ticket_locationId_fkey] FOREIGN KEY ([locationId]) REFERENCES [dbo].[TicketLocation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Ticket] ADD CONSTRAINT [Ticket_requesterId_fkey] FOREIGN KEY ([requesterId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Ticket] ADD CONSTRAINT [Ticket_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Ticket] ADD CONSTRAINT [Ticket_assigneeId_fkey] FOREIGN KEY ([assigneeId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketComment] ADD CONSTRAINT [TicketComment_ticketId_fkey] FOREIGN KEY ([ticketId]) REFERENCES [dbo].[Ticket]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketComment] ADD CONSTRAINT [TicketComment_authorId_fkey] FOREIGN KEY ([authorId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketAttachment] ADD CONSTRAINT [TicketAttachment_ticketId_fkey] FOREIGN KEY ([ticketId]) REFERENCES [dbo].[Ticket]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketAttachment] ADD CONSTRAINT [TicketAttachment_commentId_fkey] FOREIGN KEY ([commentId]) REFERENCES [dbo].[TicketComment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketAttachment] ADD CONSTRAINT [TicketAttachment_uploadedById_fkey] FOREIGN KEY ([uploadedById]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketEvent] ADD CONSTRAINT [TicketEvent_ticketId_fkey] FOREIGN KEY ([ticketId]) REFERENCES [dbo].[Ticket]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TicketEvent] ADD CONSTRAINT [TicketEvent_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[UserProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CannedReply] ADD CONSTRAINT [CannedReply_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[SupportTeam]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

