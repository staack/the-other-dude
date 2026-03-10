/* TOD Documentation Website — Shared JavaScript */

(function () {
  'use strict';

  /* -------------------------------------------------- */
  /*  1. Scroll Spy (docs page)                         */
  /* -------------------------------------------------- */
  function initScrollSpy() {
    const sidebar = document.querySelector('.sidebar-nav');
    if (!sidebar) return;

    const links = Array.from(document.querySelectorAll('.sidebar-link'));
    const sections = links
      .map(function (link) {
        var id = link.getAttribute('data-section');
        return id ? document.getElementById(id) : null;
      })
      .filter(Boolean);

    if (!sections.length) return;

    var current = null;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var id = entry.target.id;
            if (id !== current) {
              current = id;
              links.forEach(function (l) {
                l.classList.toggle(
                  'sidebar-link--active',
                  l.getAttribute('data-section') === id
                );
              });

              /* keep active link visible in sidebar */
              var active = sidebar.querySelector('.sidebar-link--active');
              if (active) {
                active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              }
            }
          }
        });
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    sections.forEach(function (s) {
      observer.observe(s);
    });
  }

  /* -------------------------------------------------- */
  /*  2. Docs Search                                    */
  /* -------------------------------------------------- */
  function initDocsSearch() {
    var input = document.getElementById('docs-search-input');
    if (!input) return;

    var content = document.getElementById('docs-content');
    if (!content) return;

    var sections = Array.from(content.querySelectorAll('section[id]'));
    var links = Array.from(document.querySelectorAll('.sidebar-link'));

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();

      if (!q) {
        sections.forEach(function (s) { s.style.display = ''; });
        links.forEach(function (l) { l.style.display = ''; });
        return;
      }

      sections.forEach(function (s) {
        var text = s.textContent.toLowerCase();
        var match = text.indexOf(q) !== -1;
        s.style.display = match ? '' : 'none';
      });

      links.forEach(function (l) {
        var sectionId = l.getAttribute('data-section');
        var section = sectionId ? document.getElementById(sectionId) : null;
        if (section) {
          l.style.display = section.style.display;
        }
      });
    });
  }

  /* -------------------------------------------------- */
  /*  3. Back to Top                                    */
  /* -------------------------------------------------- */
  function initBackToTop() {
    var btn = document.getElementById('back-to-top');
    if (!btn) return;

    window.addEventListener('scroll', function () {
      btn.classList.toggle('back-to-top--visible', window.scrollY > 400);
    }, { passive: true });
  }

  window.scrollToTop = function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* -------------------------------------------------- */
  /*  4. Sidebar Toggle (mobile)                        */
  /* -------------------------------------------------- */
  window.toggleSidebar = function () {
    var sidebar = document.getElementById('docs-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('docs-sidebar--open');
  };

  function initSidebarClose() {
    var sidebar = document.getElementById('docs-sidebar');
    if (!sidebar) return;

    /* close on outside click */
    document.addEventListener('click', function (e) {
      if (
        sidebar.classList.contains('docs-sidebar--open') &&
        !sidebar.contains(e.target) &&
        !e.target.closest('.docs-hamburger')
      ) {
        sidebar.classList.remove('docs-sidebar--open');
      }
    });

    /* close on link click (mobile) */
    sidebar.addEventListener('click', function (e) {
      if (e.target.closest('.sidebar-link')) {
        sidebar.classList.remove('docs-sidebar--open');
      }
    });
  }

  /* -------------------------------------------------- */
  /*  5. Reveal Animation (landing page)                */
  /* -------------------------------------------------- */
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );

    els.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* -------------------------------------------------- */
  /*  6. Smooth scroll for anchor links                 */
  /* -------------------------------------------------- */
  function initSmoothScroll() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;

      var id = link.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (!target) return;

      e.preventDefault();

      var offset = 80;
      var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });

      /* update URL without jump */
      history.pushState(null, '', '#' + id);
    });
  }

  /* -------------------------------------------------- */
  /*  7. Active nav link (landing page)                 */
  /* -------------------------------------------------- */
  function initActiveNav() {
    var navLinks = document.querySelectorAll('.nav-link[href^="index.html#"]');
    if (!navLinks.length) return;

    /* only run on landing page */
    if (document.body.classList.contains('docs-page')) return;

    var sectionIds = [];
    navLinks.forEach(function (l) {
      var hash = l.getAttribute('href').split('#')[1];
      if (hash) sectionIds.push({ id: hash, link: l });
    });

    if (!sectionIds.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            sectionIds.forEach(function (item) {
              item.link.classList.toggle(
                'nav-link--active',
                item.id === entry.target.id
              );
            });
          }
        });
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    sectionIds.forEach(function (item) {
      var el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });
  }

  /* -------------------------------------------------- */
  /*  8. Bullet throb on scroll (landing page)          */
  /* -------------------------------------------------- */
  function initBulletThrob() {
    var items = document.querySelectorAll('.content-list li');
    if (!items.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            /* stagger each bullet by its index within the list */
            var li = entry.target;
            var siblings = Array.from(li.parentElement.children);
            var idx = siblings.indexOf(li);
            setTimeout(function () {
              li.classList.add('in-view');
            }, idx * 120);
            observer.unobserve(li);
          }
        });
      },
      { threshold: 0.3 }
    );

    items.forEach(function (item) {
      observer.observe(item);
    });
  }

  /* -------------------------------------------------- */
  /*  Init on DOMContentLoaded                          */
  /* -------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initScrollSpy();
    initDocsSearch();
    initBackToTop();
    initSidebarClose();
    initReveal();
    initSmoothScroll();
    initActiveNav();
    initBulletThrob();
  });
})();
