Scheduled background work. Each job is a module started from server.js through schedule.js.
The helpdesk's jobs (SLA watch, confirmation reminders) run in the IT Helpdesk app only (D146).

- prune-sessions.js: deletes expired Session rows at startup and then hourly.
- pinnedAnnouncements.js: announces pinned announcements that went live on a schedule, at startup
  and then every five minutes (one notification per post and person).
- syncUsers.js: the directory sync from Graph, nightly at 02:00 Cairo time.
- scanFiles.js: settles uploads still waiting for their malware-scan verdict, every minute.

Two app instances: every job takes its row in `JobLease` before it works (`lib/job-lease.js`),
so each round runs on one instance only. Timers still tick on both.
