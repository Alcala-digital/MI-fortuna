# Mi Fortuna — Digital Menu (v3)

## Files
- `index.html`: page structure (header, menu switch, search, tabs, empty menu, footer)
- `styles.css`: all styling; colors live in the `:root` variables at the top
- `app.js`: all the logic. Read the top comment first, then search for
  `MENU SWITCH`, `CATEGORY CARDS`, `LANGUAGE TOGGLE`, `SOLD OUT`, `SEARCH`
- `menu.csv`: dishes (becomes the `menu` tab of the Google Sheet)
- `categories.csv`: category titles, photos and notes (becomes the `categories` tab)

## What's new in v3
- **Menu switch:** Breakfast / Lunch & Dinner buttons above the search box.
  The page opens on Breakfast before `LUNCH_START_HOUR` (top of app.js, currently 11)
  and on Lunch & Dinner after. Search only looks inside the menu being shown.
- **Footer:** gratuity note for tables of 6+ (English and Spanish).
- **Full lunch/dinner menu** in the CSVs, plus new `menu` and `gluten_free` columns.

## Run it locally
Opening index.html by double-clicking won't load the menu (the browser blocks fetch() from file://).
- VS Code: "Live Server" extension → right-click index.html → Open with Live Server
- or in a terminal in this folder: `python -m http.server` → http://localhost:8000

## Connect the Google Sheet
1. New Google Sheet → File → Import → upload `Mi-Fortuna-Menu.xlsx` → "Replace spreadsheet".
   (Or import `menu.csv` and `categories.csv` into tabs named `menu` and `categories`.)
2. File → Share → Publish to web → choose the `menu` tab → CSV → Publish → copy the link into `MENU_CSV_URL`.
3. Do the same for the `categories` tab → `CATEGORIES_CSV_URL`.
4. Google caches published sheets, so edits can take a few minutes to appear.

## menu tab columns
| column | what it does |
|---|---|
| menu | `breakfast`, `lunch`, or `all` (shows on both). Blank = `all` |
| category | must match a `category` in the categories tab exactly |
| name | dish name (same in both languages) |
| description_en / description_es | Spanish falls back to English if empty |
| price | number only, e.g. `12.50` (blank = no price shown, e.g. Market price) |
| options_en / options_es | small red line for add-ons, sizes and price breakdowns |
| spicy | `TRUE` shows 🌶️ |
| gluten_free | `TRUE`/`FALSE`. Stored for later; the page doesn't show it yet |
| image_url | optional square dish photo, e.g. `images/chilaquiles.webp` |
| available | `TRUE` (or blank) = shown · `SOLD OUT` = shown faded with badge · `FALSE` = hidden |
| review | internal notes only (in the Google Sheet, not in the CSVs). Never shown |

## categories tab columns
| column | what it does |
|---|---|
| menu | which menu the section belongs to (for reference; the dishes decide what shows) |
| category | the key that matches the menu tab. Must be unique, so breakfast and lunch sections use different keys (`Breakfast Sides` vs `Side Orders`) even when their titles match |
| title_en / title_es | heading shown on the card and the tab |
| image_url | wide photo(s) for the card. Several photos make it swipeable; separate them with `\|` (blank = colored card) |
| note_en / note_es | line under the heading ("Served with…", "Includes a drink") |

## Photos
- Category cards: landscape, about 1600×900. Dish photos: square, about 400×400.
- Convert them to WebP at squoosh.app and keep each one under about 200 KB.
- Put them in an `images/` folder next to index.html.
- The demo photos are AI-edited samples. Golden Toast still uses the pancake placeholder.

## Before showing the client
- Confirm when breakfast ends (`LUNCH_START_HOUR` in app.js).
- Go through the `pending` tab of the Google Sheet with the owner.
- The Spanish translations are mine. Have the restaurant check the wording.
