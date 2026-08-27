// Pure logic for the air-alert widget. No QML, no I/O — everything here is a
// function of its arguments, so tests/test_model.js can drive the same file
// Quickshell imports and the two cannot drift apart.
//
// ES5 only: Quickshell's JS engine is not guaranteed to have let/const, arrow
// functions or template literals.

// KMU 2010 romanization. Є Ї Й Ю Я take their "y-" form at the start of a word
// and their "i-" form everywhere else, which is why this walks the string
// instead of doing a flat replace.
var INITIAL = { "є": "ye", "ї": "yi", "й": "y", "ю": "yu", "я": "ya" };
var MEDIAL = { "є": "ie", "ї": "i", "й": "i", "ю": "iu", "я": "ia" };
var BASE = {
  "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e",
  "ж": "zh", "з": "z", "и": "y", "і": "i", "к": "k", "л": "l", "м": "m",
  "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
  "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
  // The soft sign and both apostrophe glyphs have no Latin counterpart at all.
  // This is also why the reverse direction is not implemented: Львів cannot be
  // recovered from "Lviv".
  "ь": "", "'": "", "’": "", "ʼ": ""
};

function isWordChar(ch) {
  return /[a-zЀ-ӿ]/.test(ch);
}

function romanize(text) {
  var s = String(text || "").toLowerCase();
  var out = "";
  var atWordStart = true;
  var i = 0;
  while (i < s.length) {
    // Зг is zgh so it cannot be read back as ж (zh).
    if (s.charAt(i) === "з" && s.charAt(i + 1) === "г") {
      out += "zgh";
      i += 2;
      atWordStart = false;
      continue;
    }
    var ch = s.charAt(i);
    if (INITIAL.hasOwnProperty(ch)) {
      out += atWordStart ? INITIAL[ch] : MEDIAL[ch];
      atWordStart = false;
    } else if (BASE.hasOwnProperty(ch)) {
      out += BASE[ch];
      // An elided character leaves the word-start flag alone: the apostrophe in
      // Кам'янець sits inside a word, so the я after it must still be "ia".
      if (BASE[ch] !== "") atWordStart = false;
    } else {
      out += ch;
      atWordStart = !isWordChar(ch);
    }
    i++;
  }
  return out;
}

// Comparison form: romanized, letters only, so "Kyiv", "київ" and "Київ" all
// reduce to the same string.
function normalizeName(text) {
  return romanize(text).replace(/[^a-z]/g, "");
}

// What a name is matched against. The "м. " that prefixes a city region would
// otherwise push it out of the exact-match tier and let the surrounding oblast
// outrank it — typing "Kyiv" would offer Київська область before м. Київ,
// which is a different region with different alerts.
function searchKey(name) {
  return normalizeName(String(name || "").replace(/^м\.\s*/, ""));
}

// Ukrainian raion and oblast names are adjectives derived from a place name
// with stem changes — Одеса becomes Одеська, Кременчук becomes Кременчуцький —
// so matching the whole query fails. Comparing a leading fraction of it
// survives the mutation.
function stemQuery(query) {
  var q = normalizeName(query);
  if (!q) return "";
  return q.substring(0, Math.max(4, Math.floor(q.length * 0.7)));
}

function searchRegions(regions, query, limit) {
  var stem = stemQuery(query);
  if (!stem) return [];
  var max = limit || 20;
  var exact = [], prefix = [], contains = [];
  var list = regions || [];
  var scan = Math.min(list.length, MAX_CATALOG);
  for (var i = 0; i < scan; i++) {
    var r = list[i];
    if (!r) continue;
    // Communities are addressable by id through shell.json but stay out of the
    // picker: 1455 near-identical names would bury the 151 that are useful.
    if (r.type !== "State" && r.type !== "District") continue;
    var n = searchKey(r.name);
    if (n === stem) exact.push(r);
    else if (n.indexOf(stem) === 0) prefix.push(r);
    else if (n.indexOf(stem) !== -1) contains.push(r);
  }
  var out = [];
  var tiers = [exact, prefix, contains];
  for (var t = 0; t < tiers.length; t++) {
    // Within a tier the oblast comes before its raion: it is the broader
    // answer, and usually what someone typing only a place name means.
    tiers[t].sort(function (a, b) {
      if (a.type === b.type) return 0;
      return a.type === "State" ? -1 : 1;
    });
    for (var j = 0; j < tiers[t].length && out.length < max; j++) out.push(tiers[t][j]);
  }
  return out;
}

// A short Latin name to draw in the bar, derived from the Ukrainian one so it
// is useful before anyone edits it.
function defaultLabel(name, type) {
  var s = String(name || "").trim();
  s = s.replace(/^м\.\s*/, "");
  var suffix = "";
  // "Харків та Харківська територіальна громада" is one entry covering a city
  // and its hromada. Everything after "та" restates the city, so the city
  // alone is both shorter and clearer.
  var joined = s.split(/\s+та\s+/);
  if (joined.length > 1) {
    s = joined[0];
  } else if (/\s+територіальна\s+громада$/.test(s)) {
    suffix = " hr.";
    s = s.replace(/\s+територіальна\s+громада$/, "");
  } else if (/\s+область$/.test(s)) {
    suffix = " obl.";
    s = s.replace(/\s+область$/, "");
  } else if (/\s+район$/.test(s)) {
    suffix = " r.";
    s = s.replace(/\s+район$/, "");
  }
  var latin = romanize(s).replace(/[^a-z\s\-]/g, "").replace(/\s+/g, " ").trim();
  if (!latin) return String(name || "");
  // Capitalise after a hyphen too, so Івано-Франківська reads Ivano-Frankivska.
  latin = latin.replace(/(^|[\s\-])([a-z])/g, function (m, sep, ch) {
    return sep + ch.toUpperCase();
  });
  var out = latin + suffix;
  return out.length > MAX_LABEL ? out.substring(0, MAX_LABEL) : out;
}

// --- bounds -----------------------------------------------------------------
//
// The data crossing this file arrives from a third-party host, from a
// user-writable state file, or from a shell script either could influence.
// Shape being right says nothing about size or count, and every value below
// ends up in a long-lived QML object — one row, one Process, one Text apiece.

// The real catalog holds 151 State/District regions; nobody watches more than
// a handful. Each configured region costs an argv entry and a QML row.
var MAX_REGIONS = 32;
// Six alert types exist. More than this on one region is not real data.
var MAX_ALERTS = 16;
// 151 today. Bounded well above any plausible administrative reform, but
// bounded, because search walks the whole list on every keystroke.
var MAX_CATALOG = 4096;
// The largest real poll response is a few hundred bytes; the ceiling is for a
// host that has stopped behaving.
var MAX_PAYLOAD_BYTES = 262144;
var MAX_TEXT = 120;
// A bar pill has to share a 3440px strip with everything else. Labels are
// capped here as well as elided in the widget, so a long one never becomes a
// wall of text that elides down to nothing useful.
var MAX_LABEL = 24;

// Region ids reach argv. An id of "--regions" would flip the fetch script into
// another mode; anything non-numeric has no business being one at all.
function isRegionId(value) {
  return /^[0-9]{1,12}$/.test(String(value === undefined || value === null ? "" : value));
}

// Ui/PanelToolTip.qml's contentItem Text sets no textFormat and therefore
// inherits AutoText, as do Ui/Button.qml and Ui/WidgetButton.qml. Region names
// come off the network, so every string bound for one of those sinks is
// stripped and truncated here rather than trusted.
function plain(value, maxLen) {
  var s = String(value === undefined || value === null ? "" : value);
  s = s.replace(/[<>&]/g, "");
  var cap = maxLen || MAX_TEXT;
  return s.length > cap ? s.substring(0, cap) : s;
}

// The upstream mirror answers 429 after roughly five requests in quick
// succession. Polling straight through a refusal at a fixed interval is both
// impolite and pointless, so each consecutive failure doubles the wait until
// something succeeds and resets it.
var MAX_POLL_INTERVAL = 300;

function pollInterval(baseSeconds, consecutiveFailures) {
  var n = consecutiveFailures > 0 ? consecutiveFailures : 0;
  if (n > 16) n = 16;
  var seconds = baseSeconds * Math.pow(2, n);
  return seconds > MAX_POLL_INTERVAL ? MAX_POLL_INTERVAL : seconds;
}

// --- payload ----------------------------------------------------------------

// fetch-alerts promises one line of JSON, always. Anything else — a crash, an
// empty read, a half-written line — is treated as a failed fetch rather than
// allowed to throw inside a QML property binding.
function parsePayload(text) {
  var bad = { ok: false, unchanged: false, lastActionIndex: "", regions: [], error: "" };
  var source = String(text || "");
  // Refused whole rather than truncated: a truncated prefix of a hostile
  // payload can still parse as valid JSON and be believed.
  if (source.length > MAX_PAYLOAD_BYTES) {
    bad.error = "response too large";
    return bad;
  }
  var raw;
  try {
    raw = JSON.parse(source);
  } catch (e) {
    bad.error = "unparseable response";
    return bad;
  }
  if (!raw || typeof raw !== "object") {
    bad.error = "unparseable response";
    return bad;
  }
  if (raw.ok !== true) {
    bad.error = String(raw.error || "fetch failed");
    return bad;
  }

  var regions = [];
  var src = raw.regions || [];
  var limit = Math.min(src.length, MAX_REGIONS);
  for (var i = 0; i < limit; i++) {
    var r = src[i] || {};
    var alerts = [];
    var as = r.alerts || [];
    var alertLimit = Math.min(as.length, MAX_ALERTS);
    for (var j = 0; j < alertLimit; j++) {
      alerts.push({ type: plain(as[j].type, 32), since: plain(as[j].since, 40) });
    }
    regions.push({
      id: String(r.id || ""),
      name: plain(r.name),
      nameEn: plain(r.nameEn),
      alerts: alerts
    });
  }
  return {
    ok: true,
    unchanged: raw.unchanged === true,
    lastActionIndex: String(raw.lastActionIndex || ""),
    regions: regions,
    error: ""
  };
}

// --- configuration ----------------------------------------------------------

// shell.json is user-authored config and wins; the state file is whatever the
// picker saved. Keeping them apart means the widget never rewrites the user's
// own config file.
function resolveRegions(shellRegions, stateRegions) {
  var src = (shellRegions && shellRegions.length) ? shellRegions
    : ((stateRegions && stateRegions.length) ? stateRegions : []);
  var out = [];
  for (var i = 0; i < src.length && out.length < MAX_REGIONS; i++) {
    var r = src[i] || {};
    // Dropped rather than clamped: a region id we cannot vouch for must never
    // reach argv, and guessing what was meant would be worse than ignoring it.
    if (!isRegionId(r.id)) continue;
    var name = plain(r.name);
    var type = String(r.type || "State");
    if (type !== "State" && type !== "District" && type !== "Community") type = "State";
    out.push({
      id: String(r.id),
      name: name,
      type: type,
      label: plain(r.label || (name ? defaultLabel(name, type) : String(r.id))),
      alerts: []
    });
  }
  return out;
}

// --- selection editing ------------------------------------------------------
//
// The picker writes the state file through these. Kept pure and here rather
// than inline in Panel.qml so they can actually be tested: they are the only
// code in the plugin that changes which regions get watched.

function copySelection(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    var r = list[i];
    out.push({ id: r.id, name: r.name, type: r.type, label: r.label });
  }
  return out;
}

function addRegionTo(list, region) {
  var out = copySelection(list);
  if (!region || !isRegionId(region.id)) return out;
  if (out.length >= MAX_REGIONS) return out;
  for (var i = 0; i < out.length; i++) if (out[i].id === String(region.id)) return out;
  var name = plain(region.name);
  var type = String(region.type || "State");
  out.push({
    id: String(region.id),
    name: name,
    type: type,
    label: plain(name ? defaultLabel(name, type) : String(region.id))
  });
  return out;
}

function removeRegionFrom(list, id) {
  var out = [];
  var src = copySelection(list);
  for (var i = 0; i < src.length; i++) if (src[i].id !== String(id)) out.push(src[i]);
  return out;
}

function relabelIn(list, id, label) {
  var out = copySelection(list);
  for (var i = 0; i < out.length; i++) {
    if (out[i].id !== String(id)) continue;
    var next = plain(label, MAX_LABEL);
    // An emptied field falls back to the derived name rather than leaving a
    // blank pill that says nothing about which region it is.
    out[i].label = next !== "" ? next
      : plain(out[i].name ? defaultLabel(out[i].name, out[i].type) : out[i].id);
  }
  return out;
}

// How many alerts fell inside the window. `capped` means every entry we were
// given is inside it, so the real number may be higher than what we fetched.
function historySummary(alarms, nowMs, windowHours, fetchLimit) {
  var list = alarms || [];
  var cutoff = nowMs - windowHours * 3600000;
  var count = 0;
  var oldestInside = true;
  for (var i = 0; i < list.length; i++) {
    var started = Date.parse(String((list[i] || {}).startDate || ""));
    if (isNaN(started)) continue;
    if (started >= cutoff) count++;
    else oldestInside = false;
  }
  return { count: count, capped: oldestInside && list.length >= fetchLimit };
}

function historySummaryText(alarms, nowMs, windowHours, fetchLimit) {
  var s = historySummary(alarms, nowMs, windowHours, fetchLimit);
  if (s.count === 0) return "No alerts in the last " + windowHours + "h";
  var noun = s.count === 1 ? " alert in the last " : " alerts in the last ";
  return s.count + (s.capped ? "+" : "") + noun + windowHours + "h";
}

// --- state ------------------------------------------------------------------

// Which of several watched regions the pill speaks for. Only meaningful when
// more than one is alerting at once — a primary that is clear never suppresses
// another region's alert, because the user chose to watch that one too.
function resolvePrimaryId(regions, primaryId) {
  var id = String(primaryId || "");
  if (!isRegionId(id)) return "";
  for (var i = 0; i < (regions || []).length; i++) {
    if (regions[i] && String(regions[i].id) === id) return id;
  }
  return "";
}

function aggregate(regions, lastOkFetchMs, nowMs, staleAfterSeconds, primaryId) {
  if (!regions || !regions.length) {
    return { status: "unconfigured", stale: false, primary: null };
  }

  var fresh = lastOkFetchMs > 0 && (nowMs - lastOkFetchMs) <= staleAfterSeconds * 1000;

  var alerting = [];
  for (var i = 0; i < regions.length; i++) {
    if (regions[i].alerts && regions[i].alerts.length) alerting.push(regions[i]);
  }

  var primary = null;
  var wanted = resolvePrimaryId(regions, primaryId);
  if (wanted) {
    for (var j = 0; j < alerting.length && !primary; j++) {
      if (String(alerting[j].id) === wanted) {
        primary = { region: alerting[j], alert: alerting[j].alerts[0] };
      }
    }
  }
  // Falls through to the first alerting region: a pinned primary decides who
  // wins a tie, never who gets silenced.
  if (!primary && alerting.length) {
    primary = { region: alerting[0], alert: alerting[0].alerts[0] };
  }

  // An active alert outranks staleness. Under-reporting an alert is the
  // dangerous direction; over-reporting one is merely annoying.
  if (primary) return { status: "alert", stale: !fresh, primary: primary };
  if (!fresh) return { status: "unknown", stale: true, primary: null };
  return { status: "clear", stale: false, primary: null };
}

// --- formatting -------------------------------------------------------------

function formatElapsed(sinceIso, nowMs) {
  var started = Date.parse(String(sinceIso || ""));
  if (isNaN(started)) return "";
  var sec = Math.floor((nowMs - started) / 1000);
  if (sec < 0) sec = 0;
  var min = Math.floor(sec / 60);
  if (min < 60) return min + "m";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h " + (min % 60) + "m";
  var day = Math.floor(hr / 24);
  // Luhansk oblast has been under the same alert since 2022-04-04, so this
  // has to stay readable at four digits of days.
  if (day < 30) return day + "d " + (hr % 24) + "h";
  return day + "d";
}

// The API returns .NET TimeSpan strings: "HH:MM:SS.fffffff", and the hour
// field can exceed 24. Rendered the same way as a running alert's elapsed
// time so the two columns read alike.
function formatDuration(text) {
  var m = /^(\d+):(\d{2}):(\d{2})/.exec(String(text || "").trim());
  if (!m) return "";
  var hours = parseInt(m[1], 10);
  var minutes = parseInt(m[2], 10);
  var total = hours * 60 + minutes;
  if (total < 1) return "<1m";
  if (total < 60) return total + "m";
  if (hours < 24) return hours + "h " + minutes + "m";
  var days = Math.floor(hours / 24);
  return days + "d " + (hours % 24) + "h";
}

var ABBREV = {
  "AIR": "AIR", "ARTILLERY": "ARTY", "URBAN_FIGHTS": "URBAN",
  "CHEMICAL": "CHEM", "NUCLEAR": "NUCLEAR", "INFO": "INFO"
};

function alertAbbrev(type) {
  var t = String(type || "");
  return ABBREV.hasOwnProperty(t) ? ABBREV[t] : t;
}

// The region label, drawn separately so it can elide on its own.
function pillRegionLabel(agg, regionCount) {
  if (!agg || agg.status !== "alert" || !agg.primary) return "";
  return regionCount > 1 ? plain(agg.primary.region.label, MAX_LABEL) : "";
}

// Type and elapsed time. Never elided: this is the part worth reading.
function pillStatus(agg, nowMs) {
  if (!agg) return "";
  if (agg.status === "unconfigured") return "set region";
  if (agg.status === "unknown") return "?";
  if (agg.status !== "alert" || !agg.primary) return "";
  var elapsed = formatElapsed(agg.primary.alert.since, nowMs);
  var body = alertAbbrev(agg.primary.alert.type) + (elapsed ? " " + elapsed : "");
  // A tilde marks a value extrapolated from the last successful fetch rather
  // than one just confirmed.
  return agg.stale ? "~" + body : body;
}

function pillText(agg, regionCount, nowMs) {
  if (!agg) return "";
  if (agg.status === "unconfigured") return "set region";
  if (agg.status === "unknown") return "?";
  if (agg.status !== "alert" || !agg.primary) return "";
  var elapsed = formatElapsed(agg.primary.alert.since, nowMs);
  var body = alertAbbrev(agg.primary.alert.type) + (elapsed ? " " + elapsed : "");
  // A tilde marks a value extrapolated from the last successful fetch rather
  // than one just confirmed.
  if (agg.stale) body = "~" + body;
  return regionCount > 1 ? agg.primary.region.label + " " + body : body;
}

if (typeof module !== "undefined") {
  module.exports = {
    romanize: romanize,
    normalizeName: normalizeName,
    searchKey: searchKey,
    stemQuery: stemQuery,
    searchRegions: searchRegions,
    defaultLabel: defaultLabel,
    isRegionId: isRegionId,
    plain: plain,
    MAX_LABEL: MAX_LABEL,
    MAX_REGIONS: MAX_REGIONS,
    MAX_ALERTS: MAX_ALERTS,
    MAX_CATALOG: MAX_CATALOG,
    MAX_PAYLOAD_BYTES: MAX_PAYLOAD_BYTES,
    pollInterval: pollInterval,
    MAX_POLL_INTERVAL: MAX_POLL_INTERVAL,
    parsePayload: parsePayload,
    resolveRegions: resolveRegions,
    copySelection: copySelection,
    addRegionTo: addRegionTo,
    removeRegionFrom: removeRegionFrom,
    relabelIn: relabelIn,
    historySummary: historySummary,
    historySummaryText: historySummaryText,
    resolvePrimaryId: resolvePrimaryId,
    aggregate: aggregate,
    formatElapsed: formatElapsed,
    formatDuration: formatDuration,
    alertAbbrev: alertAbbrev,
    pillRegionLabel: pillRegionLabel,
    pillStatus: pillStatus,
    pillText: pillText
  };
}
