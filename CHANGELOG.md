# Changelog — Ukraine Air Alert

## 1.0.0

Initial release.

- Bar pill showing air raid alert state, type and elapsed time for the
  selected regions of Ukraine.
- Panel with per-region status, recent alert history, and a region picker
  searchable in Ukrainian or Latin script.
- Passive by design: no notifications, no sound.
- An active alert outranks staleness — losing the network mid-alert keeps
  showing the alert rather than degrading to "unknown".
- All network access behind one bounded seam; every response and file read is
  capped by bytes and by count before it is retained.
