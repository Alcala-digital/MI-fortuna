/* =====================================================================
   MI FORTUNA MENU — APP LOGIC (v2)

   The big picture:
     1. Download TWO CSV files at the same time: dishes and categories.
     2. Parse each into rows, then into objects.
     3. Keep everything in a few "state" variables (data + current settings).
     4. refresh() draws the page from that state.

   NEW in v2. Search for these labels to find each part:
     - CATEGORY CARDS ...... swipeable photo card at the top of each category
     - LANGUAGE TOGGLE ..... English / Spanish switch
     - SOLD OUT ............ "Sold out today" badge
     - SEARCH .............. search box

   KEY IDEA: state → render
   We never edit individual dishes on the page by hand. When something
   changes (language, search text), we update a state variable and call
   refresh(), which redraws the menu from scratch. That keeps the code
   simple: the page always matches the state. (React and Angular are
   built on this same idea.)
   ===================================================================== */


/* ---------- CONFIG ----------
   Leave the URLs empty while developing and the local CSV files are used.
   When the Google Sheet is ready, publish EACH tab separately
   (File → Share → Publish to web → pick the tab → CSV) and paste its link. */
const MENU_CSV_URL = "";
const CATEGORIES_CSV_URL = "";
const LOCAL_MENU_CSV = "menu.csv";
const LOCAL_CATEGORIES_CSV = "categories.csv";


/* ---------- STATE ---------- */
let menuItems = [];            // every dish from the sheet
let categoryInfo = new Map();  // category name → { title_en, title_es, image_url, note_en, ... }
let currentLang = "en";        // "en" or "es"
let searchQuery = "";          // what the user typed, normalized (lowercase, no accents)
let sectionObserver = null;    // the scroll watcher for the tabs (see highlightTabOnScroll)


/* ---------- LANGUAGE TOGGLE: interface text in both languages ----------
   Dish text comes from the sheet. Text that belongs to the page itself
   (buttons, messages) lives here.
   UI_TEXT.en.notice is the English notice; UI_TEXT.es.notice is the Spanish one. */
const UI_TEXT = {
  en: {
    langButton: "Español",               // the button shows the language you'll switch TO
    tagline: "Mexican Restaurant",
    notice: "Closed Mondays · No substitutions in dishes",
    loading: "Loading menu…",
    error: "Sorry, the menu couldn't load. Please ask your server for a printed menu.",
    searchPlaceholder: "Search the menu…",
    noResults: "No dishes match",
    soldOut: "Sold out today",
    spicy: "Spicy",
    healthWarning: "The Health Department has issued a warning that consuming raw or undercooked meat and eggs is hazardous to your health.",
  },
  es: {
    langButton: "English",
    tagline: "Restaurante Mexicano",
    notice: "Cerrado los lunes · No se hacen sustituciones",
    loading: "Cargando menú…",
    error: "Lo sentimos, el menú no pudo cargar. Pida un menú impreso a su mesero.",
    searchPlaceholder: "Buscar en el menú…",
    noResults: "Ningún platillo coincide con",
    soldOut: "Agotado hoy",
    spicy: "Picante",
    healthWarning: "El Departamento de Salud advierte que consumir carne o huevos crudos o poco cocidos es peligroso para su salud.",
  },
};

/* Shortcut: ui().soldOut gives "Sold out today" or "Agotado hoy"
   depending on the current language. */
function ui() {
  return UI_TEXT[currentLang];
}


/* =====================================================================
   START
   ===================================================================== */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  // Hook up the button and search box first, so they work as soon as data arrives.
  setupLanguageToggle();
  setupSearch();
  applyUiText();

  try {
    // Promise.all starts BOTH downloads at the same time and waits for both.
    // That's faster than downloading one, then the other.
    // The result is an array in the same order: [menuText, categoriesText].
    const [menuCsv, categoriesCsv] = await Promise.all([
      loadCsv(MENU_CSV_URL || LOCAL_MENU_CSV),

      // .catch(() => "") means: if the categories file fails, use an empty
      // string instead of crashing. The menu still works, just without the
      // photo cards. The dishes matter more than the decoration.
      loadCsv(CATEGORIES_CSV_URL || LOCAL_CATEGORIES_CSV).catch(() => ""),
    ]);

    menuItems = prepareItems(rowsToObjects(parseCsv(menuCsv)));
    categoryInfo = prepareCategories(rowsToObjects(parseCsv(categoriesCsv)));
    refresh();
  } catch (error) {
    console.error(error);
    showStatus(ui().error);
  }
}


/* =====================================================================
   LOAD + PARSE (same as v1, just reorganized)
   ===================================================================== */
async function loadCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/* Reads one character at a time, tracking whether we're inside "quotes",
   so commas inside descriptions don't split the field. (Explained in v1.) */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (char !== "\r") { field += char; }
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/* NEW: a GENERIC converter, used for both sheets.
   Pairs each header with its value: { category: "Drinks", name: "Hot Tea", ... }
   It knows nothing about dishes, which is why it works for any CSV. */
function rowsToObjects(rows) {
  if (rows.length === 0) return [];   // empty file (e.g. categories failed to load)

  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(values => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = (values[i] || "").trim();
    });
    return obj;
  });
}

/* Dish-specific cleanup: skip blank rows, handle "available", convert types. */
function prepareItems(objects) {
  return objects
    .filter(item => item.name)
    .map(item => {
      // (item.available || "") protects us if the column is missing entirely.
      const status = (item.available || "").toUpperCase();
      return {
        ...item,
        status,
        price: item.price ? Number(item.price) : null,
        spicy: (item.spicy || "").toUpperCase() === "TRUE",

        // SOLD OUT (part 1): remember whether the dish is sold out.
        soldOut: status === "SOLD OUT",
      };
    })
    // SOLD OUT (part 2): only FALSE hides a dish now.
    // "SOLD OUT" passes this filter, so the dish still shows, but faded.
    .filter(item => item.status !== "FALSE");
}

/* CATEGORY CARDS: turn the categories sheet into a Map for fast lookups.
   Map.get("Drinks") returns that category's info right away, with no need
   to loop through the list every time. */
function prepareCategories(objects) {
  const map = new Map();
  for (const cat of objects) {
    if (cat.category) map.set(cat.category, cat);
  }
  return map;
}


/* =====================================================================
   REFRESH: redraw the page from the current state
   Called on first load, on every keystroke in search, and on language change.
   ===================================================================== */
function refresh() {
  const isSearching = searchQuery !== "";

  // SEARCH: keep only the dishes that match the search.
  // If nothing is typed, show everything.
  const visibleItems = isSearching ? menuItems.filter(matchesSearch) : menuItems;

  // While searching, hide the category tabs. Some categories may have zero
  // results, so their tabs would point to sections that aren't there.
  document.getElementById("category-nav").hidden = isSearching;

  if (visibleItems.length === 0) {
    const typed = document.getElementById("search").value;
    showStatus(`${ui().noResults} “${typed}”.`);
    return;  // stop here: nothing else to draw
  }

  renderMenu(visibleItems, isSearching);

  // The tabs and the photo cards only exist when we're NOT searching.
  if (!isSearching) {
    highlightTabOnScroll();
    setupHeroCarousels();
  }
}

/* Replaces the menu area with a single message (loading, error, no results). */
function showStatus(message) {
  document.getElementById("menu").innerHTML = `<p class="status">${escapeHtml(message)}</p>`;
}


/* =====================================================================
   RENDER
   ===================================================================== */
function renderMenu(items, isSearching) {
  // Group dishes by category. Map keeps insertion order, so categories
  // appear in the same order as the rows in the sheet.
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }

  let navHtml = "";
  let menuHtml = "";

  for (const [category, dishes] of groups) {
    const id = slugify(category);

    // Look up this category's extra info. "|| {}" means: if the categories
    // sheet doesn't have this category, use an empty object, so the code
    // below still works (just with no photo or note).
    const info = categoryInfo.get(category) || {};

    // Translated title, falling back to the raw category name.
    const title = localized(info, "title") || category;

    navHtml += `<a href="#${id}">${escapeHtml(title)}</a>`;

    // While searching: a small plain heading, so results aren't buried
    // under big photos. Otherwise: the full category card.
    const heading = isSearching
      ? `<h2 class="search-heading">${escapeHtml(title)}</h2>`
      : renderCategoryHero(title, info);

    menuHtml += `
      <section class="menu-section" id="${id}">
        ${heading}
        ${dishes.map(renderItem).join("")}
      </section>`;
  }

  document.getElementById("category-nav").innerHTML = navHtml;
  document.getElementById("menu").innerHTML = menuHtml;
}

/* CATEGORY CARDS: the card at the top of each category.

   In the sheet, image_url can hold SEVERAL photos separated by "|":
       images/hero-huevos-mexicana.webp|images/hero-chilaquiles.webp
   We split that text into a list and make one <img> per photo inside a
   .hero-track. The CSS (scroll-snap) turns that row into a swipeable strip. */
function renderCategoryHero(title, info) {
  const note = localized(info, "note");

  // "a.webp|b.webp" → ["a.webp", "b.webp"]
  // .map(trim) removes accidental spaces ("a.webp | b.webp" still works).
  // .filter(Boolean) drops empty strings: a blank cell gives [] instead of [""].
  const photos = (info.image_url || "")
    .split("|")
    .map(path => path.trim())
    .filter(Boolean);

  const textHtml = `
      <div class="hero-text">
        <h2>${escapeHtml(title)}</h2>
        ${note ? `<p class="hero-note">${escapeHtml(note)}</p>` : ""}
      </div>`;

  // No photos: a plain colored card with just the text.
  if (photos.length === 0) {
    return `<div class="category-hero no-photo">${textHtml}</div>`;
  }

  // One <img> per photo. map() receives (item, index); we use the index
  // to treat the first photo differently from the rest.
  //   - alt="": the photos are decoration (the title already says what the
  //     section is), so screen readers skip them.
  //   - draggable="false": stops desktop browsers from "picking up" the
  //     image as a file when you click and drag.
  //   - First photo: loads right away (it's what you see first).
  //     Others: loading="lazy", so the browser decides when to download them.
  //     Browsers start a little early (before the photo is on screen), so
  //     on a short menu they load almost right away, and there's never a
  //     blank flash when someone swipes. On a long menu, cards far down the
  //     page wait until the customer scrolls closer.
  const slides = photos.map((src, i) => `
        <img class="hero-slide" src="${escapeHtml(src)}" alt="" draggable="false"${i === 0 ? "" : ' loading="lazy"'}>`
  ).join("");

  // Dots only make sense with 2+ photos. Each dot is a <button> so it can
  // be tapped or clicked (handy on desktop, where you can't swipe).
  // data-index="1" stores which photo the dot belongs to; JS reads it later.
  // "_" is a common name for a parameter we don't use (here: the photo path).
  const dots = photos.length > 1
    ? `<div class="hero-dots">${photos.map((_, i) =>
        `<button type="button" class="hero-dot${i === 0 ? " active" : ""}" data-index="${i}" aria-label="Photo ${i + 1} of ${photos.length}"></button>`
      ).join("")}</div>`
    : "";

  return `
    <div class="category-hero">
      <div class="hero-track">${slides}
      </div>
      ${textHtml}
      ${dots}
    </div>`;
}

/* CATEGORY CARDS: make the dots work.
   Swiping itself needs NO JavaScript; the browser does it (scroll-snap).
   This function only:
     1. moves the "active" dot when the photos are swiped
     2. scrolls to a photo when its dot is tapped

   Why this runs after every render: renderMenu() replaces the HTML, which
   throws away the old elements AND their event listeners. So the new cards
   need new listeners. (Old listeners are cleaned up automatically along
   with their elements.) */
function setupHeroCarousels() {
  document.querySelectorAll(".category-hero").forEach(card => {
    const track = card.querySelector(".hero-track");
    const dots = card.querySelectorAll(".hero-dot");

    // Plain cards and single-photo cards have nothing to set up.
    if (!track || dots.length === 0) return;

    // 1. Swipe → update dots.
    // scrollLeft = how far the strip has scrolled, in pixels.
    // clientWidth = the width of one photo (the card width).
    // Example: card 350px wide, scrolled 700px → 700 / 350 = photo 2 (index 2).
    // Math.round picks the closest photo while the swipe is still moving.
    // { passive: true } promises the browser we won't block scrolling,
    // which keeps swiping smooth on phones.
    track.addEventListener("scroll", () => {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
    }, { passive: true });

    // 2. Tap a dot → scroll to its photo.
    // dot.dataset.index reads data-index="..." (always a string, so Number()).
    dots.forEach(dot => {
      dot.addEventListener("click", () => {
        const index = Number(dot.dataset.index);
        track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
      });
    });
  });
}

/* One dish. Optional parts only appear when the sheet has a value. */
function renderItem(item) {
  const description = localized(item, "description");
  const options = localized(item, "options");

  const photo = item.image_url
    ? `<img class="item-photo" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">`
    : "";
  const price = item.price !== null ? `<span class="item-price">${formatPrice(item.price)}</span>` : "";
  const spicy = item.spicy ? ` <span class="spicy" title="${ui().spicy}">🌶️</span>` : "";
  const desc = description ? `<p class="item-desc">${escapeHtml(description)}</p>` : "";
  const opts = options ? `<p class="item-options">${escapeHtml(options)}</p>` : "";

  // SOLD OUT (part 3): an extra CSS class and a badge when sold out.
  const soldOutClass = item.soldOut ? " sold-out" : "";
  const badge = item.soldOut ? `<span class="badge">${ui().soldOut}</span>` : "";

  return `
    <article class="item${soldOutClass}">
      ${photo}
      <div class="item-body">
        <div class="item-header">
          <h3 class="item-name">${escapeHtml(item.name)}${spicy}</h3>
          ${price}
        </div>
        ${desc}
        ${opts}
        ${badge}
      </div>
    </article>`;
}


/* =====================================================================
   LANGUAGE TOGGLE
   ===================================================================== */
function setupLanguageToggle() {
  const button = document.getElementById("lang-toggle");

  button.addEventListener("click", () => {
    // Ternary flip: if English, switch to Spanish; otherwise switch to English.
    currentLang = currentLang === "en" ? "es" : "en";

    applyUiText();   // translate the fixed page text (header, footer, placeholder)

    // Redraw the dishes in the new language. The "if" avoids redrawing
    // before the data has loaded (someone tapping during "Loading…").
    if (menuItems.length > 0) refresh();
  });
}

/* Finds every element with data-i18n="someKey" and fills in UI_TEXT[lang][someKey].
   Example: <p data-i18n="notice"> gets ui().notice.
   el.dataset.i18n reads the value of the data-i18n attribute. */
function applyUiText() {
  const text = ui();

  // Tells the browser (and screen readers) which language the page is in.
  document.documentElement.lang = currentLang;

  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (text[key]) el.textContent = text[key];
  });

  // Placeholders are attributes, not text content, so they need their own line.
  document.getElementById("search").placeholder = text.searchPlaceholder;
}

/* Picks the right language version of a field, with fallbacks.
   localized(item, "description") checks, in order:
     1. item.description_es   (only when the page is in Spanish)
     2. item.description_en
     3. item.description      (a column with no language suffix)
     4. ""                    (nothing found)
   This is the same idea as v1's getDescription(), but reusable for ANY
   field: description, options, title, note... */
function localized(obj, field) {
  if (currentLang === "es" && obj[`${field}_es`]) return obj[`${field}_es`];
  return obj[`${field}_en`] || obj[field] || "";
}


/* =====================================================================
   SEARCH
   ===================================================================== */
function setupSearch() {
  const input = document.getElementById("search");

  // "input" fires on EVERY change: typing, deleting, pasting, or the (x)
  // clear button. ("change" would only fire when the box loses focus.)
  input.addEventListener("input", () => {
    searchQuery = normalizeText(input.value.trim());
    refresh();
  });
}

/* Does this dish match what was typed?
   We glue name + both descriptions + category into one string and check
   whether the search text appears anywhere in it. Both sides are
   normalized, so "jalapenos" finds "jalapeños" and "HUEVOS" finds "Huevos". */
function matchesSearch(item) {
  const searchableText = normalizeText(
    [item.name, item.description_en, item.description_es, item.category].join(" ")
  );
  return searchableText.includes(searchQuery);
}


/* =====================================================================
   ACTIVE TAB: highlight the tab of the section on screen
   ===================================================================== */
function highlightTabOnScroll() {
  // IMPORTANT for v2: refresh() runs many times now. Each run creates new
  // sections, so we must stop the OLD observer first. Otherwise it would keep
  // watching sections that no longer exist (a "memory leak").
  if (sectionObserver) sectionObserver.disconnect();

  const links = document.querySelectorAll(".category-nav a");

  sectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach(link => {
        const isActive = link.getAttribute("href") === `#${entry.target.id}`;
        link.classList.toggle("active", isActive);
        if (isActive) link.scrollIntoView({ inline: "center", block: "nearest" });
      });
    }
  }, {
    // A band near the top of the screen, just under the sticky bar.
    rootMargin: "-130px 0px -65% 0px",
  });

  document.querySelectorAll(".menu-section").forEach(s => sectionObserver.observe(s));
}


/* =====================================================================
   HELPERS
   ===================================================================== */
function formatPrice(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/* Lowercase and remove accents: "Jalapeños" → "jalapenos".
   normalize("NFD") splits "ñ" into "n" + a separate tilde mark; the regex
   then deletes those marks (Unicode range ̀–ͯ). */
function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/* "Mini Fortuna · Kids 12 & under" → "mini-fortuna-kids-12-under" (safe for ids) */
function slugify(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, "-")   // anything that isn't a letter or number → "-"
    .replace(/^-|-$/g, "");        // trim dashes from the start and end
}

/* Turns < > & " ' into harmless text before inserting sheet data into
   innerHTML, so a cell can never inject HTML or scripts. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
