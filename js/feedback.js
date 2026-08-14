/* ==========================================================================
   Shopping List by CJ — feedback.js
   Loads and renders approved reviews, and handles the feedback form
   submission on feedback.html.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    loadReviews();
    initFeedbackForm();
  });

  /* ------------------------------------------------------------------ */
  /* Rendering helpers                                                   */
  /* ------------------------------------------------------------------ */

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
      return new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function renderReviews(data) {
    var summary = document.getElementById('reviewsSummary');
    var score = document.getElementById('reviewsScore');
    var avgStars = document.getElementById('reviewsAverageStars');
    var count = document.getElementById('reviewsCount');
    var list = document.getElementById('reviewList');

    if (!data.reviews || data.reviews.length === 0) {
      summary.hidden = true;
      list.innerHTML = '<p class="review-empty">No reviews yet &mdash; be the first to leave one!</p>';
      return;
    }

    summary.hidden = false;
    score.textContent = data.average != null ? data.average.toFixed(1) : '–';
    avgStars.textContent = data.average != null ? starString(data.average) : '';
    count.textContent = data.count === 1 ? '1 review' : data.count + ' reviews';

    list.innerHTML = data.reviews
      .map(function (review) {
        var name = review.name ? escapeHtml(review.name) : 'Anonymous shopper';
        return (
          '<article class="review-card">' +
          '<div class="review-card-head">' +
          '<span class="review-card-name">' + name + '</span>' +
          '<span class="star-display" aria-label="' + review.rating + ' out of 5 stars">' + starString(review.rating) + '</span>' +
          '</div>' +
          '<p class="review-card-text">' + escapeHtml(review.text) + '</p>' +
          '<span class="review-card-date">' + formatDate(review.createdAt) + '</span>' +
          '</article>'
        );
      })
      .join('');
  }

  function loadReviews() {
    var list = document.getElementById('reviewList');
    if (!list) return;

    fetch('/api/feedback')
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed');
        return res.json();
      })
      .then(renderReviews)
      .catch(function () {
        list.innerHTML = '<p class="review-empty">Couldn’t load reviews right now &mdash; try refreshing.</p>';
      });
  }

  /* ------------------------------------------------------------------ */
  /* Form submission                                                     */
  /* ------------------------------------------------------------------ */

  function initFeedbackForm() {
    var form = document.getElementById('feedbackForm');
    if (!form) return;

    var textarea = document.getElementById('feedbackText');
    var charCount = document.getElementById('feedbackCharCount');
    var errorBox = document.getElementById('feedbackError');
    var submitBtn = document.getElementById('feedbackSubmit');
    var formWrap = document.getElementById('feedbackFormWrap');
    var successPanel = document.getElementById('feedbackSuccess');
    var successMessage = document.getElementById('feedbackSuccessMessage');
    var anotherBtn = document.getElementById('feedbackAnother');

    textarea.addEventListener('input', function () {
      charCount.textContent = String(textarea.value.length);
    });

    function showError(message) {
      errorBox.textContent = message;
      errorBox.classList.add('is-visible');
    }

    function clearError() {
      errorBox.textContent = '';
      errorBox.classList.remove('is-visible');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearError();

      var ratingInput = form.querySelector('input[name="rating"]:checked');
      var text = textarea.value.trim();
      var name = document.getElementById('feedbackName').value.trim();
      var website = document.getElementById('feedbackWebsite').value; // honeypot

      if (!ratingInput) {
        showError('Please choose a star rating.');
        return;
      }
      if (text.length < 3) {
        showError('Please add a little more detail to your feedback.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: Number(ratingInput.value),
          text: text,
          name: name,
          website: website,
        }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error(result.data && result.data.error ? result.data.error : 'Something went wrong.');
          }
          formWrap.hidden = true;
          successPanel.hidden = false;
          successMessage.textContent =
            (result.data && result.data.message) || "It'll appear below once it's been reviewed.";
        })
        .catch(function (err) {
          showError(err.message || 'Something went wrong — please try again.');
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit feedback';
        });
    });

    if (anotherBtn) {
      anotherBtn.addEventListener('click', function () {
        form.reset();
        charCount.textContent = '0';
        successPanel.hidden = true;
        formWrap.hidden = false;
      });
    }
  }
})();
