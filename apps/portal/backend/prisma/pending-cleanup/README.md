# Pending cleanup: the portal's old helpdesk tables (D146)

`20261022020000_drop_helpdesk_tables/` drops the 14 helpdesk tables from the portal's database. **It is
not applied and `prisma migrate deploy` does not see it**, because it sits here and not in `migrations/`.
`mgportal_live` keeps the tables, with their data, as a safety copy.

## When to apply it

Only when all of these are true:

1. The IT Helpdesk app has run live for some weeks and nobody has asked for something that is only in the
   portal's copy.
2. `npm run helpdesk:migrate:from-portal -- --as <email> --verify` still says "Check passed" (it reads
   `mgportal_live` read-only), or the tickets were checked another way.
3. A fresh full backup of `mgportal_live` exists and has been test-restored (docs/DEPLOY.md, Backups).

## How

1. Edit `schema.prisma`: remove the 14 models marked DEPRECATED (SupportTeam, SupportTeamCompany,
   SupportTeamMember, TicketCategory, TicketLocation, SlaPolicy, BusinessCalendar, Holiday, TicketSequence,
   Ticket, TicketComment, TicketAttachment, TicketEvent, CannedReply) and the relation fields that point at
   them on Company (`supportTeams`, `tickets`) and UserProfile (`teamMemberships`, `ticketsRequested`,
   `ticketsCreated`, `ticketsAssigned`, `ticketComments`, `ticketAttachments`, `ticketEvents`).
2. Move the folder into `migrations/` (keep its name, which sorts last).
3. `npm run db:generate`, then `npm run db:deploy` (on the production server: the migration login, never the
   app's login; docs/DEPLOY.md).
4. Delete the ticket attachment files from the portal's STORAGE_DIR by hand.
5. Note it in docs/PROGRESS.md.

Development and test databases may simply be reset (`npm run db:reset`) once step 1 is done.
