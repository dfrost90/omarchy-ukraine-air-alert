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
  for (var i = 0; i < list.length; i++) {
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
  if (/\s+область$/.test(s)) {
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
  return latin + suffix;
}

if (typeof module !== "undefined") {
  module.exports = {
    romanize: romanize,
    normalizeName: normalizeName,
    searchKey: searchKey,
    stemQuery: stemQuery,
    searchRegions: searchRegions,
    defaultLabel: defaultLabel
  };
}
