Scheduled background work (notification digests, booking reminders).
Each job is a module started from server.js.

- prune-sessions.js: deletes expired Session rows at startup and then hourly.
- closeResolvedTickets.js: closes helpdesk tickets that have been Resolved for three
  working days with no reply from the requester, at startup and then every half hour.
- slaWatch.js: alerts the assignee and the team's leads at 75% and 100% of a ticket's SLA, once per
  threshold, at startup and then every five minutes.
- pinnedAnnouncements.js: announces pinned announcements that went live on a schedule, at startup
  and then every five minutes (one notification per post and person).
- syncUsers.js: the directory sync from Graph, nightly at 02:00 Cairo time.
- scanFiles.js: settles uploads still waiting for their malware-scan verdict, every minute.

Two app instances: every job takes its row in `JobLease` before it works (`lib/job-lease.js`),
so each round runs on one instance only. Timers still tick on both.
