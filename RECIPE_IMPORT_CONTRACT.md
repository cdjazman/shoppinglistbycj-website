# Recipe Import Contract

## Purpose

Shopping List by CJ (this repo) and the marketing site
(`shoppinglistbycj-website`) are two separate repositories with separate
deploy targets — the app deploys to its own PWA URL, the website deploys to
`shoppinglistbycj.app`. They don't share a build, a package, or a runtime.
The only thing that connects them is this contract: a URL format the
website constructs and the app reads.

**This file is mirrored in both repos.** If the payload shape, validation
rules, or behaviour described here ever change on either side, update both
copies in the same change — this document, not the code comments alone, is
what keeps the two repos honest with each other.

- App repo copy (canonical — the app is the one enforcing this schema): `RECIPE_IMPORT_CONTRACT.md`
- Website repo copy: `RECIPE_IMPORT_CONTRACT.md`

---

## Why a URL, not an API

The app has no backend (see `ARCHITECTURE.md` — offline-first, Local
Storage only, no accounts). The website therefore cannot "push" a recipe
into anyone's app. The only way to move data from the website to the app is
to have the browser navigate to the app's URL carrying the data with it,
and let the app read it from the query string on load.

---

## Transport

The website builds a payload, JSON-encodes it, and appends it as a query
parameter on a link/redirect pointing at the app:

```
https://<app-domain>/?import=<encodeURIComponent(JSON.stringify(payload))>
```

`URLSearchParams.get('import')` on the receiving end already reverses the
percent-encoding, so the app parses the returned string directly as JSON —
it must not call `decodeURIComponent` on it again.

---

## Payload shape (website → app)

```json
{
  "recipeName": "Butter Chicken",
  "items": [
    { "name": "Chicken thigh fillets", "qty": 1 },
    { "name": "Garam masala", "qty": 1 }
  ]
}
```

- `recipeName` — string, optional. Free text, no uniqueness or ID requirement.
- `items` — array, required. Each entry:
  - `name` — string, required, non-empty after trimming. This is what the
    app matches against its catalogue — keep it a clean product name
    ("Chicken thigh fillets"), not a full recipe line ("700g chicken thigh
    fillets, diced"). The website's recipe pages read `data-ingredient-name`
    for this reason, separately from the human-readable ingredient text.
  - `qty` — number, optional. How many of the item to add (packs/units, not
    grams/ml) — defaults to `1` if omitted.

The website is the producer here and can send whatever it wants in these
two fields; everything below this line describes what the **app** does
with it, since the app is the side actually enforcing the contract.

---

## Validation (enforced by the app — this is untrusted input)

The payload arrives via a URL, so the app never trusts it blindly:

- `JSON.parse` failure → treated as no payload; nothing is added, no crash.
- Top level must be an object with `items` as an array — anything else is rejected.
- Each item needs a non-empty string `name` after trimming; malformed
  entries (missing name, wrong type, empty string) are silently dropped,
  not treated as an error, unless *every* item is malformed, in which case
  the whole payload is rejected as if it were absent.
- `items` is capped at **40** entries — extras beyond that are dropped, not
  an error.
- `name` is truncated to **80** characters.
- `recipeName` is truncated to **120** characters; defaults to `"your
  recipe"` if missing or not a string.
- `qty` defaults to `1` if missing, non-numeric, zero, or negative; is
  rounded to the nearest integer; is clamped to the range **1–99**.

## App behaviour on a valid import

- Each item is matched **case-insensitively by name** against the existing
  catalogue.
  - If found, the existing catalogue entry is reused as-is — its aisle,
    store, and price are **never** overwritten by an import.
  - If not found, a new catalogue entry is created with default
    `aisle: "Pantry & Dry Goods"`, `store: "Aldi"`, `price: null` — the
    website's payload doesn't currently specify these, so the user
    re-categorises later if needed.
- The item (existing or new) is added to the **current active list only**
  (`shoppingLists.getActiveList()`), with the imported `qty`. It is never
  added to any other list, and existing list memberships elsewhere are
  untouched.
- This is purely additive. It is a completely separate code path from
  Settings → Backup/Restore (see `ARCHITECTURE.md` → Backup Format), which
  is destructive and replaces the user's entire Local Storage. The two must
  never be conflated.
- The user is shown a confirmation (currently a plain `alert()`, matching
  this codebase's existing convention — there is no toast/snackbar
  component to reuse, despite earlier assumptions to the contrary).
- `?import=...` is stripped from the URL via `history.replaceState`
  immediately after the payload is read — whether valid or not — so a page
  refresh can never re-trigger or duplicate an import.

## No network calls

Handling an import never makes a network request. Matching, creation, and
list membership all happen against the in-memory/Local Storage catalogue
already loaded on the page.

---

## Where the code lives

**App repo** (`js/app.js`):
- `handleRecipeImportFromUrl()` — entry point, called once after `load()` on boot.
- `parseRecipeImportPayload()` — validation described above.
- `applyRecipeImport()` — catalogue matching/creation + list membership.

**Website repo** (`js/recipes.js`):
- `collectRecipeIngredients()` — reads `data-ingredient-name` /
  `data-ingredient-qty` off the recipe's own DOM (the rendered page is the
  single source of truth for what gets imported — there's no separate data
  file to keep in sync with the visible ingredient list).
- `buildImportUrl()` — constructs the payload and the final URL.
- `SHOPPING_LIST_APP_URL` — the app's production URL. **Currently a
  placeholder** (`https://app.shoppinglistbycj.com`) because the app isn't
  deployed to a stable production URL yet. Update this the moment it is.
- `OPEN_IMPORT_IN_NEW_TAB` — `true` while `SHOPPING_LIST_APP_URL` is a
  placeholder, so a dead link doesn't strand someone away from the recipe
  page. Set to `false` once the URL is real — same-tab navigation
  (`window.location.href`) is what lets an installed PWA intercept the
  link and open natively instead of just landing in a browser tab.

---

## Alternative considered: Web Share Target API

A `share_target` entry in `manifest.json` would let recipe pages call
`navigator.share({...})` and have the OS offer the app as a share target.
Not used for the initial version — iOS Safari's support for PWAs
*receiving* shares is limited/unreliable, and it adds more moving parts
than the URL deep link needs. Could be layered on later as a progressive
enhancement; if it is, this contract still applies to the payload shape
carried in the share data.
