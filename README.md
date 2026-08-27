# Air Alert

An Omarchy bar widget showing whether an air raid alert is active in the
regions of Ukraine you care about, which type it is, and how long it has been
running.


## What it does not do

**No notifications. No sound.** This is deliberate.

People living under these alerts already have phone apps, and the actual
street sirens. A fourth thing shouting in the same room is noise, not signal.
What a desktop can usefully add is a quiet, always-visible answer to "is it on
right now, and how long has it been on" — so that is all this does.

> This is a convenience indicator, not a life-safety system. Data can be
> delayed or wrong, and your machine can be offline without you noticing.
> Rely on official alerts.

## Data source

[`siren.pp.ua`](https://siren.pp.ua) — a free, keyless public mirror of the
official [UkraineAlarm](https://api.ukrainealarm.com) API.

**No API key, no registration, no sign-up.** That is why this source was
chosen over [alerts.in.ua](https://alerts.in.ua), which has better data but
issues per-user tokens by request form and rate-limits hard — every person
installing this plugin would need their own token first.

Alert types reported: `AIR`, `ARTILLERY`, `URBAN_FIGHTS`, `CHEMICAL`,
`NUCLEAR`, `INFO`.

## Install

```bash
git clone https://github.com/dfrost90/omarchy-air-alert \
  ~/.config/omarchy/plugins/io.github.dfrost90.air-alert
```

Then add it to your bar:

```bash
omarchy bar move io.github.dfrost90.air-alert --section right
```

or add `{ "id": "io.github.dfrost90.air-alert" }` to `bar.layout.right` in
`~/.config/omarchy/shell.json`, which hot-reloads on save.

## Choosing regions

Click the widget and type a region name in the search box. Both scripts work:

```
Kyiv      → м. Київ, Київська область
Львів     → Львівська область, Львівський район
Odesa     → Одеська область, Одеський район
```

Latin input is matched by romanizing the region list (KMU 2010), because the
API's region tree carries Ukrainian names only. Search also survives Ukrainian
adjectival forms, so `Odesa` finds `Одеська` and `Kremenchuk` finds
`Кременчуцький`.

Results show the region type and its parent oblast, since `Львівська область`
and `Львівський район` are otherwise indistinguishable in a list.

You can watch several regions at once. Each gets an editable display label —
handy for showing an English name for a Ukrainian region — which never changes
which region is actually monitored.

If your Omarchy weather location is set, the picker opens pre-filtered to it as
a *suggestion*. It is never applied on its own: the weather location is a city
while alert regions are oblasts and raions, and for Kyiv in particular a naive
match lands on Київська область rather than м. Київ — a different region with
different alerts.

Granularity is oblast and raion. Hromada-level regions exist in the API and can
be pinned by id in `shell.json`, but they are kept out of the picker: 1455
near-identical names would bury the 151 that are useful.

## Configuration

All optional. Pinning `regions` in `shell.json` overrides the picker.

```json
{
  "id": "io.github.dfrost90.air-alert",
  "regions": [
    { "id": "31", "label": "Kyiv" },
    { "id": "36", "label": "Vinnytskyi" }
  ],
  "pollSeconds": 15,
  "staleAfterSeconds": 60,
  "icon": "󰀦"
}
```

| Key | Default | Meaning |
|---|---|---|
| `regions` | *(picker)* | Pinned regions. Overrides the picker's saved choice. |
| `pollSeconds` | `15` | Poll interval. Minimum 5. |
| `staleAfterSeconds` | `60` | How long without a successful fetch before the data is treated as stale. Floored at `pollSeconds * 2`. |
| `icon` | `󰀦` | Bar glyph. |

Region ids can be found with `./scripts/fetch-alerts --regions | jq`.

## Reading the pill

| Shows | Meaning |
|---|---|
| glyph only | All watched regions clear. |
| `AIR 1h 24m` | Alert active, with type and elapsed time. |
| `Kyiv AIR 1h 24m` | As above, labelled — shown when watching several regions. |
| `~AIR 1h 24m` | Alert active, but the data is stale. The `~` marks the elapsed time as extrapolated from the last successful fetch. |
| `?` | Data is stale and the last known state was clear — the widget does not know. |
| `set region` | No region chosen yet. |

The important case is `~`. If the network drops during an alert, the widget
keeps showing the alert rather than falling back to "unknown". Under-reporting
an active alert is the dangerous direction; over-reporting one is merely
annoying.

Hover for per-region detail and the age of the last successful update. Middle
click forces a refresh.

## How it polls

Most ticks cost one ~45-byte request to `/api/v3/alerts/status`, which returns
a single integer that changes whenever anything changes anywhere in Ukraine.
Only when that integer moves does the widget fetch the watched regions.

Steady state is about 4 tiny requests per minute rather than 16 — worth being
polite about, since this runs 24/7 against a free community service.

## Tests

```bash
bash tests/run
```

Covers the fetch script against a stubbed `curl` (no request leaves the
machine) and every pure function in `Model.js` under node.

## Licence

MIT
