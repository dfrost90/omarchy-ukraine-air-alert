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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
