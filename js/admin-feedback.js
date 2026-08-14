/* ==========================================================================
   Shopping List by CJ — admin-feedback.js
   Private moderation UI for admin-feedback.html. Token is kept in
   localStorage after first entry purely for convenience (this page is
   unlinked and unindexed, not a substitute for real auth) - clear your
   browser storage or use a private window on a shared machine.
   ========================================================================== */

(function () {
  'use strict';

  var TOKEN_STORAGE_KEY = 'slbycj-admin-token';

  document.addEventListener('DOMContentLoaded', function () {
    var stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      unlock(stored);
    }
    initTokenForm();
  });

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function starString(rating) {
    var full = Math.round(rating);
    return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-AU', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return '';
    }
  }

  function initTokenForm() {
    var form = document.getElementById('tokenForm');
    var errorBox = document.getElementById('tokenError');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var token = document.getElementById('tokenInput').value.trim();
      if (!token) return;
      errorBox.classList.remove('is-visible');
      loadQueue(token, function (ok) {
        if (ok) {
          window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
          unlock(token);
        } else {
          errorBox.textContent = 'That token was rejected — check it against ADMIN_TOKEN in Cloudflare Pages.';
          errorBox.classList.add('is-visible');
        }
      });
    });
  }

  function unlock(token) {
    document.getElementById('tokenGate').hidden = true;
    document.getElementById('queueWrap').hidden = false;
    loadQueue(token);

    document.getElementById('refreshBtn').addEventListener('click', function () {
      loadQueue(token);
    });
  }

  function loadQueue(token, onDone) {
    fetch('/api/admin-feedback?token=' + encodeURIComponent(token))
      .then(function (res) {
        if (!res.ok) throw new Error('unauthorized');
        return res.json();
      })
      .then(function (data) {
        renderQueue(data.pending || [], token);
        if (onDone) onDone(true);
      })
      .catch(function () {
        if (onDone) {
          onDone(false);
        } else {
          // Token went stale mid-session (e.g. rotated) — bounce back to the gate.
          window.localStorage.removeItem(TOKEN_STORAGE_KEY);
          document.getElementById('tokenGate').hidden = false;
          document.getElementById('queueWrap').hidden = true;
        }
      });
  }

  // Display labels for Llama Guard's category codes - falls back to the
  // raw code for anything not in this list, so nothing breaks if
  // Cloudflare's taxonomy changes.
  var MODERATION_LABELS = {
    S1: 'Violent crimes', S2: 'Non-violent crimes', S3: 'Sex-related crimes',
    S4: 'Child sexual exploitation', S5: 'Defamation', S6: 'Specialized advice',
    S7: 'Privacy', S8: 'Intellectual property', S9: 'Weapons',
    S10: 'Hate / degrading language', S11: 'Suicide & self-harm',
    S12: 'Sexual content', S13: 'Elections', S14: 'Code interpreter abuse',
    blocklist: 'Blocked word',
  };

  function moderationSummary(item) {
    var categories = (item.moderation && item.moderation.categories) || [];
    if (!categories.length) return 'Flagged by automated moderation';
    return categories
      .map(function (code) { return MODERATION_LABELS[code] || code; })
      .join(', ');
  }

  function renderQueue(pending, token) {
    document.getElementById('queueCount').textContent = String(pending.length);
    var list = document.getElementById('queueList');

    if (pending.length === 0) {
      list.innerHTML = '<p class="review-empty">Nothing waiting for review.</p>';
      return;
    }

    // Flagged items float to the top so they're not missed among a long queue.
    var sorted = pending.slice().sort(function (a, b) {
      var aFlagged = a.moderation && a.moderation.flagged ? 1 : 0;
      var bFlagged = b.moderation && b.moderation.flagged ? 1 : 0;
      return bFlagged - aFlagged;
    });

    list.innerHTML = sorted
      .map(function (item) {
        var name = item.name ? escapeHtml(item.name) : 'Anonymous shopper';
        var flagged = Boolean(item.moderation && item.moderation.flagged);
        var textBlock = flagged
          ? '<div class="review-flag-banner">⚠️ Flagged: ' + escapeHtml(moderationSummary(item)) + '</div>' +
            '<button type="button" class="btn btn-small review-reveal-btn" data-action="reveal">Show flagged text</button>' +
            '<p class="review-card-text" data-flagged-text hidden>' + escapeHtml(item.text) + '</p>'
          : '<p class="review-card-text">' + escapeHtml(item.text) + '</p>';

        return (
          '<div class="admin-item' + (flagged ? ' admin-item--flagged' : '') + '" data-id="' + escapeHtml(item.id) + '">' +
          '<div class="review-card-head">' +
          '<span class="review-card-name">' + name + '</span>' +
          '<span class="star-display" aria-label="' + item.rating + ' out of 5 stars">' + starString(item.rating) + '</span>' +
          '</div>' +
          textBlock +
          '<span class="review-card-date">' + formatDate(item.createdAt) + '</span>' +
          '<div class="admin-item-actions">' +
          '<button type="button" class="btn btn-small btn-approve" data-action="approve">Approve</button>' +
          '<button type="button" class="btn btn-small btn-reject" data-action="reject">Reject</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    list.querySelectorAll('button[data-action="reveal"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var itemEl = btn.closest('.admin-item');
        var textEl = itemEl.querySelector('[data-flagged-text]');
        textEl.hidden = false;
        btn.hidden = true;
      });
    });

    list.querySelectorAll('button[data-action="approve"], button[data-action="reject"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var itemEl = btn.closest('.admin-item');
        var id = itemEl.getAttribute('data-id');
        var action = btn.getAttribute('data-action');

        list.querySelectorAll('button').forEach(function (b) { b.disabled = true; });

        fetch('/api/admin-feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, id: id, action: action }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Request failed');
            return res.json();
          })
          .then(function () {
            itemEl.remove();
            var remaining = list.querySelectorAll('.admin-item').length;
            document.getElementById('queueCount').textContent = String(remaining);
            if (remaining === 0) {
              list.innerHTML = '<p class="review-empty">Nothing waiting for review.</p>';
            }
          })
          .catch(function () {
            list.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
            alert('Something went wrong — try again.');
          });
      });
    });
  }
})();
