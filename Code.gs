/* =====================================================================
   MI FORTUNA MENU — APPS SCRIPT BACKEND (Code.gs)

   WHERE THIS LIVES: inside the Google Sheet → Extensions → Apps Script.
   It runs on Google's servers, never on the customer's phone.

   It does two jobs:
     1. PUBLIC FEED ..... URL + "?action=menu" returns the whole menu as JSON.
                          The public site (app.js) fetches this instead of
                          the published CSV, so changes show up right away.
     2. ADMIN PAGE ...... the URL with no "?action" shows Admin.html, where
                          the owner edits dishes. Only the script's owner
                          can open it or save anything.

   DEPLOY TWICE (same code, two "doors" with different locks):
     A. Public feed → Execute as: Me · Who has access: Anyone
     B. Admin page  → Execute as: Me · Who has access: Only myself
   Why two? Customers' phones must read the menu WITHOUT signing in, so
   the feed needs "Anyone". We don't want "anyone" opening the editor, so
   the editor gets its own deployment locked to the owner. As a SECOND
   lock, every function that changes data checks who is calling
   (isEditor_ below), so even the public door can't be used to edit.

   PRIVATE FUNCTIONS: in Apps Script, a function whose name ends in "_"
   can't be called from the browser with google.script.run. Only the
   functions WITHOUT "_" (getAdminData, updateDish, addDish, resetSoldOut)
   are reachable from Admin.html, and each one checks permission first.
   ===================================================================== */


/* ---------- CONFIG ---------- */
const MENU_TAB = "menu";               // tab names at the bottom of the Sheet
const CATEGORIES_TAB = "categories";
const CACHE_KEY = "public-menu-json";  // name of the saved copy of the feed
const CACHE_SECONDS = 300;             // keep the saved copy up to 5 minutes (every save clears it)

// The three values the "available" column can hold.
// TRUE = showing, SOLD OUT = showing with the badge, FALSE = hidden.
// IMPORTANT: don't turn this column into checkboxes in the Sheet;
// a checkbox can't hold the text "SOLD OUT".
const STATUS_VALUES = ["TRUE", "SOLD OUT", "FALSE"];

// Columns the editor is allowed to change. Anything else sent from the
// browser is ignored. (Never trust the browser: someone could send
// extra fields on purpose.)
const EDITABLE_COLUMNS = [
  "menu", "category", "name", "description_en", "description_es", "price",
  "options_en", "options_es", "spicy", "gluten_free", "image_url", "available",
  "favorite",   // FAVORITES: the checkbox column
];

// FAVORITES: the optional categories-tab row that styles the favorites
// card. It isn't a real category, so the editor never offers it.
const FAVORITES_CATEGORY = "Favorites";


/* =====================================================================
   ENTRY POINT
   doGet(e) runs every time someone opens the web app URL.
   e.parameter holds the URL's ?query values: "?action=menu" → { action: "menu" }
   ===================================================================== */
function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : "";

  // 1. PUBLIC FEED: anyone can read the menu.
  if (action === "menu") {
    const json = JSON.stringify(getPublicMenu_());
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON); // tells the browser "this is JSON, not a web page"
  }

  // 2. ADMIN PAGE: only for the owner.
  if (!isEditor_()) {
    return HtmlService.createHtmlOutput(
      "<p style='font-family:sans-serif;padding:2rem'>You don't have access to the menu editor.</p>"
    );
  }
  return HtmlService.createHtmlOutputFromFile("Admin")              // the Admin.html file in this project
    .setTitle("Mi Fortuna · Menu Editor")                           // browser tab title
    .addMetaTag("viewport", "width=device-width, initial-scale=1"); // so it fits a phone screen
}


/* =====================================================================
   PUBLIC FEED
   ===================================================================== */

/* Builds { menu: [...], categories: [...], updated: "..." }.
   CACHE: reading the Sheet takes about a second. Many customers scanning
   the QR code at once would each wait for that, so we save the finished
   JSON in CacheService and hand out the saved copy. Every edit clears the
   copy (clearPublicCache_), so customers still see changes right away. */
function getPublicMenu_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);              // saved copy exists → use it, skip the Sheet

  const data = {
    // .filter(...) drops blank rows (rows with no name / no category).
    menu: sheetToObjects_(getTab_(MENU_TAB)).filter(item => item.name),
    categories: sheetToObjects_(getTab_(CATEGORIES_TAB)).filter(cat => cat.category),
    updated: new Date().toISOString(),                // handy for debugging: when this copy was made
  };

  try {
    cache.put(CACHE_KEY, JSON.stringify(data), CACHE_SECONDS);
  } catch (error) {
    // The cache only holds 100 KB per key. If the menu ever grows past
    // that, we just skip caching instead of breaking the feed.
    console.warn("Menu too big to cache: " + error.message);
  }
  return data;
}

function clearPublicCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}


/* =====================================================================
   ADMIN FUNCTIONS (called from Admin.html with google.script.run)
   ===================================================================== */

/* Everything the editor needs to draw its list.
   _row is the dish's row number in the Sheet. We send it to the browser
   so that when the owner saves, we know exactly which row to change. */
function getAdminData() {
  assertEditor_();

  const items = sheetToObjects_(getTab_(MENU_TAB))
    // map BEFORE filter: index i must still match the Sheet row.
    // +2 because row 1 is the headers and arrays start counting at 0.
    .map((item, i) => Object.assign({}, item, { _row: i + 2 }))
    .filter(item => item.name);

  const categories = sheetToObjects_(getTab_(CATEGORIES_TAB))
    .filter(cat => cat.category && cat.category !== FAVORITES_CATEGORY)  // FAVORITES: not a real category
    .map(cat => ({
      menu: (cat.menu || "all").toLowerCase(),
      category: cat.category,
      title: cat.title_en || cat.category,
    }));

  return { items, categories };
}

/* Changes some columns of ONE dish.
     row          → Sheet row number (item._row)
     expectedName → the dish name the browser THINKS is in that row
     changes      → { price: "13.50", available: "SOLD OUT", ... }
   Returns the dish as it now looks in the Sheet. */
function updateDish(row, expectedName, changes) {
  assertEditor_();

  // LOCK: if two phones save at the same moment, the second one waits
  // here (up to 10 seconds) until the first finishes. No mixed-up writes.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getTab_(MENU_TAB);
    const headers = getHeaders_(sheet);

    // SAFETY CHECK: if someone sorted or inserted rows in the Sheet while
    // the editor was open, row 12 might now be a different dish. Comparing
    // names stops us from overwriting the wrong one.
    checkRowStillMatches_(sheet, headers, row, expectedName);

    // Object.entries({ price: "13.50" }) → [["price", "13.50"]]
    for (const [column, value] of Object.entries(changes)) {
      if (!EDITABLE_COLUMNS.includes(column)) continue;   // not allowed → skip
      const colIndex = headers.indexOf(column);
      if (colIndex === -1) continue;                      // column doesn't exist in this Sheet → skip
      writeCell_(sheet.getRange(row, colIndex + 1), column, value); // +1: Sheet columns start at 1
    }

    SpreadsheetApp.flush();   // push the writes to the Sheet now (Apps Script batches them otherwise)
    clearPublicCache_();      // customers get the new menu on their next load
    return readRow_(sheet, headers, row);
  } finally {
    lock.releaseLock();       // "finally" runs even if an error was thrown, so the lock never gets stuck
  }
}

/* Adds a new dish right after the last dish of the same category,
   so the Sheet stays organized for the owner. */
function addDish(dish) {
  assertEditor_();
  if (!dish || !String(dish.name || "").trim()) throw new Error("The dish needs a name.");
  if (!String(dish.category || "").trim()) throw new Error("Pick a category.");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getTab_(MENU_TAB);
    const headers = getHeaders_(sheet);
    const categoryCol = headers.indexOf("category");
    const allValues = sheet.getDataRange().getDisplayValues();

    // Find the LAST row that has this category. Start at the bottom and
    // walk up; the first match is the last dish of the category.
    let insertAfter = allValues.length;               // default: the very end of the Sheet
    for (let i = allValues.length - 1; i >= 1; i--) {
      if (allValues[i][categoryCol] === dish.category) {
        insertAfter = i + 1;                          // array index → Sheet row number
        break;
      }
    }

    sheet.insertRowAfter(insertAfter);
    const newRow = insertAfter + 1;

    // A new dish starts as available unless the form said otherwise.
    const values = Object.assign({ available: "TRUE" }, dish);
    for (const [column, value] of Object.entries(values)) {
      if (!EDITABLE_COLUMNS.includes(column)) continue;
      const colIndex = headers.indexOf(column);
      if (colIndex === -1) continue;
      writeCell_(sheet.getRange(newRow, colIndex + 1), column, value);
    }

    SpreadsheetApp.flush();
    clearPublicCache_();
    return readRow_(sheet, headers, newRow);
  } finally {
    lock.releaseLock();
  }
}

/* Turns every "SOLD OUT" back into "TRUE". Returns how many changed.
   The owner can press the button in the editor, OR you can make it run
   by itself every night: in Apps Script, Triggers (clock icon) → Add
   Trigger → function: resetSoldOut → Time-driven → Day timer → 3am–4am. */
function resetSoldOut() {
  assertEditor_();
  const sheet = getTab_(MENU_TAB);
  const headers = getHeaders_(sheet);
  const col = headers.indexOf("available") + 1;
  const lastRow = sheet.getLastRow();
  if (col === 0 || lastRow < 2) return 0;   // no "available" column, or no dishes

  // Read the whole column ONCE, change it in memory, write it back ONCE.
  // One read + one write is much faster than touching 150 cells one by one.
  const range = sheet.getRange(2, col, lastRow - 1, 1);   // from row 2, the "available" column, all dish rows
  const values = range.getValues();                       // [[TRUE], ["SOLD OUT"], [FALSE], ...]
  let changed = 0;

  const updated = values.map(([value]) => {               // each row is a 1-item array; [value] unpacks it
    if (String(value).toUpperCase() === "SOLD OUT") {
      changed++;
      return [true];
    }
    return [value];                                       // everything else stays as it was
  });

  if (changed > 0) {
    range.setValues(updated);
    clearPublicCache_();
  }
  return changed;
}


/* =====================================================================
   PERMISSION
   ===================================================================== */

/* Is the person using this page the owner of the script?
   getActiveUser()  → who is visiting ("" if not signed in, or if Google
                      won't share their email)
   getEffectiveUser() → whose permissions the script runs with. With
                      "Execute as: Me" that's always the owner.
   Same email = the owner is the one visiting. */
function isEditor_() {
  const visitor = Session.getActiveUser().getEmail();
  const owner = Session.getEffectiveUser().getEmail();
  return visitor !== "" && visitor === owner;
}

/* Stops the function with an error unless the caller is the owner.
   The error message shows up in the editor's failure handler. */
function assertEditor_() {
  if (!isEditor_()) throw new Error("You don't have permission to edit the menu.");
}


/* =====================================================================
   SHEET HELPERS
   ===================================================================== */

function getTab_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`There's no tab named "${name}" in this spreadsheet.`);
  return sheet;
}

/* Row 1, lowercased and trimmed: "Name " → "name". Same idea as rowsToObjects in app.js. */
function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(h => h.trim().toLowerCase());
}

/* The whole tab → array of objects, one per row (blank rows included,
   so positions still match Sheet rows).
   getDisplayValues() returns TEXT exactly as you see it in the Sheet
   ("12.50", "TRUE"), the same thing the published CSV gave us, so
   app.js can use it without changes. */
function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length === 0) return [];

  const headers = values[0].map(h => h.trim().toLowerCase());
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      if (header) obj[header] = (row[i] || "").trim();  // skip columns with an empty header
    });
    return obj;
  });
}

/* One row → one object, with its _row number attached. */
function readRow_(sheet, headers, row) {
  const values = sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
  const obj = { _row: row };
  headers.forEach((header, i) => {
    if (header) obj[header] = (values[i] || "").trim();
  });
  return obj;
}

function checkRowStillMatches_(sheet, headers, row, expectedName) {
  const nameCol = headers.indexOf("name") + 1;
  const actual = sheet.getRange(row, nameCol).getDisplayValue().trim();
  if (actual !== String(expectedName).trim()) {
    throw new Error("The Sheet changed since the editor opened. Reload the page and try again.");
  }
}

/* Writes ONE cell, cleaning the value for its column first. */
function writeCell_(range, column, value) {
  const text = String(value == null ? "" : value).trim();   // null/undefined → ""

  if (column === "price") {
    // "$12.50" or "12.5" → 12.5. A blank price is allowed ("Market price" dishes).
    const number = parseFloat(text.replace(/[^0-9.]/g, ""));  // remove everything except digits and the dot
    if (isNaN(number)) {
      range.setValue("");
    } else {
      // "0.00" format keeps two decimals, so the feed says "12.50", not "12.5".
      range.setNumberFormat("0.00").setValue(number);
    }
    return;
  }

  if (column === "available") {
    const status = text.toUpperCase();
    if (!STATUS_VALUES.includes(status)) throw new Error(`Unknown status: ${value}`);
    range.setValue(status === "SOLD OUT" ? status : status === "TRUE");  // TRUE/FALSE stored as real booleans
    return;
  }

  // Yes/no columns. Writing true/false into a CHECKBOX cell checks or
  // unchecks it, and the cell stays a checkbox.
  if (column === "spicy" || column === "gluten_free" || column === "favorite") {
    range.setValue(text.toUpperCase() === "TRUE");          // true or false
    return;
  }

  if (column === "menu") {
    range.setValue(text.toLowerCase());                     // "Breakfast" → "breakfast", like the Sheet uses
    return;
  }

  // Plain text. A value starting with "=" would become a FORMULA in Sheets.
  // The leading apostrophe tells Sheets "this is just text".
  range.setValue(text.startsWith("=") ? "'" + text : text);
}
