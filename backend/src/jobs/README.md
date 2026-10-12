Scheduled background work (notification digests, booking reminders).
Each job is a module started from server.js.

- prune-sessions.js: deletes expired Session rows at startup and then hourly.
- closeResolvedTickets.js: closes helpdesk tickets that have been Resolved for three
  working days with no reply from the requester, at startup and then every half hour.
- slaWatch.js: alerts the assignee and the team's leads at 75% and 100% of a ticket's SLA, once per
  threshold, at startup and then every five minutes.
- pinnedAnnouncements.js: announces pinned announcements that went live on a schedule, at startup
  and then every five minutes (one notification per post and person).
