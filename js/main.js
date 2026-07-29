/* ==========================================================================
   Shopping List by CJ — main.js
   Mobile nav toggle, screenshot gallery, scroll reveal, footer year.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    initNavToggle();
    initScreenshotGallery();
    initScrollReveal();
    initFooterYear();
  });

  /* ------------------------------------------------------------------ */
  /* Mobile navigation toggle                                           */
  /* ------------------------------------------------------------------ */

  function initNavToggle() {
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('primaryNav');

    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close menu when a nav link is clicked (mobile).
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        if (nav.classList.contains('is-open')) {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    });

    // Close menu on Escape.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Screenshot gallery                                                  */
  /* ------------------------------------------------------------------ */

  function initScreenshotGallery() {
    var featured = document.getElementById('featuredScreenshot');
    var strip = document.getElementById('thumbStrip');

    if (!featured || !strip) return;

    var thumbs = Array.prototype.slice.call(strip.querySelectorAll('.thumb'));

    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        var src = thumb.getAttribute('data-src');
        if (!src || featured.getAttribute('src') === src) return;

        setActiveThumb(thumb, thumbs);
        swapFeaturedImage(featured, src);
      });
    });

    // Keyboard support: left/right arrow moves between thumbnails.
    strip.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;

      var currentIndex = thumbs.findIndex(function (t) {
        return t === document.activeElement;
      });

      if (currentIndex === -1) return;

      e.preventDefault();
      var nextIndex =
        e.key === 'ArrowRight'
          ? (currentIndex + 1) % thumbs.length
          : (currentIndex - 1 + thumbs.length) % thumbs.length;

      var nextThumb = thumbs[nextIndex];
      nextThumb.focus();
      nextThumb.click();
    });
  }

  function setActiveThumb(activeThumb, allThumbs) {
    allThumbs.forEach(function (thumb) {
      var isActive = thumb === activeThumb;
      thumb.classList.toggle('is-active', isActive);
      thumb.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function swapFeaturedImage(featured, src) {
    var prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (prefersReducedMotion) {
      featured.setAttribute('src', src);
      return;
    }

    featured.classList.add('is-fading');

    window.setTimeout(function () {
      featured.setAttribute('src', src);
      featured.classList.remove('is-fading');
    }, 180);
  }

  /* ------------------------------------------------------------------ */
  /* Reveal on scroll                                                    */
  /* ------------------------------------------------------------------ */

  function initScrollReveal() {
    var targets = document.querySelectorAll('.reveal');

    if (!targets.length) return;

    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (el) {
        el.classList.add('is-visible');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.15,
        rootMargin: '0px 0px -40px 0px'
      }
    );

    targets.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Footer year                                                         */
  /* ------------------------------------------------------------------ */

  function initFooterYear() {
    var yearEl = document.getElementById('currentYear');
    if (!yearEl) return;
    yearEl.textContent = String(new Date().getFullYear());
  }
})();