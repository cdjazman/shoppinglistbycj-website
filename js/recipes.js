/* ==========================================================================
   Shopping List by CJ — recipes.js
   Recipe import: reads the ingredient list already rendered on the page
   for a recipe card and hands it to the app as a URL deep link.

   Shopping List by CJ has no backend — it's an offline-first PWA that
   stores everything in localStorage on-device. There is no API this
   website can call to "push" a recipe into someone's list. The only way
   to get data from here into the app is to have the browser navigate to
   the app's URL carrying the data with it, and let the app read it from
   the query string on load. See the app repo's js/app.js,
   handleRecipeImportFromUrl(), for the receiving side of this contract.
   ========================================================================== */

(function () {
  'use strict';

  // Production URL for Shopping List by CJ (Cloudflare Pages).
  var SHOPPING_LIST_APP_URL = 'https://shopping-list-by-cj.pages.dev';

  // Same-tab navigation — this is what lets an installed PWA intercept the
  // link and open natively instead of just landing in a browser tab.
  var OPEN_IMPORT_IN_NEW_TAB = false;

  var MAX_INGREDIENTS_PER_RECIPE = 40;

  document.addEventListener('DOMContentLoaded', function () {
    initRecipeImportButtons();
    initRecipeCopyButtons();
  });

  /* ------------------------------------------------------------------ */
  /* Import to Shopping List                                            */
  /* ------------------------------------------------------------------ */

  function initRecipeImportButtons() {
    var buttons = document.querySelectorAll('.recipe-import-btn');

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var card = button.closest('.recipe-card');
        if (!card) return;

        var recipeName = card.getAttribute('data-recipe-name') || 'Recipe';
        var items = collectRecipeIngredients(card);

        if (!items.length) {
          showToast("Couldn't read this recipe's ingredients — nothing to add.");
          return;
        }

        var url = buildImportUrl(recipeName, items);
        var itemWord = items.length === 1 ? 'ingredient' : 'ingredients';

        showToast(
          OPEN_IMPORT_IN_NEW_TAB
            ? 'Opening Shopping List by CJ with ' + items.length + ' ' + itemWord + '…'
            : 'Sending ' + items.length + ' ' + itemWord + ' to Shopping List by CJ…'
        );

        if (OPEN_IMPORT_IN_NEW_TAB) {
          window.open(url, '_blank', 'noopener');
        } else {
          window.location.href = url;
        }
      });
    });
  }

  // Reads the ingredient list already on the page for a given recipe
  // card — the DOM is the single source of truth, so what's shown to a
  // person reading the recipe is exactly what gets imported.
  function collectRecipeIngredients(card) {
    var rows = card.querySelectorAll('.recipe-ingredients [data-ingredient-name]');

    var items = [];
    rows.forEach(function (row) {
      var name = (row.getAttribute('data-ingredient-name') || '').trim();
      if (!name) return;

      var qty = parseInt(row.getAttribute('data-ingredient-qty'), 10);
      items.push({
        name: name,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1
      });
    });

    return items.slice(0, MAX_INGREDIENTS_PER_RECIPE);
  }

  function buildImportUrl(recipeName, items) {
    // returnUrl lets the app send the browser back to this exact recipe
    // page once the person has picked which list to add the ingredients
    // to. The app validates this against a host allowlist before ever
    // navigating to it, since it arrives as untrusted URL input.
    var payload = { recipeName: recipeName, items: items, returnUrl: window.location.href };
    var encoded = encodeURIComponent(JSON.stringify(payload));
    return SHOPPING_LIST_APP_URL.replace(/\/$/, '') + '/?import=' + encoded;
  }

  /* ------------------------------------------------------------------ */
  /* Copy list (works today, independent of the app being live)         */
  /* ------------------------------------------------------------------ */

  function initRecipeCopyButtons() {
    var buttons = document.querySelectorAll('.recipe-copy-btn');

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var card = button.closest('.recipe-card');
        if (!card) return;

        var recipeName = card.getAttribute('data-recipe-name') || 'Recipe';
        var lines = Array.prototype.slice
          .call(card.querySelectorAll('.recipe-ingredients li'))
          .map(function (li) { return '- ' + li.textContent.trim(); });

        if (!lines.length) return;

        var text = recipeName + '\n' + lines.join('\n');
        copyTextToClipboard(text).then(function () {
          showToast('Ingredient list copied.');
        }).catch(function () {
          showToast("Couldn't copy the list — try selecting it manually.");
        });
      });
    });
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      try {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        ok ? resolve() : reject(new Error('execCommand copy failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  var toastHideTimer = null;

  function showToast(message) {
    var toast = document.getElementById('recipeToast');
    if (!toast) return;

    window.clearTimeout(toastHideTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');

    toastHideTimer = window.setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 3200);
  }
})();
