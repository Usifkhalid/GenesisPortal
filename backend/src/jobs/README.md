Scheduled background work (notification digests, booking reminders).
Each job is a module started from server.js.

- prune-sessions.js: deletes expired Session rows at startup and then hourly.
- closeResolvedTickets.js: closes helpdesk tickets that have been Resolved for three
  working days with no reply from the requester, at startup and then every half hour.
