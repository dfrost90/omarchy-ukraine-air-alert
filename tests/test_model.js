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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
