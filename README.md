# Mi Fortuna — Digital Menu (v2)

## Files
- `index.html`: page structure (header, search, tabs, empty menu, footer)
- `styles.css`: all styling; colors live in the `:root` variables at the top
- `app.js`: all the logic. Read the top comment first, then search for
  `CATEGORY CARDS`, `LANGUAGE TOGGLE`, `SOLD OUT`, `SEARCH`
- `menu.csv`: dishes (becomes tab 1 of the Google Sheet)
- `categories.csv`: category titles, photos and notes (becomes tab 2)

## Run it locally
Opening index.html by double-clicking won't load the menu (the browser blocks fetch() from file://).
- VS Code: "Live Server" extension → right-click index.html → Open with Live Server
- or in a terminal in this folder: `python -m http.server` → http://localhost:8000

## Connect the Google Sheet
1. New Google Sheet → File → Import → upload `menu.csv` → "Replace current sheet". Rename the tab `menu`.
2. Add a second tab named `categories` → File → Import → upload `categories.csv` → "Replace current sheet".
3. File → Share → Publish to web → choose the `menu` tab → CSV → Publish → copy the link into `MENU_CSV_URL`.
4. Do the same for the `categories` tab → `CATEGORIES_CSV_URL`.
5. Google caches published sheets, so edits can take a few minutes to appear.

## menu tab columns
| column | what it does |
|---|---|
| category | must match a `category` in the categories tab exactly |
| name | dish name (same in both languages) |
| description_en / description_es | Spanish falls back to English if empty |
| price | number only, e.g. `12.50` (blank = no price shown) |
| options_en / options_es | small red line for add-ons and sizes |
| spicy | `TRUE` shows 🌶️ |
| image_url | optional square dish photo, e.g. `images/chilaquiles.webp` |
| available | `TRUE` (or blank) = shown · `SOLD OUT` = shown faded with badge · `FALSE` = hidden |

## categories tab columns
| column | what it does |
|---|---|
| category | the key that matches the menu tab |
| title_en / title_es | heading shown on the card and the tab |
| image_url | wide photo(s) for the card. Several photos make it swipeable; separate them with `\|`: `images/a.webp\|images/b.webp` (blank = colored card) |
| note_en / note_es | line under the heading ("Served with…", "Includes a drink") |

## Photos
- Category cards: landscape, about 1600×900. Dish photos: square, about 400×400.
- Convert them to WebP at squoosh.app and keep each one under about 200 KB.
- Put them in an `images/` folder next to index.html.
- Suggested: 2–3 swipeable photos per main category card, plus 1 dish thumbnail per category.
- The demo photos are AI-edited samples to show the layout. For the real menu, use photos of their actual dishes.

## Before showing the client
- **Crepes is set to `SOLD OUT` only as a demo.** Change it back to `TRUE`.
- The Spanish translations are mine. Have the restaurant check the wording
  (e.g. "hotcakes" vs "panqueques", "refill").
- Still to confirm: the "Almuerzo Fortuna" name (glare in the photo), the
  apple/cranberry juice price, and the T-Bone add-on ($12 handwritten over $10).
