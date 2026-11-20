/* =====================================================================
   MI FORTUNA MENU — APP LOGIC (v5)

   The big picture:
     1. Download the menu: dishes + categories.
        v4: from the Apps Script feed (JSON), with the local CSV files as
        a backup if the feed can't load.
     2. Turn it into objects.
     3. Keep everything in a few "state" variables (data + current settings).
     4. refresh() draws the page from that state.

   Search for these labels to find each part:
     - FAVORITES ........... NEW in v5: "Mi Fortuna Favorites" section at the top
     - MENU FEED ........... v4: loads the menu from Apps Script
     - MENU SWITCH ......... Breakfast / Lunch & Dinner buttons
     - CATEGORY CARDS ...... swipeable photo card at the top of each category
     - LANGUAGE TOGGLE ..... English / Spanish switch
     - SOLD OUT ............ "Sold out today" badge
     - SEARCH .............. search box

   KEY IDEA: state → render
   We never edit individual dishes on the page by hand. When something
   changes (menu, language, search text), we update a state variable and
   call refresh(), which redraws the menu from scratch. That keeps the code
   simple: the page always matches the state. (React and Angular are
   built on this same idea.)
   ===================================================================== */


/* ---------- CONFIG ----------
   MENU FEED: paste the /exec URL of the PUBLIC Apps Script deployment
   (the one with "Who has access: Anyone"). Leave it empty while developing
   and the local CSV files are used.
   FALLBACK: keep menu.csv and categories.csv in the folder. If the feed
   can't load, the page uses them instead. Refresh them now and then
   (File → Download → CSV from each tab) so the backup doesn't fall too
   far behind the owner's edits. */
const MENU_API_URL = "";
const LOCAL_MENU_CSV = "menu.csv";
const LOCAL_CATEGORIES_CSV = "categories.csv";

/* MENU SWITCH: the hour (24-hour clock) when the page starts opening on
   "Lunch & Dinner" instead of "Breakfast". 11 means 11:00 am.
   TODO: confirm with the owner when breakfast ends. */
const LUNCH_START_HOUR = 11;

/* FAVORITES: the name of the OPTIONAL row in the categories tab that gives
   the favorites card its photos and note. If that row doesn't exist, the
   card still shows, with the default title and note from UI_TEXT. */
const FAVORITES_CATEGORY = "Favorites";


/* ---------- STATE ---------- */
let menuItems = [];               // every dish from the sheet (both menus)
let categoryInfo = new Map();     // category name → { title_en, title_es, image_url, note_en, ... }
let currentLang = "en";           // "en" or "es"
let currentMenu = pickMenuByTime(); // MENU SWITCH: "breakfast" or "lunch", chosen from the clock at page load
let searchQuery = "";             // what the user typed, normalized (lowercase, no accents)
let sectionObserver = null;       // the scroll watcher for the tabs (see highlightTabOnScroll)


/* ---------- LANGUAGE TOGGLE: interface text in both languages ----------
   Dish text comes from the sheet. Text that belongs to the page itself
   (buttons, messages) lives here.
   UI_TEXT.en.notice is the English notice; UI_TEXT.es.notice is the Spanish one. */
const UI_TEXT = {
  en: {
    langButton: "Español",               // the button shows the language you'll switch TO
    tagline: "Mexican Restaurant",
    notice: "Closed Mondays · No substitutions in dishes",
    menuBreakfast: "Breakfast",           // MENU SWITCH: left button
    menuLunch: "Lunch & Dinner",          // MENU SWITCH: right button
    loading: "Loading menu…",
    error: "Sorry, the menu couldn't load. Please ask your server for a printed menu.",
    searchPlaceholder: "Search the menu…",
    noResults: "No dishes match",
    soldOut: "Sold out today",
    spicy: "Spicy",
    favoritesTitle: "★ Mi Fortuna Favorites",            // FAVORITES: used when the categories tab has no "Favorites" row
    favoritesNote: "Our customers' most-loved dishes.",
    favoritesTab: "★ Favorites",                         // FAVORITES: short label for the category tab
    gratuity: "For tables of 6 or more, gratuity is automatically added to your bill. Thank you!",
    healthWarning: "The Health Department has issued a warning that consuming raw or undercooked meat and eggs is hazardous to your health.",
  },
  es: {
    langButton: "English",
    tagline: "Restaurante Mexicano",
    notice: "Cerrado los lunes · No se hacen sustituciones",
    menuBreakfast: "Desayuno",
    menuLunch: "Comida y Cena",
    loading: "Cargando menú…",
    error: "Lo sentimos, el menú no pudo cargar. Pida un menú impreso a su mesero.",
    searchPlaceholder: "Buscar en el menú…",
    noResults: "Ningún platillo coincide con",
    soldOut: "Agotado hoy",
    spicy: "Picante",
    favoritesTitle: "★ Favoritos de Mi Fortuna",
    favoritesNote: "Los platillos preferidos de nuestros clientes.",
    favoritesTab: "★ Favoritos",
    gratuity: "Para mesas de 6 o más personas, la propina se agrega automáticamente a su cuenta. ¡Gracias!",
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
  // Hook up the buttons and search box first, so they work as soon as data arrives.
  setupLanguageToggle();
  setupMenuSwitch();     // MENU SWITCH: connect the two buttons and highlight the starting menu
  setupSearch();
  applyUiText();

  try {
    // MENU FEED (v4): one call gives us both lists, already as objects.
    // Destructuring: pulls the two properties out of the returned object
    // into two variables with the same names.
    const { menuObjects, categoryObjects } = await loadMenuData();

    menuItems = prepareItems(menuObjects);
    categoryInfo = prepareCategories(categoryObjects);
    refresh();
  } catch (error) {
    console.error(error);
    showStatus(ui().error);
  }
}


/* =====================================================================
   LOAD + PARSE
   ===================================================================== */

/* MENU FEED: try the Apps Script feed first, the local CSV files second.
   Either way it returns the same shape:
     { menuObjects: [ {name, price, ...}, ... ], categoryObjects: [ ... ] }
   so the rest of the app doesn't care where the data came from. */
async function loadMenuData() {
  if (MENU_API_URL) {                                   // only try the feed if a URL was pasted in CONFIG
    try {
      // "?action=menu" tells doGet() in Code.gs to send JSON, not the admin page.
      // Apps Script answers with a redirect to a googleusercontent.com address;
      // fetch() follows it by itself.
      const response = await fetch(`${MENU_API_URL}?action=menu`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // .json() turns the text into objects. If Google sent an HTML error or
      // login page instead of JSON, this line throws, and we land in catch.
      const data = await response.json();

      // Check we really got dishes (not an empty or broken answer).
      if (Array.isArray(data.menu) && data.menu.length > 0) {
        return {
          menuObjects: data.menu,
          categoryObjects: Array.isArray(data.categories) ? data.categories : [],
        };
      }
      console.warn("The feed answered, but with no dishes. Using the local CSV files.");
    } catch (error) {
      // Network down, wrong URL, deployment deleted... log it (F12 → Console), then fall through.
      console.warn(`Couldn't load the menu feed (${error.message}). Using the local CSV files.`);
    }
  }

  // BACKUP: the CSV files in this folder.
  // Promise.all starts BOTH downloads at the same time and waits for both.
  const [menuCsv, categoriesCsv] = await Promise.all([
    loadCsv(LOCAL_MENU_CSV),
    // .catch(() => "") means: if the categories file fails, use an empty
    // string instead of crashing. The menu still works, just without the
    // photo cards. The dishes matter more than the decoration.
    loadCsv(LOCAL_CATEGORIES_CSV).catch(() => ""),
  ]);

  return {
    menuObjects: rowsToObjects(parseCsv(menuCsv)),
    categoryObjects: rowsToObjects(parseCsv(categoriesCsv)),
  };
}

async function loadCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/* Reads one character at a time, tracking whether we're inside "quotes",
   so commas inside descriptions don't split the field. (Explained in v1.)
   v4: only used for the backup CSV files now. */
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

/* A GENERIC converter, used for both CSV files.
   Pairs each header with its value: { category: "Drinks", name: "Hot Tea", ... }
   It knows nothing about dishes, which is why it works for any CSV.
   (The Apps Script feed does this same step on the server: sheetToObjects_.) */
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

        // MENU SWITCH: clean up the "menu" cell. Lowercase so "Breakfast"
        // and "breakfast" both work. A blank cell (or a sheet without the
        // column) counts as "all", so old sheets keep working.
        menu: (item.menu || "all").toLowerCase(),

        // SOLD OUT (part 1): remember whether the dish is sold out.
        soldOut: status === "SOLD OUT",

        // FAVORITES: the checkbox column. A checked box arrives as "TRUE".
        // A missing column gives "" → false, so the menu still works without it.
        favorite: (item.favorite || "").toUpperCase() === "TRUE",
      };
    })
    // SOLD OUT (part 2): only FALSE hides a dish.
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
   Called on first load, on every keystroke in search, on language
   change, and on menu change.
   ===================================================================== */
function refresh() {
  const isSearching = searchQuery !== "";

  // MENU SWITCH: first keep only the dishes that belong to the chosen menu.
  // Everything below (search, tabs, cards) then works on this smaller list.
  const menuForNow = menuItems.filter(isInCurrentMenu);

  // SEARCH: keep only the dishes that match the search.
  // If nothing is typed, show everything in the chosen menu.
  const visibleItems = isSearching ? menuForNow.filter(matchesSearch) : menuForNow;

  // While searching, hide the category tabs. Some categories may have zero
  // results, so their tabs would point to sections that aren't there.
  document.getElementById("category-nav").hidden = isSearching;

  if (visibleItems.length === 0) {
    const typed = document.getElementById("search").value;
    showStatus(`${ui().noResults} “${typed}”.`);
    return;  // stop here: nothing else to draw
  }

  // FAVORITES: the favorite dishes of the menu being shown (breakfast
  // favorites in the morning, lunch favorites later). Not while searching:
  // search results should only show each dish once.
  const favorites = isSearching ? [] : menuForNow.filter(item => item.favorite);

  renderMenu(visibleItems, isSearching, favorites);

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
   MENU SWITCH: Breakfast / Lunch & Dinner
   Every dish has a "menu" cell in the sheet:
     breakfast → only on the Breakfast menu
     lunch     → only on the Lunch & Dinner menu
     all       → on both (drinks, for example)
   ===================================================================== */

/* Picks the starting menu from the customer's clock.
   new Date().getHours() returns the current hour, 0–23 (e.g. 14 = 2 pm).
   Before LUNCH_START_HOUR → breakfast, otherwise → lunch. */
function pickMenuByTime() {
  const hour = new Date().getHours();                        // current hour on the customer's phone
  return hour < LUNCH_START_HOUR ? "breakfast" : "lunch";    // ternary: condition ? if-true : if-false
}

/* Does this dish belong on the menu being shown?
   Used by refresh() with .filter(), so it runs once per dish. */
function isInCurrentMenu(item) {
  return item.menu === "all" || item.menu === currentMenu;   // shared dishes OR dishes for this menu
}

/* Connects the two buttons. Each button says which menu it opens with a
   data-menu="breakfast" / data-menu="lunch" attribute in index.html. */
function setupMenuSwitch() {
  const buttons = document.querySelectorAll(".menu-switch-btn");  // both buttons, as a list

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      const chosen = button.dataset.menu;        // reads data-menu="..." → "breakfast" or "lunch"
      if (chosen === currentMenu) return;        // tapping the menu already shown does nothing

      currentMenu = chosen;                      // 1. update the state...
      updateMenuButtons();                       // 2. ...move the highlight to the tapped button...
      scrollToMenuTop();                         // 3. ...jump back to the first category...
      if (menuItems.length > 0) refresh();       // 4. ...and redraw (skip if data hasn't loaded yet)
    });
  });

  updateMenuButtons();   // highlight the starting menu (picked by pickMenuByTime) right away
}

/* Highlights the button of the current menu and un-highlights the other. */
function updateMenuButtons() {
  document.querySelectorAll(".menu-switch-btn").forEach(button => {
    const isActive = button.dataset.menu === currentMenu;      // is this the menu being shown?
    button.classList.toggle("active", isActive);               // toggle(name, true) adds, (name, false) removes
    button.setAttribute("aria-pressed", String(isActive));     // tells screen readers which one is selected
  });
}

/* After switching menus, the customer could be halfway down the old menu.
   This scrolls back up to where the menu starts, but ONLY if they had
   scrolled past it. If they're still near the top, nothing moves. */
function scrollToMenuTop() {
  const menuStart = document.getElementById("menu").offsetTop;            // distance from page top to the menu area
  const barHeight = document.querySelector(".sticky-bar").offsetHeight;   // the sticky bar covers this much of the screen
  const target = menuStart - barHeight;                                   // stop just under the sticky bar

  if (window.scrollY > target) {          // window.scrollY = how far the page is scrolled right now
    window.scrollTo({ top: target });     // smooth scrolling comes from "scroll-behavior: smooth" in the CSS
  }
}


/* =====================================================================
   RENDER
   ===================================================================== */
function renderMenu(items, isSearching, favorites = []) {   // "= []" is a default: if no favorites are passed, use an empty list
  // Group dishes by category. Map keeps insertion order, so categories
  // appear in the same order as the rows in the sheet.
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }

  let navHtml = "";
  let menuHtml = "";

  // FAVORITES: drawn FIRST, so it's the first thing customers see.
  // The dishes ALSO stay in their normal category further down; this
  // section is a shortcut, not a move.
  if (favorites.length > 0) {
    navHtml += `<a href="#favorites">${escapeHtml(ui().favoritesTab)}</a>`;
    menuHtml += renderFavoritesSection(favorites);
  }

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

/* FAVORITES: the section at the top of the menu.
   It's a <div>, not a <section>, on purpose. The CSS colors the plain
   category cards with :nth-of-type, which counts <section> elements.
   A <section> here would shift that count and change every category's
   color. A <div> isn't counted, so the colors stay as they were.
   It still has the class "menu-section", so the tab highlighting and the
   scroll offset work exactly like a normal category. */
function renderFavoritesSection(favorites) {
  // Optional row in the categories tab with category = "Favorites".
  const info = categoryInfo.get(FAVORITES_CATEGORY) || {};
  const title = localized(info, "title") || ui().favoritesTitle;

  return `
      <div class="menu-section favorites-section" id="favorites" role="region" aria-label="${escapeHtml(title)}">
        ${renderCategoryHero(title, info, ui().favoritesNote)}
        ${favorites.map(renderItem).join("")}
      </div>`;
}

/* CATEGORY CARDS: the card at the top of each category.

   In the sheet, image_url can hold SEVERAL photos separated by "|":
       images/hero-huevos-mexicana.webp|images/hero-chilaquiles.webp
   We split that text into a list and make one <img> per photo inside a
   .hero-track. The CSS (scroll-snap) turns that row into a swipeable strip. */
function renderCategoryHero(title, info, fallbackNote = "") {
  // fallbackNote (v5): used only when the sheet has no note. FAVORITES uses it.
  const note = localized(info, "note") || fallbackNote;

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

  // One <img> per photo. The first loads right away; the rest use
  // loading="lazy" so the browser downloads them when they're needed.
  const slides = photos.map((src, i) => `
        <img class="hero-slide" src="${escapeHtml(src)}" alt="" draggable="false"${i === 0 ? "" : ' loading="lazy"'}>`
  ).join("");

  // Dots only make sense with 2+ photos. Each dot is a <button> so it can
  // be tapped or clicked. data-index="1" stores which photo it belongs to.
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
   This only (1) moves the "active" dot on swipe and (2) scrolls to a photo
   when its dot is tapped. It runs after every render because renderMenu()
   replaces the HTML, and with it the old event listeners. */
function setupHeroCarousels() {
  document.querySelectorAll(".category-hero").forEach(card => {
    const track = card.querySelector(".hero-track");
    const dots = card.querySelectorAll(".hero-dot");

    // Plain cards and single-photo cards have nothing to set up.
    if (!track || dots.length === 0) return;

    // 1. Swipe → update dots. scrollLeft / clientWidth = which photo is showing.
    track.addEventListener("scroll", () => {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
    }, { passive: true });

    // 2. Tap a dot → scroll to its photo.
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

    applyUiText();   // translate the fixed page text (header, menu buttons, footer, placeholder)

    // Redraw the dishes in the new language. The "if" avoids redrawing
    // before the data has loaded (someone tapping during "Loading…").
    if (menuItems.length > 0) refresh();
  });
}

/* Finds every element with data-i18n="someKey" and fills in UI_TEXT[lang][someKey].
   Example: <p data-i18n="notice"> gets ui().notice.
   This also translates the two MENU SWITCH buttons and the gratuity line. */
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
     4. ""                    (nothing found) */
function localized(obj, field) {
  if (currentLang === "es" && obj[`${field}_es`]) return obj[`${field}_es`];
  return obj[`${field}_en`] || obj[field] || "";
}


/* =====================================================================
   SEARCH
   Searches only the menu being shown (breakfast OR lunch), because
   refresh() filters by menu before it filters by search.
   ===================================================================== */
function setupSearch() {
  const input = document.getElementById("search");

  // "input" fires on EVERY change: typing, deleting, pasting, or the (x) button.
  input.addEventListener("input", () => {
    searchQuery = normalizeText(input.value.trim());
    refresh();
  });
}

/* Does this dish match what was typed? Name + both descriptions + category,
   all normalized, so "jalapenos" finds "jalapeños" and "HUEVOS" finds "Huevos". */
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
  // refresh() runs many times. Each run creates new sections, so we stop
  // the OLD observer first, or it would keep watching sections that are gone.
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
    // v3: -130px → -180px because the menu switch made the bar taller.
    rootMargin: "-180px 0px -65% 0px",
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
   normalize("NFD") splits "ñ" into "n" + a separate accent mark;
   the regex then deletes every accent mark (Unicode range 0300–036F). */
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
