Scheduled background work (notification digests, booking reminders).
Each job is a module started from server.js.

- prune-sessions.js: deletes expired Session rows at startup and then hourly.
