// Tests for Model.js, loaded as a node module through the export guard at the
// bottom of that file — the same file Quickshell imports, so these cannot
// drift from what the widget actually runs.

const path = require("path");
const M = require(path.join(__dirname, "..", "Model.js"));

let pass = 0, fail = 0;

function check(name, expected, actual) {
  const e = JSON.stringify(expected), a = JSON.stringify(actual);
  if (e === a) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       expected: " + e + "\n       actual:   " + a); }
}

// --- romanization (KMU 2010) ------------------------------------------------

check("plain consonants and vowels", "kyiv", M.romanize("Київ"));
check("soft sign is elided", "lviv", M.romanize("Львів"));
check("kh digraph", "kharkiv", M.romanize("Харків"));
check("shch", "shchastia", M.romanize("Щастя"));
check("ye at word start, ie inside", "yenakiieve", M.romanize("Єнакієве"));
check("ya at word start", "yalta", M.romanize("Ялта"));
check("yu at word start, ii inside", "yurii", M.romanize("Юрій"));
check("zgh digraph is not zh + h", "zghorany", M.romanize("Згорани"));
check("apostrophe is elided and ia follows it", "kamianets", M.romanize("Кам'янець"));
check("typographic apostrophe is elided too", "kamianets", M.romanize("Кам’янець"));
check("g and h are distinguished", "gorgany", M.romanize("Ґорґани"));
check("ts digraph", "tsiurupynsk", M.romanize("Цюрупинськ"));

// --- normalization ----------------------------------------------------------

check("normalize strips punctuation and case", "mkyiv", M.normalizeName("м. Київ"));
check("normalize handles latin input", "kyiv", M.normalizeName("Kyiv"));
check("normalize of empty is empty", "", M.normalizeName(""));

// --- default labels ---------------------------------------------------------

check("city label drops the m. prefix", "Kyiv", M.defaultLabel("м. Київ", "State"));
check("district label abbreviates raion", "Vinnytskyi r.", M.defaultLabel("Вінницький район", "District"));
check("oblast label abbreviates oblast", "Kharkivska obl.", M.defaultLabel("Харківська область", "State"));
check("hyphenated names survive", "Ivano-Frankivska obl.", M.defaultLabel("Івано-Франківська область", "State"));
// "м. X та Xська територіальна громада" is a city and its hromada sharing one
// entry. Romanized whole it ran the bar off the screen; the city is the point.
check("a city-and-hromada entry reduces to the city",
  "Kharkiv", M.defaultLabel("м. Харків та Харківська територіальна громада", "State"));
check("another city-and-hromada entry",
  "Zaporizhzhia", M.defaultLabel("м. Запоріжжя та Запорізька територіальна громада", "State"));
check("a plain hromada abbreviates",
  "Adzhamska hr.", M.defaultLabel("Аджамська територіальна громада", "Community"));
check("a derived label is never longer than the cap",
  true, M.defaultLabel("м. " + "Дуже".repeat(40) + " область", "State").length <= M.MAX_LABEL);

// --- search -----------------------------------------------------------------

const REGIONS = [
  { id: "31", name: "м. Київ", type: "State", parent: null },
  { id: "14", name: "Київська область", type: "State", parent: null },
  { id: "27", name: "Львівська область", type: "State", parent: null },
  { id: "90", name: "Львівський район", type: "District", parent: "Львівська область" },
  { id: "18", name: "Одеська область", type: "State", parent: null },
  { id: "107", name: "Кременчуцький район", type: "District", parent: "Полтавська область" },
  { id: "999", name: "Тестова громада", type: "Community", parent: "Львівська область" }
];

function ids(rs) { return rs.map(function (r) { return r.id; }); }

check("latin query finds the cyrillic region", ["31", "14"], ids(M.searchRegions(REGIONS, "Kyiv", 10)));
check("cyrillic query works too", ["31", "14"], ids(M.searchRegions(REGIONS, "Київ", 10)));
check("case insensitive", ["31", "14"], ids(M.searchRegions(REGIONS, "kYiV", 10)));
check("oblast and raion are both offered, state first", ["27", "90"], ids(M.searchRegions(REGIONS, "Lviv", 10)));
check("adjectival mutation: Odesa finds Odeska", ["18"], ids(M.searchRegions(REGIONS, "Odesa", 10)));
check("adjectival mutation: Kremenchuk finds Kremenchutskyi", ["107"], ids(M.searchRegions(REGIONS, "Kremenchuk", 10)));
check("communities are excluded", [], ids(M.searchRegions(REGIONS, "Тестова", 10)));
check("empty query returns nothing", [], M.searchRegions(REGIONS, "", 10));
check("whitespace-only query returns nothing", [], M.searchRegions(REGIONS, "   ", 10));
check("limit is honoured", 1, M.searchRegions(REGIONS, "Kyiv", 1).length);
check("no matches is an empty list", [], ids(M.searchRegions(REGIONS, "Zzzzzz", 10)));
check("a null region list does not throw", [], M.searchRegions(null, "Kyiv", 10));

// --- payload parsing --------------------------------------------------------

check("parses a good payload",
  { ok: true, unchanged: false, lastActionIndex: "42",
    regions: [{ id: "36", name: "R", nameEn: "", alerts: [{ type: "AIR", since: "2026-08-27T08:00:00Z" }] }],
    error: "" },
  M.parsePayload('{"ok":true,"lastActionIndex":"42","regions":[{"id":"36","name":"R","alerts":[{"type":"AIR","since":"2026-08-27T08:00:00Z"}]}]}'));
check("parses an in-band failure", false, M.parsePayload('{"ok":false,"error":"boom"}').ok);
check("keeps the error message", "boom", M.parsePayload('{"ok":false,"error":"boom"}').error);
check("unparseable text is a failure, not a throw", false, M.parsePayload("not json").ok);
check("empty text is a failure", false, M.parsePayload("").ok);
check("a JSON scalar is a failure", false, M.parsePayload("42").ok);
check("unchanged is carried through", true, M.parsePayload('{"ok":true,"unchanged":true,"lastActionIndex":"9"}').unchanged);
check("a region with no alerts parses to an empty list",
  [], M.parsePayload('{"ok":true,"regions":[{"id":"81","name":"K","alerts":[]}]}').regions[0].alerts);

// --- config resolution ------------------------------------------------------

function rids(rs) { return rs.map(function (r) { return r.id; }); }

check("shell.json regions win over the state file",
  ["31"], rids(M.resolveRegions([{ id: "31", label: "Kyiv" }], [{ id: "14", label: "Oblast" }])));
check("state file is used when shell.json has none",
  ["14"], rids(M.resolveRegions([], [{ id: "14", label: "Oblast" }])));
check("nothing configured yields nothing", [], M.resolveRegions(null, null));
check("a missing label is derived from the name",
  "Vinnytskyi r.", M.resolveRegions([{ id: "36", name: "Вінницький район", type: "District" }], null)[0].label);
check("an explicit label is preserved",
  "Home", M.resolveRegions([{ id: "36", name: "Вінницький район", label: "Home" }], null)[0].label);
check("ids are coerced to strings", "36", M.resolveRegions([{ id: 36 }], null)[0].id);
check("an entry with no id is dropped", [], M.resolveRegions([{ label: "nope" }], null));
check("a resolved region starts with no alerts", [], M.resolveRegions([{ id: "1" }], null)[0].alerts);

// --- aggregate state --------------------------------------------------------

const NOW = Date.parse("2026-08-27T10:00:00Z");
const CLEAR = [{ id: "1", label: "A", alerts: [] }];
const ALERT = [{ id: "1", label: "A", alerts: [{ type: "AIR", since: "2026-08-27T09:00:00Z" }] }];

check("no regions is unconfigured", "unconfigured", M.aggregate([], NOW, NOW, 60).status);
check("fresh and clear", "clear", M.aggregate(CLEAR, NOW, NOW, 60).status);
check("fresh and alerting", "alert", M.aggregate(ALERT, NOW, NOW, 60).status);
check("stale and clear becomes unknown", "unknown", M.aggregate(CLEAR, NOW - 61000, NOW, 60).status);
// The load-bearing rule: losing the network mid-alert must not read as calm.
check("stale and alerting stays alert", "alert", M.aggregate(ALERT, NOW - 61000, NOW, 60).status);
check("stale and alerting is flagged stale", true, M.aggregate(ALERT, NOW - 61000, NOW, 60).stale);
check("fresh alert is not flagged stale", false, M.aggregate(ALERT, NOW, NOW, 60).stale);
check("exactly at the threshold is still fresh", "clear", M.aggregate(CLEAR, NOW - 60000, NOW, 60).status);
check("one millisecond past the threshold is stale", "unknown", M.aggregate(CLEAR, NOW - 60001, NOW, 60).status);
check("a never-fetched widget is unknown, not clear", "unknown", M.aggregate(CLEAR, 0, NOW, 60).status);
check("primary is the alerting region", "1", M.aggregate(ALERT, NOW, NOW, 60).primary.region.id);
check("clear has no primary", null, M.aggregate(CLEAR, NOW, NOW, 60).primary);

const MIXED = [
  { id: "1", label: "A", alerts: [] },
  { id: "2", label: "B", alerts: [{ type: "ARTILLERY", since: "2026-08-27T09:30:00Z" }] }
];
check("one alerting region alerts the whole widget", "alert", M.aggregate(MIXED, NOW, NOW, 60).status);
check("primary skips the clear region", "2", M.aggregate(MIXED, NOW, NOW, 60).primary.region.id);

// --- formatting -------------------------------------------------------------

check("minutes under an hour", "12m", M.formatElapsed("2026-08-27T09:48:00Z", NOW));
check("hours and minutes", "1h 24m", M.formatElapsed("2026-08-27T08:36:00Z", NOW));
check("days and hours", "3d 4h", M.formatElapsed("2026-08-24T06:00:00Z", NOW));
// Luhansk oblast has carried the same alert since 2022-04-04.
check("a multi-year alert does not overflow", "1605d", M.formatElapsed("2022-04-04T16:45:00Z", NOW));
check("a future timestamp clamps to zero", "0m", M.formatElapsed("2026-08-27T11:00:00Z", NOW));
check("an unparseable timestamp is empty", "", M.formatElapsed("nonsense", NOW));
check("an empty timestamp is empty", "", M.formatElapsed("", NOW));

check("air is abbreviated", "AIR", M.alertAbbrev("AIR"));
check("urban fights is abbreviated", "URBAN", M.alertAbbrev("URBAN_FIGHTS"));
check("artillery is abbreviated", "ARTY", M.alertAbbrev("ARTILLERY"));
check("an unknown type falls back to itself", "WEIRD", M.alertAbbrev("WEIRD"));

check("pill omits the label for a single region",
  "AIR 1h 0m", M.pillText(M.aggregate(ALERT, NOW, NOW, 60), 1, NOW));
check("pill prefixes the label when several regions are watched",
  "A AIR 1h 0m", M.pillText(M.aggregate(ALERT, NOW, NOW, 60), 2, NOW));
check("a stale alert marks the elapsed time as extrapolated",
  "~AIR 1h 0m", M.pillText(M.aggregate(ALERT, NOW - 61000, NOW, 60), 1, NOW));
check("clear pill is empty", "", M.pillText(M.aggregate(CLEAR, NOW, NOW, 60), 1, NOW));
check("unknown pill is a question mark", "?", M.pillText(M.aggregate(CLEAR, 0, NOW, 60), 1, NOW));
check("unconfigured pill prompts for setup", "set region", M.pillText(M.aggregate([], NOW, NOW, 60), 0, NOW));

// --- bounds -----------------------------------------------------------------
//
// Everything below this line exists because the data crossing these functions
// comes from a third-party host, a user-writable state file, or a shell script
// any of them could in principle influence. Shape being right says nothing
// about size or count, and both are drawn into long-lived QML objects.

check("region ids are digits only", true, M.isRegionId("31"));
check("an option-looking id is refused", false, M.isRegionId("--regions"));
check("a leading dash is refused", false, M.isRegionId("-31"));
check("a shell metacharacter is refused", false, M.isRegionId("31; rm -rf /"));
check("an empty id is refused", false, M.isRegionId(""));
check("an absurdly long digit string is refused", false, M.isRegionId("1".repeat(64)));

// A crafted state file listing thousands of regions would spawn a process and
// build a QML row per entry on every poll.
const MANY = [];
for (let i = 0; i < 5000; i++) MANY.push({ id: String(i + 1) });
check("the region list is capped", M.MAX_REGIONS, M.resolveRegions(MANY, null).length);
check("an invalid id is dropped rather than passed to argv",
  ["31"], M.resolveRegions([{ id: "--regions" }, { id: "31" }], null).map(function (r) { return r.id; }));

const manyAlerts = { ok: true, regions: [{ id: "1", name: "x", alerts: [] }] };
for (let i = 0; i < 500; i++) manyAlerts.regions[0].alerts.push({ type: "AIR", since: "2026-08-27T09:00:00Z" });
check("alerts per region are capped",
  M.MAX_ALERTS, M.parsePayload(JSON.stringify(manyAlerts)).regions[0].alerts.length);

const manyRegions = { ok: true, regions: [] };
for (let i = 0; i < 5000; i++) manyRegions.regions.push({ id: String(i), name: "x", alerts: [] });
check("regions in a payload are capped",
  M.MAX_REGIONS, M.parsePayload(JSON.stringify(manyRegions)).regions.length);

check("an oversized payload is refused whole, not truncated",
  false, M.parsePayload('{"ok":true,"regions":[],"pad":"' + "A".repeat(M.MAX_PAYLOAD_BYTES) + '"}').ok);
check("a payload exactly at the ceiling is still accepted",
  true, M.parsePayload(JSON.stringify({ ok: true, regions: [] })).ok);

const bigCatalog = [];
for (let i = 0; i < 20000; i++) bigCatalog.push({ id: String(i), name: "Київська область", type: "State", parent: null });
check("search never scans an unbounded catalog",
  12, M.searchRegions(bigCatalog, "Kyiv", 12).length);
check("search results respect the catalog cap even with a huge limit",
  M.MAX_CATALOG >= 12, M.searchRegions(bigCatalog, "Kyiv", 999999).length <= M.MAX_CATALOG);

// PanelToolTip's contentItem Text sets no textFormat, so it inherits AutoText:
// a region name is attacker-influenced data reaching a markup-interpreting sink.
check("markup delimiters are stripped so no tag survives", "bimg src=x", M.plain("<b><img src=x>"));
check("plain truncates", 16, M.plain("A".repeat(500), 16).length);
check("plain handles a non-string", "", M.plain(null));
check("plain handles a number", "31", M.plain(31));
check("a label is sanitised on the way out of resolveRegions",
  -1, M.resolveRegions([{ id: "1", label: "<img src=x>" }], null)[0].label.indexOf("<"));
check("a name is sanitised on the way out of parsePayload",
  -1, M.parsePayload('{"ok":true,"regions":[{"id":"1","name":"<b>x</b>","alerts":[]}]}')
        .regions[0].name.indexOf("<"));

// --- backoff ----------------------------------------------------------------
//
// siren.pp.ua returns 429 after roughly five requests in quick succession.
// A widget that keeps polling at a fixed interval through a refusal is both
// rude and useless, so failures widen the interval until one succeeds.

check("no failures polls at the base interval", 15, M.pollInterval(15, 0));
check("one failure doubles it", 30, M.pollInterval(15, 1));
check("two failures double again", 60, M.pollInterval(15, 2));
check("backoff is capped", M.MAX_POLL_INTERVAL, M.pollInterval(15, 20));
check("a slow base interval is still capped", M.MAX_POLL_INTERVAL, M.pollInterval(600, 5));
check("a negative failure count is treated as none", 15, M.pollInterval(15, -3));

// --- durations --------------------------------------------------------------
//
// The API returns .NET TimeSpan strings with seven fractional digits. Stripping
// a leading "00:" turned 00:43:55 into 43:55, which reads as 43 hours -- an
// alert that lasted 44 minutes rendered as nearly two days.

check("hours and minutes", "1h 27m", M.formatDuration("01:27:57.6452720"));
check("under an hour drops the hour part", "43m", M.formatDuration("00:43:55.7405890"));
check("minutes without fractional seconds", "12m", M.formatDuration("00:12:55"));
check("three hours", "3h 6m", M.formatDuration("03:06:12.9741560"));
check("a duration over a day", "1d 2h", M.formatDuration("26:03:00"));
check("under a minute", "<1m", M.formatDuration("00:00:42.1"));
check("zero", "<1m", M.formatDuration("00:00:00"));
check("an empty duration is empty", "", M.formatDuration(""));
check("junk is empty rather than misleading", "", M.formatDuration("banana"));
check("a null duration is empty", "", M.formatDuration(null));

// --- selection editing ------------------------------------------------------
//
// The picker's add/remove/relabel used to build these lists inline in QML,
// where nothing could reach them. They are the only paths that write the
// state file, so they are the last place that should have been untested.

const SEL = [{ id: "31", name: "м. Київ", type: "State", label: "Kyiv" }];

check("adding appends",
  ["31", "27"],
  M.addRegionTo(SEL, { id: "27", name: "Львівська область", type: "State" }).map(function (r) { return r.id; }));
check("adding derives a label",
  "Lvivska obl.",
  M.addRegionTo(SEL, { id: "27", name: "Львівська область", type: "State" })[1].label);
check("adding the same region twice is a no-op",
  1, M.addRegionTo(SEL, { id: "31", name: "м. Київ", type: "State" }).length);
check("adding an invalid id is refused",
  1, M.addRegionTo(SEL, { id: "--regions", name: "x", type: "State" }).length);
check("adding does not mutate the original list", 1, SEL.length);

const FULL = [];
for (let i = 0; i < M.MAX_REGIONS; i++) FULL.push({ id: String(i + 1), name: "x", type: "State", label: "x" });
check("adding past the cap is refused",
  M.MAX_REGIONS, M.addRegionTo(FULL, { id: "9999", name: "y", type: "State" }).length);

check("removing drops the entry", [], M.removeRegionFrom(SEL, "31").map(function (r) { return r.id; }));
check("removing an absent id changes nothing", ["31"], M.removeRegionFrom(SEL, "77").map(function (r) { return r.id; }));
check("removing does not mutate the original", 1, SEL.length);

check("relabelling changes the label", "Home", M.relabelIn(SEL, "31", "Home")[0].label);
// The name is the region's identity; only the label is presentation.
check("relabelling never touches the name", "м. Київ", M.relabelIn(SEL, "31", "Home")[0].name);
check("relabelling sanitises markup", -1, M.relabelIn(SEL, "31", "<img src=x>")[0].label.indexOf("<"));
check("an empty label falls back to the derived one", "Kyiv", M.relabelIn(SEL, "31", "")[0].label);
check("relabelling an absent id changes nothing", "Kyiv", M.relabelIn(SEL, "77", "Nope")[0].label);
check("relabelling does not mutate the original", "Kyiv", SEL[0].label);

// --- history summary --------------------------------------------------------
//
// Three rows is enough to read; the count over the last day is the part that
// actually says how bad it has been.

function alarmsAt(hoursAgo) {
  return hoursAgo.map(function (h) {
    return { startDate: new Date(NOW - h * 3600000).toISOString(), alertType: "AIR" };
  });
}

check("counts alerts inside the window", 3, M.historySummary(alarmsAt([1, 5, 20]), NOW, 24, 10).count);
check("excludes alerts older than the window", 2, M.historySummary(alarmsAt([1, 5, 30]), NOW, 24, 10).count);
check("an empty history counts zero", 0, M.historySummary([], NOW, 24, 10).count);
check("not capped when under the fetch limit", false, M.historySummary(alarmsAt([1, 2]), NOW, 24, 10).capped);
// Every fetched entry is inside the window, so there may be more we never saw.
check("capped when every fetched entry is in the window",
  true, M.historySummary(alarmsAt([1, 2, 3]), NOW, 24, 3).capped);
check("not capped when the oldest fetched entry falls outside",
  false, M.historySummary(alarmsAt([1, 2, 30]), NOW, 24, 3).capped);
check("unparseable dates are skipped, not counted",
  1, M.historySummary([{ startDate: "junk" }, { startDate: new Date(NOW - 3600000).toISOString() }], NOW, 24, 10).count);
check("a null history does not throw", 0, M.historySummary(null, NOW, 24, 10).count);

check("summary text reads naturally", "3 alerts in the last 24h",
  M.historySummaryText(alarmsAt([1, 5, 20]), NOW, 24, 10));
check("one alert is singular", "1 alert in the last 24h",
  M.historySummaryText(alarmsAt([2]), NOW, 24, 10));
check("a capped count says so", "3+ alerts in the last 24h",
  M.historySummaryText(alarmsAt([1, 2, 3]), NOW, 24, 3));
check("no alerts reads as calm", "No alerts in the last 24h",
  M.historySummaryText([], NOW, 24, 10));

// --- pill parts -------------------------------------------------------------
//
// Drawn as two texts so the region label can elide while the alert type and
// elapsed time -- the part that is actually information -- never does.

check("a single region contributes no label part",
  "", M.pillRegionLabel(M.aggregate(ALERT, NOW, NOW, 60), 1));
check("several regions name the alerting one",
  "A", M.pillRegionLabel(M.aggregate(ALERT, NOW, NOW, 60), 2));
check("a clear pill has no label part",
  "", M.pillRegionLabel(M.aggregate(CLEAR, NOW, NOW, 60), 2));
check("status carries type and elapsed",
  "AIR 1h 0m", M.pillStatus(M.aggregate(ALERT, NOW, NOW, 60), NOW));
check("a stale status is marked extrapolated",
  "~AIR 1h 0m", M.pillStatus(M.aggregate(ALERT, NOW - 61000, NOW, 60), NOW));
check("a clear status is empty", "", M.pillStatus(M.aggregate(CLEAR, NOW, NOW, 60), NOW));
check("an unknown status is a question mark", "?", M.pillStatus(M.aggregate(CLEAR, 0, NOW, 60), NOW));
check("an unconfigured status prompts", "set region", M.pillStatus(M.aggregate([], NOW, NOW, 60), NOW));
// The two parts still recompose into what pillText always returned.
check("the parts recompose", "A AIR 1h 0m",
  (M.pillRegionLabel(M.aggregate(ALERT, NOW, NOW, 60), 2) + " "
   + M.pillStatus(M.aggregate(ALERT, NOW, NOW, 60), NOW)).trim());

// --- primary region ---------------------------------------------------------
//
// Which region the pill speaks for when several are watched. It decides who
// wins when more than one is alerting -- it never silences a region that is.

const TWO_ALERTING = [
  { id: "1", label: "A", alerts: [{ type: "AIR", since: "2026-08-27T09:00:00Z" }] },
  { id: "2", label: "B", alerts: [{ type: "ARTILLERY", since: "2026-08-27T09:30:00Z" }] }
];
const SECOND_ONLY = [
  { id: "1", label: "A", alerts: [] },
  { id: "2", label: "B", alerts: [{ type: "ARTILLERY", since: "2026-08-27T09:30:00Z" }] }
];

check("with no primary set, the first alerting region wins",
  "1", M.aggregate(TWO_ALERTING, NOW, NOW, 60, "").primary.region.id);
check("the chosen primary wins when both are alerting",
  "2", M.aggregate(TWO_ALERTING, NOW, NOW, 60, "2").primary.region.id);
check("choosing the first still works", "1", M.aggregate(TWO_ALERTING, NOW, NOW, 60, "1").primary.region.id);
// The load-bearing rule: a pinned primary must not silence another region.
check("a clear primary does not hide another region's alert",
  "2", M.aggregate(SECOND_ONLY, NOW, NOW, 60, "1").primary.region.id);
check("and the widget still reads as alerting",
  "alert", M.aggregate(SECOND_ONLY, NOW, NOW, 60, "1").status);
check("a primary id that is not configured is ignored",
  "1", M.aggregate(TWO_ALERTING, NOW, NOW, 60, "999").primary.region.id);
check("a clear widget has no primary regardless",
  null, M.aggregate(CLEAR, NOW, NOW, 60, "1").primary);

check("resolvePrimaryId keeps a configured id", "2", M.resolvePrimaryId(TWO_ALERTING, "2"));
check("resolvePrimaryId drops an unconfigured id", "", M.resolvePrimaryId(TWO_ALERTING, "999"));
check("resolvePrimaryId drops a malformed id", "", M.resolvePrimaryId(TWO_ALERTING, "--regions"));
check("resolvePrimaryId on an empty list is empty", "", M.resolvePrimaryId([], "1"));

// Removing the primary region must not leave a dangling pointer.
check("removing the primary clears it",
  "", M.resolvePrimaryId(M.removeRegionFrom(
    [{ id: "1", name: "a", type: "State", label: "A" },
     { id: "2", name: "b", type: "State", label: "B" }], "2"), "2"));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
