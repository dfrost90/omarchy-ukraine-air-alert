# Changelog — Ukraine Air Alert

## 1.0.1

- Fix: a region picked in the panel had no effect until the shell was
  restarted — the pill stayed on "set region" and nothing was fetched. The
  widget watches the state file for the picker's saves, but on a first run that
  file and its parent directory do not exist yet, and a `FileView` cannot watch
  a path that is not there. The picker now notifies the widget directly on
  save, and the widget also watches the settings directory so an externally
  edited state file is still picked up.

## 1.0.0

Initial release.

- Bar pill showing air raid alert state, type and elapsed time for the
  selected regions of Ukraine.
- Panel with per-region status, recent alert history, and a region picker
  searchable in Ukrainian or Latin script.
- Passive by design: no notifications, no sound.
- With several regions watched, a starred region decides which one the pill
  shows when more than one is alerting; it never silences the others.
- An active alert outranks staleness — losing the network mid-alert keeps
  showing the alert rather than degrading to "unknown".
- All network access behind one bounded seam; every response and file read is
  capped by bytes and by count before it is retained.
