-- Company admin (session 8): departments can be deactivated and must be unique
-- in Arabic too, a company can own several mail domains, and an uploaded logo
-- keeps its storage key. Hand-written to match schema.prisma.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Company] ADD [logoKey] NVARCHAR(200) NULL;
ALTER TABLE [dbo].[Department] ADD [isActive] BIT NOT NULL CONSTRAINT [Department_isActive_df] DEFAULT 1;

CREATE UNIQUE NONCLUSTERED INDEX [Department_companyId_nameAr_key]
  ON [dbo].[Department]([companyId], [nameAr]);

CREATE TABLE [dbo].[CompanyDomain] (
    [id] NVARCHAR(36) NOT NULL,
    [companyId] NVARCHAR(36) NOT NULL,
    [domain] NVARCHAR(255) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CompanyDomain_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CompanyDomain_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CompanyDomain_domain_key] UNIQUE NONCLUSTERED ([domain])
);

CREATE NONCLUSTERED INDEX [CompanyDomain_companyId_idx] ON [dbo].[CompanyDomain]([companyId]);

ALTER TABLE [dbo].[CompanyDomain] ADD CONSTRAINT [CompanyDomain_companyId_fkey]
  FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Each company's existing domain becomes its first CompanyDomain row.
INSERT INTO [dbo].[CompanyDomain] ([id], [companyId], [domain], [updatedAt])
SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())), [id], [domain], CURRENT_TIMESTAMP FROM [dbo].[Company];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
