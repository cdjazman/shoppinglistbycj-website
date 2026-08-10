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
  ],
  "returnUrl": "https://shoppinglistbycj.app/recipes/butter-chicken.html"
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
- `returnUrl` — string, optional. The recipe page's own URL
  (`window.location.href` at send time). If present and valid, the app
  navigates back here once the import is finished, so the person ends up
  back on the recipe they just added, not stranded in the app. See
  Validation below — this is the one field the app is strict rather than
  lenient about, since blindly following an arbitrary URL from untrusted
  input is an open-redirect risk.

The website is the producer here and can send whatever it wants in these
fields; everything below this line describes what the **app** does with
it, since the app is the side actually enforcing the contract.

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
- `returnUrl` must parse as an absolute `http:`/`https:` URL whose hostname
  is on an allowlist (`shoppinglistbycj.app`, `www.shoppinglistbycj.app`,
  plus `localhost`/`127.0.0.1` for local dev) — anything else (a different
  host, a `javascript:`/`ftp:` scheme, unparseable text, or a string over
  2000 characters) is dropped rather than followed. This is the one field
  where a malformed value doesn't fall back to a default; it's simply
  treated as absent, and the app just doesn't navigate anywhere afterwards.

## App behaviour on a valid import

- The person is asked **which list** to add the ingredients to, via a
  dialog listing every existing list plus a **"Create new list"** option —
  the import is never silently forced onto whichever list happens to be
  active. This dialog always shows, even with only one existing list,
  since "make a new list instead" is a real choice regardless of how many
  lists already exist.
  - Picking an existing list adds the ingredients there directly.
  - Picking "Create new list" opens the app's normal new-list form, with
    the name field pre-filled (and pre-selected, so it's easy to overwrite)
    with the recipe's name — `payload.recipeName`. Any other field (icon,
    colour, budget) uses the same defaults as creating a list normally.
    Saving that form creates the list and finishes the import into it;
    cancelling it abandons the import entirely, same as cancelling the
    list-choice dialog itself.
- Once a list is chosen (existing or newly created), each item is matched
  **case-insensitively by name** against the existing catalogue.
  - If found, the existing catalogue entry is reused as-is — its aisle,
    store, and price are **never** overwritten by an import.
  - If not found, a new catalogue entry is created with default
    `aisle: "Pantry & Dry Goods"`, `store: "Aldi"`, `price: null` — the
    website's payload doesn't currently specify these, so the user
    re-categorises later if needed.
- The item (existing or new) is added to the **chosen list only**, with the
  imported `qty`, and that list becomes the app's active list. It is never
  added to any other list, and existing list memberships elsewhere are
  untouched.
- This is purely additive. It is a completely separate code path from
  Settings → Backup/Restore (see `ARCHITECTURE.md` → Backup Format), which
  is destructive and replaces the user's entire Local Storage. The two must
  never be conflated.
- The user is shown a confirmation (currently a plain `alert()`, matching
  this codebase's existing convention — there is no toast/snackbar
  component to reuse, despite earlier assumptions to the contrary).
- After the confirmation is dismissed, if `returnUrl` was present and
  passed validation, the app navigates the browser there — back to the
  recipe page the import started from. If there's no valid `returnUrl`,
  the person just stays in the app on the list they picked.
- If the person cancels the list-choice dialog, or opens the new-list form
  from it and then cancels that instead of saving, nothing is imported and
  there is no navigation — this matches the malformed-payload case in
  leaving the person exactly where they were.
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
- `parseRecipeImportPayload()` / `sanitizeRecipeImportReturnUrl()` — validation described above.
- `showRecipeImportListPicker()` — the list-choice dialog (dynamically built, matching the existing `list-card__delete-dialog` pattern); always offers every existing list plus "Create new list".
- `pendingRecipeImportPayload` — set when "Create new list" is chosen, so the existing `openNewListModal()` / `saveNewList()` flow knows to finish the import into the list it creates rather than just closing the modal; cleared on any modal close.
- `finishRecipeImport()` — makes the chosen (or newly created) list active, applies the import, confirms, then navigates to `returnUrl` if present.
- `applyRecipeImport()` — catalogue matching/creation + list membership for a given target list.
- `js/lists.js` exposes `getSortedLists()` and `getIconDisplay()` on `window.shoppingLists` (previously internal-only) so the picker can enumerate and render every list.

**Website repo** (`js/recipes.js`):
- `collectRecipeIngredients()` — reads `data-ingredient-name` /
  `data-ingredient-qty` off the recipe's own DOM (the rendered page is the
  single source of truth for what gets imported — there's no separate data
  file to keep in sync with the visible ingredient list).
- `buildImportUrl()` — constructs the payload and the final URL.
- `SHOPPING_LIST_APP_URL` — the app's production URL:
  `https://shopping-list-by-cj.pages.dev` (Cloudflare Pages). Update this
  if the app ever moves to a different production domain.
- `OPEN_IMPORT_IN_NEW_TAB` — `false` now that `SHOPPING_LIST_APP_URL` is
  real. Same-tab navigation (`window.location.href`) is what lets an
  installed PWA intercept the link and open natively instead of just
  landing in a browser tab. Only set this back to `true` temporarily if
  the production URL is ever broken/unreachable again, so a dead link
  doesn't strand someone away from the recipe page.

---

## Alternative considered: Web Share Target API

A `share_target` entry in `manifest.json` would let recipe pages call
`navigator.share({...})` and have the OS offer the app as a share target.
Not used for the initial version — iOS Safari's support for PWAs
*receiving* shares is limited/unreliable, and it adds more moving parts
than the URL deep link needs. Could be layered on later as a progressive
enhancement; if it is, this contract still applies to the payload shape
carried in the share data.
