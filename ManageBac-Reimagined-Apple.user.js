// ==UserScript==
// @name         ManageBac Reimagined (Apple)
// @namespace    https://github.com/Tiger0821/ManageBac-Reimagined-Apple
// @version      2026.10.01.1
// @description  ManageBac restyled after apple.com, with a three-tab switcher, a ⌘K class palette, today's timetable in a side dock with a living aquarium, and what's due today on the calendar.
// @author       Arstoien, Tiger0821
// @homepageURL  https://github.com/Tiger0821/ManageBac-Reimagined-Apple
// @updateURL    https://raw.githubusercontent.com/Tiger0821/ManageBac-Reimagined-Apple/main/ManageBac-Reimagined-Apple.user.js
// @downloadURL  https://raw.githubusercontent.com/Tiger0821/ManageBac-Reimagined-Apple/main/ManageBac-Reimagined-Apple.user.js
// @match        https://*.managebac.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=managebac.com
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
  'use strict';

  /* The Original and Apple versions build the same bar and dock, so with both
     switched on the page would get two of each. Whichever runs first claims
     the page and the other stands down. */
  if (document.documentElement.hasAttribute('data-mbr')) return;
  document.documentElement.setAttribute('data-mbr', 'ManageBac Reimagined (Apple)');

  /* ============================================================
     SETTINGS
     ============================================================ */

  const CONFIG = {
    // The three places you actually go. Order is the tab order.
    // dynamicLabel is the link's exact text in ManageBac's own sidebar —
    // that link is what actually gets clicked. href is only a fallback for
    // if the sidebar link can't be found, since hardcoded routes here can
    // 404 on an account they weren't tested against.
    tabs: [
      { id: 'tasks',   label: 'Tasks',      dynamicLabel: 'Tasks & Deadlines', href: '/student/tasks_and_deadlines', match: /tasks_and_deadlines|^\/student\/home/ },
      { id: 'classes', label: 'Classes',    panel: 'classes',                                                        match: /^\/student\/classes/ },
      { id: 'ib',      label: 'IB Manager', dynamicLabel: 'IB Manager',        href: '/student/ib/activity/cas',      match: /^\/student\/ib/ },
      // Not in the switcher: it goes nowhere, it pulls the timetable out, so
      // it stands on its own at the right end of the bar. Nothing can make it
      // the active tab by URL either — /(?!)/ never matches, which is the point.
      { id: 'today',   label: 'Today',      panel: 'timetable',                                                      match: /(?!)/ }
    ],

    // Everything else, tucked behind "More" rather than deleted.
    more: [
      { label: 'My Workspace',  dynamicLabel: 'My Workspace',      href: '/student/home' },
      { label: 'Calendar',      dynamicLabel: 'Calendar',          href: '/student/calendar' },
      { label: 'Timetables',    dynamicLabel: 'Timetables',        href: '/student/timetables' },
      { label: 'Portfolio',     dynamicLabel: 'Portfolio',         href: '/student/portfolio' },
      { label: 'Exams Planner', dynamicLabel: 'Exams Planner',     href: '/student/ib/plan' },
      { label: 'Groups',        dynamicLabel: 'Browse All Groups', href: '/student/groups/all' }
    ],

    // Fold classes from earlier school years. The current year is the
    // highest "(Grade N)" found, so this keeps working as you move up.
    foldPastYears: true,

    // "IB DP Chinese A: Language and Literature (Grade 11) -2"
    //   -> "Chinese A: Language and Literature"
    tidyNames: true,

    // Applied after tidying. Left side must match the tidied name.
    shortNames: {
      'Mathematics: Analysis and Approaches HL': 'Math AA HL',
      'Mathematics: Applications and Interpretation HL': 'Math AI HL',
      'Chinese A: Language and Literature': 'Chinese A LL',
      'Theory of Knowledge': 'TOK',
      'HS G11 Guidance': 'Guidance',
      'College Counseling': 'Counseling'
    }
  };

  /* ============================================================
     STATE
     ============================================================ */

  const store = {
    get: (k, d) => { try { return typeof GM_getValue === 'function' ? GM_getValue(k, d) : JSON.parse(localStorage.getItem('mbs-' + k) ?? 'null') ?? d; } catch (e) { return d; } },
    set: (k, v) => { try { typeof GM_setValue === 'function' ? GM_setValue(k, v) : localStorage.setItem('mbs-' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* Light-only by design. ManageBac hardcodes its own colours across
     hundreds of buttons, icons and small controls; recolouring them
     piecemeal read worse than leaving them alone, so dark mode was cut.
     color-scheme is pinned to light so that on a machine set to dark, the
     browser's own widgets (scrollbars, date pickers, native selects) match
     the page instead of rendering dark on top of it. */
  document.documentElement.style.colorScheme = 'light';

  /* ============================================================
     HELPERS
     ============================================================ */

  const gradeOf = s => { const m = (s || '').match(/\(Grade\s*(\d+)\)/i); return m ? +m[1] : null; };

  function tidy(name) {
    let s = (name || '').replace(/\s+/g, ' ').trim();
    if (!CONFIG.tidyNames) return s;
    s = s.replace(/^IB\s+(DP|MYP|PYP|CP)\s+/i, '')
         .replace(/^\[[^\]]*\]\s*/, '')
         .replace(/\s*\(Grade\s*\d+\)\s*/ig, ' ')
         .replace(/\s*-\s*\d+\s*$/, '')
         .replace(/\s+/g, ' ').trim();
    return CONFIG.shortNames[s] || s;
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* Class links are context-aware: on a plain page they're
     /student/classes/<id>, but inside a class they gain the current
     subsection, e.g. /student/classes/<id>/core_tasks — ManageBac keeps you
     in the same tab when you switch class. So the id is matched with an
     optional trailing path rather than anchored at the end, or the list
     comes back empty on exactly those pages. "/classes/my" has no digits,
     so "Browse All Classes" still correctly falls out. */
  const CLASS_HREF = /\/classes\/(\d+)(?:\/|$)/;
  const GROUP_HREF = /\/groups\/(\d+)(?:\/|$)/;

  /* Read the class list out of ManageBac's own sidebar before we hide it.

     Both lists are read in one pass and cached. renderPanel() asks for them
     again on every keystroke, and tidy() runs five regexes per class, so
     typing six characters into the palette was re-scanning the sidebar
     twelve times for an answer that hadn't changed. The cache is keyed on
     the wrapper node and the submenu-link count: ManageBac's client-side
     navigation swaps the whole menu, so a new node or a different number of
     links is the same signal a fresh scan would have picked up. */
  let navCache = { wrap: null, count: -1, classes: [], groups: [] };

  function readNav() {
    const wrap = document.querySelector('.f-menu__item.js-menu-classes-list');
    const links = document.querySelectorAll('.f-menu__submenu-link');
    if (navCache.wrap === wrap && navCache.count === links.length) return navCache;

    const classes = [], groups = [];
    if (wrap) wrap.querySelectorAll('.f-menu__submenu-link').forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(CLASS_HREF);
      if (!m) return;
      const raw = a.textContent.replace(/\s+/g, ' ').trim();
      // elRef: click ManageBac's own link rather than jumping to the URL
      classes.push({ id: m[1], href, raw, name: tidy(raw), grade: gradeOf(raw), elRef: a });
    });

    // Groups aren't classes: no "(Grade N)" or "-N" section suffix to strip,
    // so they skip tidy() rather than risk it eating a real trailing number
    // (e.g. "IB Film Club 2019-2020" is not a class section).
    links.forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(GROUP_HREF);
      if (!m) return;
      const raw = a.textContent.replace(/\s+/g, ' ').trim();
      groups.push({ id: m[1], href, raw, name: raw, grade: null, elRef: a });
    });

    navCache = { wrap, count: links.length, classes, groups };
    return navCache;
  }

  const readClasses = () => readNav().classes;
  const readGroups  = () => readNav().groups;

  /* Find one of ManageBac's own nav links (top level OR submenu) by its
     visible label, e.g. "Tasks & Deadlines" or "IB Manager".

     Every destination in this script routes through the real link rather
     than a URL of our own: some of ManageBac's routes resolve through its
     own client-side click handling, or off in-app state, so jumping
     straight to an href with location.href can land on a 404 even when
     the same link works when actually clicked. The sidebar is only hidden
     with CSS, never removed, so its links stay in the DOM and a
     programmatic click on them behaves exactly like a real one. */
  function findNavLink(label) {
    // submenu links carry .f-menu__link too, so this covers both levels
    const links = document.querySelectorAll('#menu a.f-menu__link[href]');
    for (const a of links) {
      const titleEl = a.querySelector('.f-menu__link-title, .f-menu__submenu-link-title');
      const text = (titleEl ? titleEl.textContent : a.textContent).replace(/\s+/g, ' ').trim();
      if (text === label && a.getAttribute('href') !== 'javascript:void(0)') return a;
    }
    return null;
  }

  /* Navigate the way ManageBac itself would: click its own link when we can
     find it, and only fall back to a plain URL jump when we can't. */
  function goTo(item) {
    const real = (item.elRef && item.elRef.isConnected)
      ? item.elRef
      : findNavLink(item.dynamicLabel || item.label);
    if (real) { real.click(); return true; }
    if (item.href) { location.href = item.href; return true; }
    return false;
  }

  /* ============================================================
     STYLESHEET
     ============================================================ */

  const CSS = `
/* Apple.com's design language: the #F5F5F7 page grey with white cards on it,
   #1D1D1F ink, a single blue (#0071E3) for anything you can press or have
   selected, pill-shaped controls, and a frosted top bar. SF Pro is the system
   face on Apple devices, so nothing is downloaded; PingFang TC carries the
   Chinese. --mono is kept as a name for the small caption text, but it is
   SF Pro too — times line up through tabular figures instead. */
:root {
  --p:#F5F5F7; --s:#FFFFFF; --s2:#F5F5F7;
  --ink:#1D1D1F; --ink2:#6E6E73; --ink3:#86868B;
  --line:#E8E8ED; --line2:#D2D2D7;
  --a:#0071E3; --a2:#0077ED; --aw:rgba(0,113,227,.12); --link:#0066CC;
  --sh:0 4px 16px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04);
  --mark:rgba(0,113,227,.13); --mark2:#0071E3;
  --pill:980px; --r-card:18px; --r-ctl:12px;
  --dock:320px;
  --sans:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Helvetica Neue','PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif;
  --mono:var(--sans);
}

/* ---------- ground ---------- */
html, body { background:var(--p) !important; color:var(--ink) !important;
  -webkit-font-smoothing:antialiased; letter-spacing:-.01em; }
[class^="mbs-"], [class*=" mbs-"] { font-variant-numeric:tabular-nums; }
body, .card, .modal-content, .dropdown-menu, .f-tile, input, select, textarea,
button, .btn, h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, div {
  font-family: var(--sans) !important;
}
.bg-gray-100, .f-layout-main__content.bg-gray-100 { background:var(--p) !important; }
.bg-white { background:var(--s) !important; }
.color-gray-600, .color-secondary, .gray-text { color:var(--ink3) !important; }
::selection { background:var(--aw); color:var(--ink); }
:focus-visible { outline:2px solid var(--a) !important; outline-offset:2px !important; border-radius:8px; }
/* fields show focus with their own border + ring, so the global outline
   would draw a second one around them */
.form-control:focus, .form-control:focus-visible,
input:focus-visible, textarea:focus-visible, select:focus-visible { outline:none !important; }
hr { border-color:var(--line) !important; }

h1 { font-size:34px !important; font-weight:600 !important; letter-spacing:-.015em !important; line-height:1.12 !important; color:var(--ink) !important; }
h2, .h5, .f-tile__title { font-size:17px !important; font-weight:600 !important; letter-spacing:-.022em !important; color:var(--ink) !important; }
h3, .h6 { font-size:15px !important; font-weight:600 !important; letter-spacing:-.016em !important; color:var(--ink) !important; }
/* Links take Apple's link blue and underline on hover.

   .btn is excluded from the hover COLOUR, not just the underline: a:hover
   is specificity (0,1,1) and outranks .btn-primary at (0,1,0), so without
   this the label on a dark button turned black on black and vanished.

   Tabs and menu items are excluded from the underline because they already
   carry their own 2px indicator — a text-decoration line on top of that
   reads as a double rule. */
a { color:var(--link) !important; text-decoration:none; }
a:not(.btn):not(.nav-link):not(.dropdown-item):hover { color:var(--link) !important; }
a:not(.btn):not(.nav-link):not(.dropdown-item):not(.f-menu__link):not(.mbs-opt):not(.mbs-tab):not(.navbar-brand):hover {
  text-decoration:underline;
}
a.link-dark, .f-tile__title-link { color:var(--ink) !important; font-weight:600 !important; }
a.link-dark:hover, .f-tile__title-link:hover { color:var(--link) !important; }
.f-numeric, .badge-label, time, code, kbd { font-family:var(--mono) !important; font-variant-numeric:tabular-nums; }

/* ---------- the rail goes away, content takes the width ----------
   The rail's offset moves between two properties depending on its state:
   margin-left (250px) when expanded, padding-left (64px) when narrow.
   Both are normalised here, with padding kept at the 16px gutter the
   expanded layout already uses, so content lands in the same place
   regardless of which state ManageBac last remembered. */
#menu.f-menu, #menu-trigger { display:none !important; }
.f-layout-main__wrapper { margin-left:0 !important; padding-left:16px !important; }
.f-layout-main, .f-layout-main__body, .f-layout-main__content, main#main-content {
  margin-left:0 !important; left:0 !important;
}

/* ---------- top bar ---------- */
/* Apple's global nav: translucent white with the page blurred through it. */
nav.navbar, nav.navbar.bg-white {
  background:rgba(251,251,253,.8) !important;
  -webkit-backdrop-filter:saturate(180%) blur(20px); backdrop-filter:saturate(180%) blur(20px);
  border-bottom:1px solid rgba(0,0,0,.08) !important;
  box-shadow:none !important;
}
.navbar .form-control { background:rgba(118,118,128,.12) !important; border:1px solid transparent !important; border-radius:var(--pill) !important; color:var(--ink) !important; font-size:14px !important; }
/* the hamburger used to hold this space; without it the logo hits the edge */
.navbar-row { padding-left:14px !important; }
/* Help menu: never used, and it crowds the right side of the bar */
.f-help-support { display:none !important; }

/* ---------- right-hand column ----------
   The Guides panel is filler. Its tab and body are always hidden; the whole
   column is only removed when Guides was the only thing in it, which
   tidyRightSidebar() decides — class pages keep it for Details and Members. */
.js-sidebar_guides,
.f-sidebar-tabs__toggle[data-bs-target=".js-sidebar_guides"] { display:none !important; }
.f-layout-main__sidebar.mbs-aside-empty { display:none !important; }
/* buttons the script takes away by their label (see hideButtons) */
.mbs-gone { display:none !important; }

/* ---------- due today, in the calendar's header card ----------
   The card held only its title; what's due today now sits beside it, and
   drops underneath when the window is too narrow for both. */
.f-hero__content.mbs-has-due { display:flex; align-items:center; flex-wrap:wrap; gap:14px 32px; }
/* the title never gives up its width: when there isn't room for both, the
   cards move underneath instead of squeezing it to "Calend…" */
.f-hero__content.mbs-has-due > .f-title { flex:0 0 auto; max-width:100%; }
/* ManageBac's two-line clamp mis-measures a one-word title, so beside the
   cards it's set as plain single-line text */
.f-hero__content.mbs-has-due .f-hero__title { display:block !important; -webkit-line-clamp:unset !important;
  white-space:nowrap; overflow:visible !important; text-overflow:clip !important; }
.mbs-due { flex:1 1 380px; min-width:0; display:flex; flex-direction:column; gap:8px; padding:4px 0; }
.mbs-due__head { display:flex; align-items:center; gap:8px; }
.mbs-due__head .k { font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--ink2); }
.mbs-due__head .n { font-size:11px; font-weight:700; line-height:1.5; color:#fff; background:var(--a);
  border-radius:980px; padding:0 7px; font-variant-numeric:tabular-nums; }
.mbs-due__row { display:flex; gap:10px; overflow-x:auto; scrollbar-width:none; padding:1px; }
.mbs-due__row::-webkit-scrollbar { display:none; }
a.mbs-due__item { flex:0 0 auto; width:230px; box-sizing:border-box; display:flex; flex-direction:column; gap:2px;
  padding:10px 14px 11px 17px; border-radius:14px; background:var(--s2);
  box-shadow:inset 4px 0 0 var(--due, var(--a)); text-decoration:none !important;
  transition:background .2s ease, opacity .3s ease; }
a.mbs-due__item:hover { background:var(--line); }
.mbs-due__item .t { font-size:11px; font-weight:600; color:var(--ink2); font-variant-numeric:tabular-nums; }
.mbs-due__item .n { font-size:14px; font-weight:600; letter-spacing:-.01em; color:var(--ink);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mbs-due__item .c { font-size:12px; color:var(--ink2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
a.mbs-due__item.is-past { opacity:.5; }
.mbs-due__item.is-past .t::after { content:' · passed'; }
.mbs-due__empty { display:flex; flex-direction:column; gap:3px; }
.mbs-due__empty b { font-size:15px; font-weight:600; color:var(--ink); }
.mbs-due__empty a { font-size:13px; }
.mbs-due--loading .mbs-due__row::after { content:'Loading…'; font-size:13px; color:var(--ink3); }
/* Chat Bot launcher on the same right-edge strip */
.js-zendesk-launcher { display:none !important; }

/* the unread counter — the bell itself stays, so notifications are still
   reachable; it's the permanent red number that nags */
.f-badge-indicator.count { display:none !important; }

/* Hover tooltips on the icon buttons — notifications, quick add, the panel
   toggles. They label icons you already know, and pop up whenever the
   cursor crosses the top bar. Removing them is safe: each button keeps its
   accessible name in an aria-label or a .visually-hidden span, so screen
   readers still announce it, and the spans are absolutely positioned so
   nothing reflows. */
.btn-tooltip, .tooltip.show { display:none !important; }

/* ---------- the switcher ---------- */
.mbs-switch {
  display:flex; align-items:center; gap:2px;
  padding:3px; margin-left:4px;
  background:rgba(118,118,128,.12); border:0; border-radius:var(--pill);
}
.mbs-tab {
  appearance:none; border:0; background:transparent; cursor:pointer;
  color:var(--ink); font:400 14px/1 var(--sans); letter-spacing:-.016em;
  padding:8px 15px; border-radius:var(--pill); white-space:nowrap;
  display:flex; align-items:center; gap:7px;
  transition:background .2s ease, color .2s ease, box-shadow .2s ease;
}
.mbs-tab:hover { background:rgba(255,255,255,.6); }
/* The selected tab is the white thumb of an Apple segmented control. */
.mbs-tab.is-active {
  background:var(--s); color:var(--ink); font-weight:600;
  box-shadow:0 3px 8px rgba(0,0,0,.12), 0 3px 1px rgba(0,0,0,.04);
}
.mbs-tab__count {
  font-family:var(--mono); font-size:10px; font-weight:600;
  color:var(--ink2); background:rgba(118,118,128,.14);
  border-radius:var(--pill); padding:2px 6px;
}
.mbs-tab.is-active .mbs-tab__count { color:var(--a); background:var(--aw); }
.mbs-kbd {
  font-family:var(--mono); font-size:11px; color:var(--ink3);
  border:1px solid var(--line2); border-radius:6px; padding:1px 5px; opacity:.8;
}

/* Today isn't one of the three places: it opens no page, it pulls a rail out
   of the side of the window. Standing it apart from the segmented group, over
   with the bell and the avatar, says that before it is pressed. */
.mbs-today {
  appearance:none; cursor:pointer;
  display:flex; align-items:center; gap:7px;
  padding:8px 16px; border-radius:var(--pill);
  background:var(--aw); border:0;
  color:var(--a); font:500 14px/1 var(--sans); letter-spacing:-.016em; white-space:nowrap;
  transition:background .2s ease, color .2s ease;
}
/* only when it lands at the end of the bar with nothing to sit against */
.mbs-today--far { margin-left:auto; }
.mbs-today--study { margin-right:8px; align-self:center; }
.stream-presentation { display:flex !important; flex-direction:row !important; align-items:center; }
.mbs-today:hover { background:rgba(0,113,227,.18); }
/* Pressed, this one is holding a whole rail open — the quiet pill the tabs use
   for "you are here" reads as too small a claim for that. */
.mbs-today.is-active { background:var(--a); color:#fff; }
.mbs-today.is-active:hover { background:var(--a2); }
.mbs-today:focus-visible { border-radius:var(--pill) !important; }

/* ---------- panels ---------- */
.mbs-panel {
  position:fixed; z-index:2000;
  width:330px; max-height:min(72vh, 540px);
  display:flex; flex-direction:column; overflow:hidden;
  background:rgba(255,255,255,.88);
  -webkit-backdrop-filter:saturate(180%) blur(20px); backdrop-filter:saturate(180%) blur(20px);
  border:1px solid rgba(0,0,0,.06);
  border-radius:var(--r-card); box-shadow:0 12px 40px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.05);
}
.mbs-panel[hidden] { display:none !important; }
.mbs-panel__search { flex:none; padding:10px; border-bottom:1px solid var(--line); }
.mbs-panel__search input {
  width:100%; box-sizing:border-box; outline:none;
  background:rgba(118,118,128,.12); color:var(--ink);
  border:1px solid transparent; border-radius:var(--r-ctl);
  padding:9px 12px; font:400 14px var(--sans);
}
.mbs-panel__search input::placeholder { color:var(--ink3); }
.mbs-panel__search input:focus { border-color:var(--a); background:var(--s); box-shadow:0 0 0 3px var(--aw); }
/* A long class list is cut dead flat by the panel's bottom edge, which
   reads as the end of the list rather than the edge of the window onto it.
   The mask rides the scroll box, so the fade stays at the bottom while rows
   move under it, and the matching bottom padding means the last row can
   still scroll clear of the fade and land fully opaque. */
.mbs-list {
  flex:1 1 auto; min-height:0; overflow-y:auto; padding:6px 6px 16px;
  -webkit-mask-image:linear-gradient(#000 calc(100% - 16px), transparent);
  mask-image:linear-gradient(#000 calc(100% - 16px), transparent);
}
.mbs-opt {
  display:flex; align-items:center; gap:9px;
  padding:8px 10px; border-radius:10px;
  color:var(--ink) !important; font-size:14px; text-decoration:none; cursor:pointer;
}
.mbs-opt:hover { background:rgba(0,0,0,.04); }
.mbs-opt.is-cursor { background:var(--a); color:#fff !important; }
.mbs-opt.is-cursor .mbs-opt__tag { color:rgba(255,255,255,.75); }
.mbs-opt.is-cursor .mbs-opt__dot { background:#fff; }
.mbs-opt.is-current { color:var(--a) !important; font-weight:600; }
.mbs-opt__dot { width:7px; height:7px; border-radius:50%; background:var(--a); flex:none; opacity:.75; }
.mbs-opt.is-past .mbs-opt__dot { background:var(--line2); }
/* Where you are now. The bold label alone is easy to miss mid-list; a halo
   on the dot is the one thing on the row that isn't also doing another job. */
.mbs-opt.is-current .mbs-opt__dot { opacity:1; box-shadow:0 0 0 3px var(--aw); }
/* rows and tabs round at 7px, so the global focus ring's 6px sat just
   inside their corners */
.mbs-opt:focus-visible { border-radius:10px !important; }
.mbs-tab:focus-visible { border-radius:var(--pill) !important; }
.mbs-opt__name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mbs-opt__tag { margin-left:auto; font-family:var(--mono); font-size:11px; color:var(--ink3); flex:none; }
.mbs-group {
  padding:10px 10px 4px; font-family:var(--mono);
  font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink3);
}
.mbs-fold {
  display:flex; align-items:center; width:calc(100% - 12px); margin:4px 6px 2px;
  background:transparent; border:0; border-top:1px solid var(--line);
  padding:8px 4px 4px; cursor:pointer; text-align:left;
  font-size:11px; font-weight:600; letter-spacing:.02em; text-transform:uppercase; color:var(--ink3);
}
.mbs-fold:hover { color:var(--ink2); }
.mbs-fold::after { content:'▸'; margin-left:auto; transition:transform .15s ease; }
.mbs-fold[aria-expanded="true"]::after { transform:rotate(90deg); }
@keyframes mbs-row-in { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:none; } }
.mbs-opt--enter { animation:mbs-row-in 140ms cubic-bezier(.4,0,.2,1) both; }
.mbs-empty { padding:14px 10px; font-size:12.5px; color:var(--ink3); text-align:center; }

/* The palette is driven from the keyboard but never said so. The legend
   uses the same mono-caps as the group headers, so it reads as part of the
   panel's chrome rather than as a tooltip bolted underneath it. */
.mbs-panel__hint {
  flex:none; display:flex; gap:13px; align-items:center;
  padding:8px 11px; border-top:1px solid var(--line); background:var(--s);
  font-size:11px; letter-spacing:.02em;
  text-transform:uppercase; color:var(--ink3);
}
.mbs-panel__hint > span { display:flex; gap:5px; align-items:center; }
.mbs-panel__hint b {
  font-weight:500; color:var(--ink2);
  border:1px solid var(--line2); border-radius:3px; padding:0 3px;
}

/* ---------- cards, tiles, buttons ---------- */
.card, .f-tile, .f-tile--elevated, .f-box-item {
  background:var(--s) !important; border:1px solid rgba(0,0,0,.04) !important;
  border-radius:var(--r-card) !important; box-shadow:none !important;
  transition:box-shadow .3s ease !important;
}
.f-tile--elevated:hover, .f-box-item:hover { box-shadow:var(--sh) !important; }
.card-tinted { background:var(--s2) !important; }
/* the clipart illustrations, and the tile slot they sat in */
.sebo-icon, .f-tile__icon { display:none !important; }
.btn { border-radius:var(--pill) !important; font-size:14px !important; font-weight:400 !important; letter-spacing:-.016em; box-shadow:none !important; }
.btn-primary { background:var(--a) !important; border-color:var(--a) !important; color:#fff !important; }
.btn-primary:hover { background:var(--a2) !important; border-color:var(--a2) !important; }
.btn-secondary, .btn-light { background:#E8E8ED !important; border:1px solid #E8E8ED !important; color:var(--ink) !important; }
.btn-secondary:hover, .btn-light:hover { background:#DCDCE1 !important; border-color:#DCDCE1 !important; color:var(--ink) !important; }
.btn-blank, .btn-icon { background:transparent !important; border:0 !important; color:var(--ink2) !important; }
.dropdown-toggle { font-size:13px !important; }
.badge, .badge-label, .label { font-size:11px !important; font-weight:600 !important; border-radius:var(--pill) !important; padding:2px 8px !important; }
.color-box-gray { background:var(--s2) !important; color:var(--ink3) !important; }
.form-control, .filter-input { background:var(--s) !important; border:1px solid var(--line2) !important; border-radius:var(--r-ctl) !important; color:var(--ink) !important; font-size:14px !important; box-shadow:none !important; }
.form-control:focus { border-color:var(--a) !important; box-shadow:0 0 0 4px var(--aw) !important; }
.dropdown-menu { background:rgba(255,255,255,.9) !important; -webkit-backdrop-filter:saturate(180%) blur(20px); backdrop-filter:saturate(180%) blur(20px);
  border:1px solid rgba(0,0,0,.06) !important; border-radius:var(--r-ctl) !important; box-shadow:0 12px 40px rgba(0,0,0,.14) !important; padding:5px !important; }
.dropdown-item { color:var(--ink) !important; font-size:14px !important; border-radius:8px !important; }
.dropdown-item:hover { background:var(--a) !important; color:#fff !important; }
.modal-content { background:var(--s) !important; border:0 !important; border-radius:var(--r-card) !important; box-shadow:0 24px 60px rgba(0,0,0,.18) !important; overflow:hidden; }
.modal-header { background:var(--s) !important; border-bottom:1px solid var(--line) !important; }
.modal-header .modal-title, .modal-header h1, .modal-header h2, .modal-header h4 { color:var(--ink) !important; font-size:19px !important; font-weight:600 !important; letter-spacing:-.02em !important; }
table, .table { color:var(--ink2) !important; font-size:14px !important; }
.table > :not(caption) > * > * { background:transparent !important; border-color:var(--line) !important; }
.accordion-item, .accordion-button, .accordion-body { background:var(--s) !important; color:var(--ink) !important; border-color:var(--line) !important; }
.accordion-button { font-size:14px !important; box-shadow:none !important; }

/* ---------- surfaces ManageBac paints white ----------
   These aren't .card/.bg-white, so the card rules above miss them. In dark
   mode that left light text stranded on white panels; found by auditing
   contrast on a class page rather than by guessing at class names. */
.f-surface, .f-hero, .f-sidebar, .f-sidebar-wrapper,
.homeroom-attendance-component, .f-sidebar-tabs__toggle {
  background: var(--s) !important;
}
/* .f-task-tile needs the extra class to outrank ManageBac's own !important */
.f-task-tile, .f-tile.f-task-tile { background: var(--s) !important; }
/* select2 widgets ship their own white chrome */
.select2-selection, .select2-selection--single, .select2-dropdown, .select2-results__option {
  background: var(--s) !important; color: var(--ink) !important; border-color: var(--line) !important;
}

/* ---------- segmented button groups ----------
   These arrive as a Bootstrap .btn-group, meant to render as one joined
   control. The blanket pill radius on .btn above was splitting them into
   separate pills, so the grouping is restored here: square middles,
   pill ends, and borders collapsed onto each other. */
.btn-group { gap:0 !important; }
.btn-group > .btn { border-radius:0 !important; margin-left:-1px !important; position:relative; }
.btn-group > .btn:first-child { border-radius:var(--pill) 0 0 var(--pill) !important; margin-left:0 !important; }
.btn-group > .btn:last-child { border-radius:0 var(--pill) var(--pill) 0 !important; }
.btn-group > .btn:only-child { border-radius:var(--pill) !important; }
.btn-group > .btn:hover { z-index:1; }
/* The doubled .active is deliberate. ManageBac's competing rule lives in a
   stylesheet this page cannot read (CORS), so rather than guess its weight
   the selector is simply made heavier than any single-class form. */
.btn-group > a.btn.active.active,
.btn-group > button.btn.active.active {
  background:var(--a) !important; border-color:var(--a) !important;
  color:#fff !important; z-index:2;
}
.btn-group > .btn.active .f-badge-indicator { color:#fff !important; }

/* the list dips while a view is fetched, instead of the page flashing */
.js-tasks { transition:opacity 120ms ease; }
.js-tasks.mbs-swapping { opacity:.4; }

/* ---------- inline task details ---------- */
/* The panel is the same white as the row above it, so an expanded task
   reads as one continuous card against the page — separation comes from
   the card's edge rather than an internal tint, which at this lightness
   just muddied it. Labels sit at secondary ink, not tertiary: on a tinted
   panel the old grey measured 2.98 against its background. */
.mbs-task-detail {
  box-sizing:border-box;
  background:var(--s); border:1px solid var(--line); border-top:0;
  border-radius:0 0 var(--r-card) var(--r-card); margin:-1px 0 6px; padding:16px 20px;
  font-size:14px; line-height:1.55; color:var(--ink);
}
.mbs-task-detail[hidden] { display:none !important; }
.f-task-tile.mbs-tile-open { border-radius:var(--r-card) var(--r-card) 0 0 !important; border-bottom-color:transparent !important; }
.mbs-task-detail__status { font-family:var(--mono); font-size:11px; color:var(--ink2); }
.mbs-task-detail h1, .mbs-task-detail h2, .mbs-task-detail h3,
.mbs-task-detail h4, .mbs-task-detail h5, .mbs-task-detail .h4, .mbs-task-detail .h5 {
  font-size:11px !important; font-family:var(--mono) !important; font-weight:500 !important;
  letter-spacing:.08em !important; text-transform:uppercase !important; color:var(--ink2) !important;
  margin:0 0 6px !important;
}
.mbs-task-detail p, .mbs-task-detail span, .mbs-task-detail li { color:var(--ink); }
/* attachments need their own fill now that the panel is white */
.mbs-task-detail a.fr-file, .mbs-task-detail [class*="attachment"] {
  background:var(--s2) !important; border:1px solid var(--line) !important; border-radius:var(--r-ctl) !important;
}
.mbs-task-detail a { text-decoration:underline; }
.mbs-task-detail img { max-width:100%; height:auto; }
.mbs-task-detail__foot { margin-top:12px; padding-top:10px; border-top:1px solid var(--line); }
.mbs-task-open {
  font-family:var(--mono); font-size:10px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--ink2) !important; text-decoration:none !important;
}
.mbs-task-open:hover { color:var(--link) !important; text-decoration:underline !important; }

* { scrollbar-width:thin; scrollbar-color:var(--line2) transparent; }
::-webkit-scrollbar { width:10px; height:10px; }
::-webkit-scrollbar-thumb { background:var(--line2); border-radius:8px; border:3px solid transparent; background-clip:content-box; }
::-webkit-scrollbar-track { background:transparent; }

/* ---------- timetable dock ----------
   The block you are in now is filled in Apple blue, and the fill grows
   across it as the period runs down, like a progress bar.

   It stands where ManageBac's own rail used to, and buys that width the way
   the rail did: by pushing the wrapper's left edge across, which is the one
   layout contract this page is already known to honour. Under 900px there is
   no width to give, so it stops pushing and floats over the page instead.
   It sits just above ManageBac's own fixed bars (Bootstrap's 1030) and below
   its modals, popovers and tooltips (1050 and up), so a calendar event or
   task popup opens over the dock rather than under it. */
.mbs-dock {
  position:fixed; left:0; top:var(--dock-top, 56px); bottom:0; width:var(--dock);
  z-index:1035; display:flex; flex-direction:column; overflow:hidden;
  background:var(--s); border-right:1px solid var(--line);
}
.mbs-dock[hidden] { display:none !important; }
html.mbs-dock-anim .f-layout-main__wrapper, html.mbs-dock-anim body {
  transition:padding-left 420ms cubic-bezier(.32,.72,0,1) !important; }
html.mbs-dock-anim .mbs-dock { will-change:transform; }
html.mbs-docked .f-layout-main__wrapper { padding-left:calc(var(--dock) + 16px) !important; }
/* Pages that don't carry the wrapper — nothing seen so far, but the rail's
   offset has to land somewhere or the dock covers the content. */
html.mbs-docked.mbs-dock-loose body { padding-left:var(--dock) !important; }
/* The dock opens with the day's aquarium: the date, the time, and water that
   fills as the day goes. On most pages it's simply the top of the dock. On
   those pages (Study Mode) the page's own bar is pushed across too, which
   would leave an empty corner above the dock, so there the dock grows up
   into it and the aquarium's bottom edge sits level with the bar's. */
@media (min-width:901px) { html.mbs-dock-loose .mbs-dock { top:0; } }
.mbs-tt__clock { flex:none; position:relative; height:64px; box-sizing:border-box; overflow:hidden;
  border-bottom:1px solid var(--line); background:var(--s); }
/* level with the page's own bar; a page with no bar at all still gets a full-height box */
@media (min-width:901px) { html.mbs-dock-loose .mbs-tt__clock { height:max(56px, var(--dock-top, 64px)); } }

/* The water is drawn by the script onto a canvas (see aqDraw); the fish and
   bubbles swim in the box above it, and the words are drawn onto a second
   canvas on top — dark above the surface, white beneath it — so the water
   line runs through the letters. The words also exist as ordinary text,
   invisible, which is what screen readers get and what the drawing measures
   its layout from, so the type is still set by the stylesheet. */
.mbs-aq, .mbs-aq-ink { position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none; }
.mbs-aq-ink { z-index:2; }
.mbs-aq__ink { position:absolute; inset:0; z-index:2; opacity:0; pointer-events:none; box-sizing:border-box; padding:0 16px;
  display:grid; grid-template-columns:1fr auto; align-content:center; column-gap:12px;
  font-variant-numeric:tabular-nums; }
.mbs-aq__ink .dt, .mbs-aq__ink .tm { grid-column:1; white-space:nowrap; }
.mbs-aq__ink .pc { grid-column:2; grid-row:1 / span 2; align-self:center; text-align:right; }
.mbs-aq__ink .pc b, .mbs-aq__ink .pc i { display:block; font-style:normal; }
:root {
  --aq-back:rgba(100,210,255,.38); --aq-mid:rgba(10,132,255,.5);
  --aq-top:rgba(0,113,227,.9); --aq-bottom:rgba(0,62,158,.97); --aq-hi:rgba(255,255,255,.65);
  --diver:#1D1D1F #48484A #FFD60A #E0B400 #FF9F0A #D97800 #F5C6A5 #9EE7FF #8E8E93 #FF453A #FFFFFF #C7C7CC;
  --aq-sand:#E6D2A3; --aq-sand2:#CDB27C;
}
/* Widget type: a light display clock, the date as a tracked-out capital
   eyebrow, and the day's share as a figure with its own small caption. */
.mbs-aq__ink .dt { font:600 9.5px/1.3 var(--sans); letter-spacing:.14em; text-transform:uppercase; color:var(--ink2); }
.mbs-aq__ink .tm { font:300 30px/1 var(--sans); letter-spacing:-.025em; color:var(--ink); margin-top:3px; }
.mbs-aq__ink .pc b { font:500 18px/1 var(--sans); letter-spacing:-.02em; color:var(--ink); }
.mbs-aq__ink .pc i { font:600 8px/1.4 var(--sans); letter-spacing:.14em; text-transform:uppercase; color:var(--ink2); margin-top:3px; }
@media (max-width:900px) {
  html.mbs-docked .f-layout-main__wrapper { padding-left:16px !important; }
  html.mbs-docked.mbs-dock-loose body { padding-left:0 !important; }
  .mbs-dock { box-shadow:var(--sh); }
}

.mbs-tt__head { flex:none; display:flex; align-items:baseline; gap:8px; padding:14px 16px 11px; border-bottom:1px solid var(--line); }
.mbs-tt__head h2 { margin:0; font-size:19px !important; font-weight:600 !important; letter-spacing:-.02em !important; color:var(--ink); }
.mbs-tt__head .src { font-family:var(--mono); font-size:11px; color:var(--ink3); }
.mbs-tt__head .sp { flex:1 1 auto; }
.mbs-tt__head .tdy { font-family:var(--mono); font-size:11px; color:var(--ink2); }
.mbs-tt__x {
  flex:none; align-self:center; appearance:none; border:0; background:transparent;
  cursor:pointer; width:24px; height:24px; border-radius:50%; line-height:24px; font-size:15px;
  color:var(--ink2); background:rgba(118,118,128,.12); transition:background .2s ease;
}
.mbs-tt__x:hover { background:rgba(118,118,128,.22); color:var(--ink); }

/* Ten days in one strip left each cell 28px wide, which is narrower than the
   day name it has to hold. A row per week gives them 60px, enough to sit the
   name beside the column it is in on the published timetable — which is only
   Week 1, where that grid numbers its columns 1..5. Week 2 names them Mon..Fri
   and the reference would just say the day twice. */
.mbs-tt__ruler { flex:none; border-bottom:1px solid var(--line); padding:6px 8px; display:flex; flex-direction:column; gap:3px; }
.mbs-tt__wkrow { display:flex; gap:3px; }
/* Eastern Arabic digits come from whichever fallback face has them rather than
   from Plex Mono, and they sit smaller and lighter than Latin ones at a size */
.mbs-tt__wk { flex:none; width:18px; display:flex; align-items:center; justify-content:center;
  font-size:12px; color:var(--ink3); }
.mbs-tt__day { flex:1 0 0; min-width:0; appearance:none; border:0; border-radius:var(--pill);
  background:transparent; cursor:pointer; padding:6px 2px; position:relative; z-index:0;
  display:flex; align-items:baseline; justify-content:center; gap:4px;
  font-size:11px; color:var(--ink3); transition:background .2s ease; }
.mbs-tt__day b { font-size:13px; font-weight:500; color:var(--ink); }
.mbs-tt__day:hover { background:rgba(0,0,0,.04); }
.mbs-tt__day[aria-current="true"] { background:var(--ink); }
.mbs-tt__day[aria-current="true"] b { color:#fff; font-weight:600; }
.mbs-tt__day.is-today b { color:var(--a); font-weight:600; }
.mbs-tt__day.is-today[aria-current="true"] { background:var(--a); }
.mbs-tt__day.is-today[aria-current="true"] b { color:#fff; }
.mbs-tt__day .mbs-tt__mark { display:none; }

/* Now is a card of its own, the one thing in the dock you read at a glance. */
.mbs-tt__now { flex:none; margin:10px 10px 6px; padding:14px 16px; border-radius:var(--r-card); background:var(--s2); }
.mbs-tt__now .k { font-size:12px; font-weight:600; color:var(--a); }
.mbs-tt__now .v { font-size:24px; font-weight:600; letter-spacing:-.022em; line-height:1.15; margin-top:2px; }
.mbs-tt__now .m { font-size:13px; color:var(--ink2); margin-top:5px;
  display:flex; flex-wrap:wrap; gap:1px 12px; font-variant-numeric:tabular-nums; }
.mbs-tt__nx { margin-top:12px; padding-top:10px; border-top:1px solid var(--line2);
  display:flex; align-items:baseline; gap:7px; font-size:12px; color:var(--ink2); }
.mbs-tt__nx .n { font-size:14px; font-weight:600; color:var(--ink); }
.mbs-tt__nx .t { margin-left:auto; font-size:12px; color:var(--ink2); }

.mbs-tt__list { flex:1 1 auto; min-height:0; overflow-y:auto; }
.mbs-tt__row { display:grid; grid-template-columns:58px 1fr; align-items:start;
  padding:10px 16px; border-bottom:1px solid var(--line); position:relative; }
.mbs-tt__row:last-child { border-bottom:0; }
.mbs-tt__row .t { font-size:13px; font-weight:500; color:var(--ink); padding-top:1px; font-variant-numeric:tabular-nums; }
.mbs-tt__row .t i { display:block; font-style:normal; font-size:11px; font-weight:400; color:var(--ink3); margin-top:1px; }
.mbs-tt__row .s { min-width:0; }
.mbs-tt__row .s > span { display:block; }
.mbs-tt__row .s .n { font-size:15px; font-weight:600; letter-spacing:-.02em; line-height:1.25; }
.mbs-tt__row .s .r { font-size:12px; color:var(--ink2); margin-top:2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mbs-tt__row.is-alt .s .n { font-size:13px; font-weight:500; color:var(--ink2); }
.mbs-tt__row.is-alt .t { color:var(--ink3); font-size:12px; }
.mbs-tt__row.is-done { color:var(--ink3); }
.mbs-tt__row.is-done .s .n { font-weight:500; color:var(--ink3); }
.mbs-tt__row.is-done .t, .mbs-tt__row.is-done .s .r { color:var(--line2); }

.mbs-tt__gap { display:grid; grid-template-columns:58px 1fr; padding:6px 16px;
  border-bottom:1px solid var(--line); position:relative;
  font-size:12px; color:var(--ink3); }
.mbs-tt__gap.is-lunch { background:var(--s2); }
.mbs-tt__gap .t { font-variant-numeric:tabular-nums; }

.mbs-tt__row.is-now, .mbs-tt__gap.is-now { padding-top:13px; padding-bottom:13px; }
.mbs-tt__row.is-now .s .n { font-size:17px; font-weight:600; }
.mbs-tt__gap.is-now { color:var(--ink2); }
/* :not() keeps the countdown out — it is a span as well, and this rule would
   otherwise outrank its own absolute positioning and drop it into the grid */
.mbs-tt__row.is-now > span:not(.mbs-tt__left),
.mbs-tt__gap.is-now > span:not(.mbs-tt__left) { position:relative; z-index:1; }
.mbs-tt__swipe { position:absolute; left:6px; top:4px; bottom:4px; background:var(--mark);
  pointer-events:none; z-index:0;
  border-radius:12px; transition:width 700ms cubic-bezier(.4,0,.2,1); }
.mbs-tt__swipe i { display:none; }
.mbs-tt__left { position:absolute; right:16px; top:13px; z-index:1;
  font-size:12px; font-weight:600; color:var(--a); font-variant-numeric:tabular-nums; }
.mbs-tt__none { padding:24px 16px; text-align:center; font-size:14px; color:var(--ink3); }

/* Everything above is a copy of a timetable published elsewhere, and a copy
   should say where it came from — both to be checked against when a room
   moves, and because the source is where the ten days actually live. */
.mbs-tt__foot {
  flex:none; display:flex; align-items:center; gap:8px;
  padding:10px 16px; border-top:1px solid var(--line); background:var(--s);
  font-size:12px; color:var(--ink3);
}
.mbs-tt__foot a { margin-left:auto; color:var(--link) !important; }

@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration:.01ms !important; transition-duration:.01ms !important; } }
`;

  function injectCSS() {
    if (document.getElementById('mbs-css')) return;
    const st = el('style'); st.id = 'mbs-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ============================================================
     SWITCHER + PALETTE
     ============================================================ */

  let panel, panelSearch, panelList, panelKind = null, panelAnchor = null;
  let panelGlobalsBound = false;
  let foldJustToggled = false;

  function classGroups() {
    const list = readClasses();
    const grades = list.map(c => c.grade).filter(g => g != null);
    const current = grades.length ? Math.max(...grades) : null;
    const now = [], past = [];
    list.forEach(c => {
      const isPast = CONFIG.foldPastYears && current != null && c.grade != null && c.grade < current;
      (isPast ? past : now).push(c);
    });
    return { now, past, current };
  }

  function optionRow(item, opts = {}) {
    const a = el('a', 'mbs-opt' + (opts.past ? ' is-past' : ''));
    a.href = item.href || '#';
    a.title = item.raw || item.label || '';
    // match on id where we have one: the current URL carries a subsection
    // (…/core_tasks) that the sidebar href may not, so paths rarely match whole
    const here = item.id
      ? new RegExp('/(?:classes|groups)/' + item.id + '(?:/|$)').test(location.pathname)
      : (item.href && location.pathname === item.href);
    if (here) a.classList.add('is-current');
    a.append(el('span', 'mbs-opt__dot'));
    a.append(el('span', 'mbs-opt__name', item.name || item.label));
    if (opts.tag) a.append(el('span', 'mbs-opt__tag', opts.tag));
    // keep the href so the row is still a real link (middle-click, copy
    // address), but prefer clicking ManageBac's own link on a plain click
    a.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      closePanel();
      goTo(item);
    });
    return a;
  }

  /* Rows are assembled in a fragment and swapped in as one insertion.
     Appending them straight to the live list meant every row of a long
     class list was its own layout pass, on every keystroke. */
  function renderPanel(term = '') {
    const frag = document.createDocumentFragment();
    const q = term.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    const hit = s => !words.length || words.every(w => (s || '').toLowerCase().includes(w));

    if (panelKind === 'classes') {
      const { now, past, current } = classGroups();
      const showPast = store.get('showPast', false) === true;

      const live = now.filter(c => hit(c.raw + ' ' + c.name));
      if (live.length) {
        if (current != null) frag.append(el('div', 'mbs-group', 'Grade ' + current));
        live.forEach(c => frag.append(optionRow(c)));
      }

      const oldOnes = past.filter(c => hit(c.raw + ' ' + c.name));
      if (oldOnes.length) {
        // a search always reaches earlier years; browsing keeps them folded
        if (q) {
          frag.append(el('div', 'mbs-group', 'Earlier years'));
          oldOnes.forEach(c => frag.append(optionRow(c, { past: true, tag: 'G' + c.grade })));
        } else {
          const fold = el('button', 'mbs-fold', 'Earlier years (' + oldOnes.length + ')');
          fold.type = 'button';
          fold.setAttribute('aria-expanded', showPast ? 'true' : 'false');
          fold.addEventListener('click', () => {
            store.set('showPast', !(store.get('showPast', false) === true));
            foldJustToggled = true;
            renderPanel(panelSearch.value);
          });
          frag.append(fold);
          if (showPast) oldOnes.forEach(c => {
            const row = optionRow(c, { past: true, tag: 'G' + c.grade });
            if (foldJustToggled && !REDUCED_MOTION.matches) row.classList.add('mbs-opt--enter');
            frag.append(row);
          });
          foldJustToggled = false;
        }
      }

      const groups = readGroups().filter(g => hit(g.raw + ' ' + g.name));
      if (groups.length && q) {
        frag.append(el('div', 'mbs-group', 'Groups'));
        groups.forEach(g => frag.append(optionRow(g)));
      }

      if (!frag.querySelector('.mbs-opt')) frag.append(el('div', 'mbs-empty', 'No class matches “' + term.trim() + '”.'));
    } else {
      CONFIG.more.filter(m => hit(m.label)).forEach(m => frag.append(optionRow(m)));
      readGroups().filter(g => hit(g.raw + ' ' + g.name)).forEach(g => frag.append(optionRow(g)));
      if (!frag.querySelector('.mbs-opt')) frag.append(el('div', 'mbs-empty', 'Nothing matches.'));
    }

    panelList.replaceChildren(frag);
    moveCursor(0, true);
  }

  function options() { return [...panelList.querySelectorAll('.mbs-opt')]; }

  function moveCursor(delta, reset) {
    const opts = options();
    if (!opts.length) return;
    let i = opts.findIndex(o => o.classList.contains('is-cursor'));
    if (reset || i < 0) i = 0; else i = (i + delta + opts.length) % opts.length;
    opts.forEach(o => o.classList.remove('is-cursor'));
    opts[i].classList.add('is-cursor');
    opts[i].scrollIntoView({ block: 'nearest' });
  }

  /* The panel lives on <body>, and ManageBac's client-side navigation
     replaces body content — detaching it while this closure still holds
     the reference. Checking only `if (panel)` returned early and re-opened
     a node no longer in the document: the tab lit up, nothing appeared.
     Rebuild whenever it isn't connected. */
  function ensurePanel() {
    if (panel && panel.isConnected) return;
    panel = el('div', 'mbs-panel');
    panel.hidden = true;
    const search = el('div', 'mbs-panel__search');
    panelSearch = el('input');
    panelSearch.type = 'search';
    panelSearch.autocomplete = 'off';
    panelSearch.setAttribute('aria-label', 'Find a class');
    search.append(panelSearch);
    panelList = el('div', 'mbs-list');

    const hint = el('div', 'mbs-panel__hint');
    [['↑↓', 'move'], ['↵', 'open'], ['esc', 'close']].forEach(([key, what]) => {
      const pair = el('span');
      pair.append(el('b', null, key), el('span', null, what));
      hint.append(pair);
    });

    panel.append(search, panelList, hint);
    document.body.appendChild(panel);

    panelSearch.addEventListener('input', () => renderPanel(panelSearch.value));
    panelSearch.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
      else if (e.key === 'Enter') {
        // go through the row's own handler so Enter and click behave alike
        const cur = panelList.querySelector('.mbs-opt.is-cursor') || options()[0];
        if (cur) { e.preventDefault(); cur.click(); }
      } else if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
    });

    // window-level listeners bind once, not on every rebuild
    if (!panelGlobalsBound) {
      panelGlobalsBound = true;
      addEventListener('mousedown', e => {
        if (!panel || panel.hidden) return;
        if (panel.contains(e.target) || (panelAnchor && panelAnchor.contains(e.target))) return;
        closePanel();
      });
      /* positionPanel() measures the anchor and the panel, so running it
         raw on resize forced two layouts per event. One per frame is
         indistinguishable and costs nothing while the panel is closed. */
      let repositioning = false;
      addEventListener('resize', () => {
        if (repositioning || !panel || panel.hidden) return;
        repositioning = true;
        requestAnimationFrame(() => {
          repositioning = false;
          if (panel && !panel.hidden) positionPanel();
        });
      });
      /* The search field carries its own Escape. This covers the case where
         focus has since moved off it — onto a row, or out of the panel. */
      addEventListener('keydown', e => {
        if (e.key === 'Escape' && panel && !panel.hidden) { e.preventDefault(); closePanel(); }
      });
    }
  }

  function positionPanel() {
    if (!panelAnchor) return;
    const r = panelAnchor.getBoundingClientRect();
    panel.style.top = Math.round(r.bottom + 8) + 'px';
    const left = Math.min(Math.round(r.left), innerWidth - panel.offsetWidth - 12);
    panel.style.left = Math.max(12, left) + 'px';
  }

  function openPanel(kind, anchor) {
    ensurePanel();
    panelKind = kind;
    panelAnchor = anchor;
    panelSearch.value = '';
    panelSearch.placeholder = kind === 'classes' ? 'Find a class…' : 'Find a page…';
    panel.hidden = false;
    positionPanel();
    renderPanel('');
    panelSearch.focus();
    if (anchor) anchor.classList.add('is-active');

    /* Opening animates; closing does not. A close that has to finish an
       animation before it can set hidden races the toggle that reopens it,
       and an instant dismissal reads as responsive rather than abrupt. */
    if (!REDUCED_MOTION.matches) {
      panel.animate(
        [{ opacity: 0, transform: 'translateY(-6px) scale(.985)' },
         { opacity: 1, transform: 'none' }],
        { duration: 150, easing: EASE }
      );
    }
  }

  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (panelAnchor) panelAnchor.classList.remove('is-active');
    panelAnchor = null;
    panelKind = null;
    markActiveTab();
  }

  function togglePanel(kind, anchor) {
    if (panel && !panel.hidden && panelKind === kind) closePanel();
    else openPanel(kind, anchor);
  }

  function markActiveTab() {
    const path = location.pathname;
    document.querySelectorAll('.mbs-tab[data-tab], .mbs-today[data-tab]').forEach(b => {
      const spec = CONFIG.tabs.find(t => t.id === b.dataset.tab);
      // Today owns no URL: what lights it is whether the dock is out
      const on = spec && spec.panel === 'timetable'
        ? dockOpen
        : spec && spec.match && spec.match.test(path);
      b.classList.toggle('is-active', !!on);
    });
  }

  function buildSwitch() {
    const host = document.querySelector('.navbar-row');
    if (!host) { buildStudyToday(); return; }
    // built independently, so a rebuild of one can't duplicate the other
    if (!document.querySelector('.mbs-switch')) buildTabs(host);
    if (!document.querySelector('.mbs-today')) buildToday(host);
    markActiveTab();
  }

  function buildTabs(host) {
    const wrap = el('nav', 'mbs-switch');
    wrap.setAttribute('aria-label', 'Sections');

    CONFIG.tabs.forEach(t => {
      if (t.panel === 'timetable') return;   // stands on its own, see buildToday
      const b = el('button', 'mbs-tab');
      b.type = 'button';
      b.dataset.tab = t.id;
      b.append(el('span', null, t.label));
      if (t.panel === 'classes') {
        const n = classGroups().now.length;
        if (n) b.append(el('span', 'mbs-tab__count', String(n)));
        b.append(el('span', 'mbs-kbd', '⌘K'));
        b.addEventListener('click', e => { e.stopPropagation(); togglePanel('classes', b); });
      } else {
        b.addEventListener('click', () => { goTo(t); });
      }
      wrap.append(b);
    });

    const more = el('button', 'mbs-tab', '···');
    more.type = 'button';
    more.setAttribute('aria-label', 'More sections');
    more.addEventListener('click', e => { e.stopPropagation(); togglePanel('more', more); });
    wrap.append(more);

    host.appendChild(wrap);
  }

  /* Over at the far end of the bar, past the bell and the avatar. Whether
     simply appending lands it there depends on how ManageBac aligns the rest
     of the row — an auto margin on its own right-hand cluster carries the
     button along, no margin at all leaves it stranded mid-bar — and that isn't
     something to read off the markup. So it measures once and pushes itself
     over only if it has to: a second auto margin in a row that already has one
     would split the free space between them and land it in the middle. */
  function todayButton() {
    const spec = CONFIG.tabs.find(t => t.panel === 'timetable');
    if (!spec) return null;
    const b = el('button', 'mbs-today');
    b.type = 'button';
    b.dataset.tab = spec.id;
    b.append(el('span', null, spec.label));
    b.setAttribute('aria-label', 'Timetable');
    b.addEventListener('click', e => { e.stopPropagation(); toggleDock(); });
    return b;
  }

  function buildToday(host) {
    const b = todayButton();
    if (!b) return;
    host.appendChild(b);

    // a bar that hasn't been laid out yet measures 0 wide, and a measurement
    // taken then would settle the placement on nothing
    let tries = 20;
    const place = () => {
      const row = host.getBoundingClientRect();
      if (!row.width && tries--) { requestAnimationFrame(place); return; }
      if (row.right - b.getBoundingClientRect().right > 40) b.classList.add('mbs-today--far');
    };
    place();
  }

  /* Study Mode opens in a tab of its own with a bar of its own — a title and
     a Close button, none of ManageBac's usual row — so the switcher has
     nowhere to go. Today still does: it sits beside Close, so the timetable
     can be brought out (or put away) here too. */
  function buildStudyToday() {
    const bar = document.querySelector('header.presentation-head .stream-presentation');
    if (!bar || document.querySelector('.mbs-today')) return;
    const b = todayButton();
    if (!b) return;
    b.classList.add('mbs-today--study');
    bar.prepend(b);
    markActiveTab();
  }

  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 'k') {
      e.preventDefault();
      togglePanel('classes', document.querySelector('.mbs-tab[data-tab="classes"]'));
    }
  });

  /* ============================================================
     TIMETABLE
     ============================================================ */

  /* Where the rows below came from, and where to go when they stop matching:
     the school's published Prime Timetable for 11B. The 2025 script put last
     year's publish in an iframe over ManageBac's own Timetables page; the dock
     scrapes this one instead and keeps the link at its foot. The id changes
     each time the school republishes, so this is the line to repoint. */
  const TT_SOURCE = 'https://primetimetable.com/publish/?id=3d9e5ee3-c15b-41f7-810c-0e16e6cafa92&rp=1&inc=1&time=6#id=3d9e5ee3-c15b-41f7-810c-0e16e6cafa92&view=1&classId=6e80eda3-3061-41f2-9b6e-7cff2454c3dd';

  /* Read from that timetable on 30 Sep 2026: the "SY115-1 Secondary Sem 1
     [Sept 1 Update]" edition, itself last updated 30 Sep. It carries no dates,
     only the two-week cycle, so which week is which still has to be pinned by
     hand — see TT_ANCHOR below.

     The rows come from the viewer's own JSON rather than its DOM:

       https://primetimetable.com/api/v2/timetables/<the publish id>/

     which holds days, periods, subjects, rooms, teachers and activities. An
     activity belongs to 11B when its groupIds meet one of that class's groups;
     each of its cards is one slot, taking the day from card.dayId, the start
     from card.periodId, and the end from the period (length - 1) further along
     — both ids are omitted when they are the first day or the first period.

     Columns 0-4 are the halves it labels 1..5 (Week 1); 5-9 are the ones it
     labels Mon..Fri (Week 2).
     subject ~ day ~ start ~ end ~ staff ~ room */
  const TT_RAW = `G: Agency [EE, CAS, CC]~0~08:10~08:30~Michael Chiang~5F HS3
DP MAA HL~0~08:35~09:25~Emerson Michel~5F HS5
DP MAA SL~0~08:35~09:25~Adam Chiang~5F-Lab
DP MAI HL~0~08:35~09:25~Benedikt Gottschlich~5F HS3
DP MAA HL~0~09:25~10:10~Emerson Michel~5F HS5
DP MAA SL~0~09:25~10:10~Adam Chiang~5F-Lab
DP MAI HL~0~09:25~10:10~Benedikt Gottschlich~5F HS3
DP Chi B SL/HL~0~10:20~11:05~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~0~10:20~11:05~David Huck~5F HS4
DP Chi B SL/HL~0~11:05~11:50~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~0~11:05~11:50~David Huck~5F HS4
DP Comp. Sc.~0~12:50~13:40~Michael Chiang~6F-DP VA Studio
DP ESS~0~12:50~13:40~Billy Leong~5F HS2
DP Comp. Sc.~0~13:40~14:25~Michael Chiang~6F-DP VA Studio
DP ESS~0~13:40~14:25~Billy Leong~5F HS2
DP Bio~0~14:35~15:20~Sophia Lin~5F-Lab
DP Bus Man~0~14:35~15:20~Antony Chen~5F HS5
DP Physics~0~14:35~15:20~Benedikt Gottschlich~5F HS3
DP V. Arts~0~14:35~15:20~David Wang~6F-DP VA Studio
DP TOK-1~0~15:20~16:05~Michael Chiang~5F HS3
DP TOK-2~0~15:20~16:05~Harrison Hedges~5F HS5
DP Chi A-2 SL Revision~0~15:40~16:30~Judy Wu 伍智梅~5F HS3
DP Bus Man~0~16:15~16:50~Antony Chen~5F HS5
G: Weekly Alignment~1~08:10~08:30~Benedikt Gottschlich~5F HS3
DP Econ~1~08:35~09:25~Michael Chiang~5F HS3
DP History~1~08:35~09:25~Neil Hockin~5F HS2
DP Psych~1~08:35~09:25~Andrew Wang~5F HS5
DP Econ~1~09:25~10:10~Michael Chiang~5F HS3
DP History~1~09:25~10:10~Neil Hockin~5F HS2
DP Psych~1~09:25~10:10~Andrew Wang~5F HS5
DP Eng A-2~1~10:20~11:05~Jillianne Burrow~5F HS4
Eng Lit~1~10:20~11:05~Pete Williams~3F HS6 9A
DP Eng A-2~1~11:05~11:50~Jillianne Burrow~5F HS4
Eng Lit~1~11:05~11:50~Pete Williams~3F HS6 9A
DP Chem~1~12:50~13:40~Maggie Gajewska~5F-Lab
DP Chi A-2~1~12:50~13:40~Judy Wu 伍智梅~5F HS2
DP Chem~1~13:40~14:25~Maggie Gajewska~5F-Lab
DP Chi A-2~1~13:40~14:25~Judy Wu 伍智梅~5F HS2
DP TOK-1~1~14:35~15:20~Michael Chiang~5F HS3
DP TOK-2~1~14:35~15:20~Harrison Hedges~5F HS2
Service Clubs~1~15:25~16:05~Claire Huang;Robert Chung;Evelyn Chang 張韻祥;Nancy Huang 黃聖雅~6F-DP VA Studio;6F DP Library;6F MYP Studio;5F CC;3F HS7 9B;3F HS6 9A;2F DP Chi Lib;5F-Lab
DP ESS SL Rrevision~1~16:10~16:55~Billy Leong~5F HS3
G: Agency [EE, CAS, CC]~2~08:10~08:30~Andrew Wang;Jeremy Yeung~5F HS3
DP MAA HL~2~08:35~09:25~Emerson Michel~5F HS5
DP MAA SL~2~08:35~09:25~Adam Chiang~5F-Lab
DP MAI HL~2~08:35~09:25~Benedikt Gottschlich~5F HS3
DP MAA HL~2~09:25~10:10~Emerson Michel~5F HS5
DP MAA SL~2~09:25~10:10~Adam Chiang~5F-Lab
DP MAI HL~2~09:25~10:10~Benedikt Gottschlich~5F HS3
DP Chi B SL/HL~2~10:20~11:05~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~2~10:20~11:05~David Huck~2F HS8 10A
DP Chi B SL/HL~2~11:05~11:50~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~2~11:05~11:50~David Huck~2F HS8 10A
DP Comp. Sc.~2~12:50~13:40~Michael Chiang~6F-DP VA Studio
DP ESS~2~12:50~13:40~Billy Leong~5F HS2
DP Comp. Sc.~2~13:40~14:25~Michael Chiang~6F-DP VA Studio
DP ESS~2~13:40~14:25~Billy Leong~5F HS2
DP Bio~2~14:35~15:20~Sophia Lin~5F-Lab
DP Bus Man~2~14:35~15:20~Antony Chen~5F HS5
DP Physics~2~14:35~15:20~Benedikt Gottschlich~5F HS3
DP V. Arts~2~14:35~15:20~David Wang~6F-DP VA Studio
DP Bio~2~15:20~16:05~Sophia Lin~5F-Lab
DP Physics~2~15:20~16:05~Benedikt Gottschlich~5F HS3
DP V. Arts~2~15:20~16:05~David Wang~6F-DP VA Studio
DP Chi A-2 SL Revision~2~16:10~16:55~Judy Wu 伍智梅~5F HS3
Guidance~3~08:10~08:30~Benedikt Gottschlich~5F HS3
DP Econ~3~08:35~09:25~Michael Chiang~5F HS3
DP History~3~08:35~09:25~Neil Hockin~5F HS2
DP Psych~3~08:35~09:25~Andrew Wang~5F HS5
DP Econ~3~09:25~10:10~Michael Chiang~5F HS3
DP History~3~09:25~10:10~Neil Hockin~5F HS2
DP Psych~3~09:25~10:10~Andrew Wang~5F HS5
DP Eng A-2~3~10:20~11:05~Jillianne Burrow~5F HS4
DP Eng A-2~3~11:05~11:50~Jillianne Burrow~5F HS4
DP Chem~3~12:50~13:40~Maggie Gajewska~5F-Lab
DP Chi A-2~3~12:50~13:40~Judy Wu 伍智梅~5F HS2
DP Chem~3~13:40~14:25~Maggie Gajewska~5F-Lab
DP Chi A-2~3~13:40~14:25~Judy Wu 伍智梅~5F HS2
DP TOK-1~3~14:35~15:20~Michael Chiang~5F HS3
DP TOK-2~3~14:35~15:20~Harrison Hedges~5F HS2
Academic Clubs~3~15:25~16:05~Judy Wu 伍智梅;Byron Dyck;Neil Hockin;Curtis Quick;David Huck;Emerson Michel;Maggie Gajewska;Michael Chiang;Adam Chiang;Benedikt Gottschlich;Sophia Lin~3F HS7 9B;3F HS6 9A;2F HS8 10A;5F-Lab;5F CC;6F DP Library;6F MYP Studio;6F-MPR;6F-DP VA Studio
DP Bio SL Revision~3~16:10~16:55~Sophia Lin~5F-Lab
DP Bus Man~3~16:10~16:55~Antony Chen~5F HS5
G: Agency [EE, CAS, CC]~4~08:10~08:30~~5F HS3
DP MAA HL~4~08:35~09:25~Emerson Michel~5F HS5
DP MAA SL~4~08:35~09:25~Adam Chiang~5F HS4
DP MAI HL~4~08:35~09:25~Benedikt Gottschlich~5F HS3
DP MAA HL~4~09:25~10:10~Emerson Michel~5F HS5
DP MAA SL~4~09:25~10:10~Adam Chiang~5F HS4
DP MAI HL~4~09:25~10:10~Benedikt Gottschlich~5F HS3
DP Chi B SL/HL~4~10:20~11:05~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~4~10:20~11:05~David Huck~2F HS8 10A
DP Chi B SL/HL~4~11:05~11:50~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~4~11:05~11:50~David Huck~2F HS8 10A
DP Chem~4~12:50~13:40~Maggie Gajewska~5F-Lab
DP Chi A-2~4~12:50~13:40~Judy Wu 伍智梅~5F HS5
DP Chem~4~13:40~14:25~Maggie Gajewska~5F-Lab
DP Chi A-2~4~13:40~14:25~Judy Wu 伍智梅~5F HS5
DP Bio~4~14:35~15:20~Sophia Lin~5F-Lab
DP Bus Man~4~14:35~15:20~Antony Chen~5F HS5
DP Physics~4~14:35~15:20~Benedikt Gottschlich~5F HS3
DP V. Arts~4~14:35~15:20~David Wang~6F-DP VA Studio
DP Bio~4~15:20~16:05~Sophia Lin~5F-Lab
DP Bus Man~4~15:20~16:05~Antony Chen~5F HS5
DP Physics~4~15:20~16:05~Benedikt Gottschlich~5F HS3
DP V. Arts~4~15:20~16:05~David Wang~6F-DP VA Studio
G: Agency [EE, CAS, CC]~5~08:10~08:30~Michael Chiang~5F HS3
DP MAA HL~5~08:35~09:25~Emerson Michel~5F HS5
DP MAA SL~5~08:35~09:25~Adam Chiang~5F-Lab
DP MAI HL~5~08:35~09:25~Benedikt Gottschlich~5F HS3
DP MAA HL~5~09:25~10:10~Emerson Michel~5F HS5
DP MAA SL~5~09:25~10:10~Adam Chiang~5F-Lab
DP MAI HL~5~09:25~10:10~Benedikt Gottschlich~5F HS3
DP Chi B SL/HL~5~10:20~11:05~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~5~10:20~11:05~David Huck~1F HS9 10B
DP Chi B SL/HL~5~11:05~11:50~Evelyn Chang 張韻祥~5F HS3
DP Eng B-2~5~11:05~11:50~David Huck~1F HS9 10B
DP Chem~5~12:50~13:40~Maggie Gajewska~5F-Lab
DP Chi A-2~5~12:50~13:40~Judy Wu 伍智梅~5F HS4
DP Chem~5~13:40~14:25~Maggie Gajewska~5F-Lab
DP Chi A-2~5~13:40~14:25~Judy Wu 伍智梅~5F HS4
DP Bio~5~14:35~15:20~Sophia Lin~5F-Lab
DP Bus Man~5~14:35~15:20~Antony Chen~5F HS5
DP Physics~5~14:35~15:20~Benedikt Gottschlich~5F HS3
DP V. Arts~5~14:35~15:20~David Wang~
DP Bio~5~15:20~16:05~Sophia Lin~5F-Lab
DP Bus Man~5~15:20~16:05~Antony Chen~5F HS5
DP Physics~5~15:20~16:05~Benedikt Gottschlich~5F HS3
DP V. Arts~5~15:20~16:05~David Wang~
G: Weekly Alignment~6~08:10~08:30~Benedikt Gottschlich~5F HS3
DP Econ~6~08:35~09:25~Michael Chiang~5F HS3
DP History~6~08:35~09:25~Neil Hockin~5F HS2
DP Psych~6~08:35~09:25~Andrew Wang~5F HS5
DP Econ~6~09:25~10:10~Michael Chiang~5F HS3
DP History~6~09:25~10:10~Neil Hockin~5F HS2
DP Psych~6~09:25~10:10~Andrew Wang~5F HS5
DP Eng A-2~6~10:20~11:05~Jillianne Burrow~5F HS4
DP Eng A-2~6~11:05~11:50~Jillianne Burrow~5F HS4
DP Comp. Sc.~6~12:50~13:40~Michael Chiang~6F-DP VA Studio
DP ESS~6~12:50~13:40~Billy Leong~5F HS2
DP Comp. Sc.~6~13:40~14:25~Michael Chiang~6F-DP VA Studio
DP ESS~6~13:40~14:25~Billy Leong~5F HS2
Service Clubs~6~15:25~16:05~Billy Leong;Harrison Hedges;Jeremy Yeung;David Wang;Chelia Lei 雷靜宜;Jun-Wei Lee 李峻瑋;Claire Huang~6F-DP VA Studio;6F DP Library;6F MYP Studio;5F CC;3F HS7 9B;3F HS6 9A;2F DP Chi Lib;5F-Lab
DP ESS SL Rrevision~6~16:10~16:55~Billy Leong~5F HS3
G: Agency [EE, CAS, CC]~7~08:10~08:30~Andrew Wang;Jeremy Yeung~5F HS3
DP MAA HL~7~08:35~09:25~Emerson Michel~5F HS5
DP MAA SL~7~08:35~09:25~Adam Chiang~5F-Lab
DP MAI HL~7~08:35~09:25~Benedikt Gottschlich~5F HS3
DP MAA HL~7~09:25~10:10~Emerson Michel~5F HS5
DP MAA SL~7~09:25~10:10~Adam Chiang~5F-Lab
DP MAI HL~7~09:25~10:10~Benedikt Gottschlich~5F HS3
DP Chi B SL/HL~7~10:20~11:05~Evelyn Chang 張韻祥~2F HS8 10A
DP Eng B-2~7~10:20~11:05~David Huck~5F HS3
DP Chi B SL/HL~7~11:05~11:50~Evelyn Chang 張韻祥~2F HS8 10A
DP Eng B-2~7~11:05~11:50~David Huck~5F HS3
DP Chem~7~12:50~13:40~Maggie Gajewska~5F-Lab
DP Chi A-2~7~12:50~13:40~Judy Wu 伍智梅~5F HS2
DP Chem~7~13:40~14:25~Maggie Gajewska~5F-Lab
DP Chi A-2~7~13:40~14:25~Judy Wu 伍智梅~5F HS2
DP TOK-1~7~14:35~15:20~Michael Chiang~5F HS3
DP TOK-2~7~14:35~15:20~Harrison Hedges~5F HS5
DP Bio~7~15:20~16:05~Sophia Lin~5F-Lab
DP Physics~7~15:20~16:05~Benedikt Gottschlich~5F HS3
DP V. Arts~7~15:20~16:05~David Wang~6F-DP VA Studio
Guidance~8~08:10~08:30~Benedikt Gottschlich~5F HS3
DP Econ~8~08:35~09:25~Michael Chiang~5F HS3
DP History~8~08:35~09:25~Neil Hockin~5F HS2
DP Psych~8~08:35~09:25~Andrew Wang~5F HS5
DP Econ~8~09:25~10:10~Michael Chiang~5F HS3
DP History~8~09:25~10:10~Neil Hockin~5F HS2
DP Psych~8~09:25~10:10~Andrew Wang~5F HS5
DP Eng A-2~8~10:20~11:05~Jillianne Burrow~5F HS4
Eng Lit~8~10:20~11:05~Pete Williams~5F HS2
DP Eng A-2~8~11:05~11:50~Jillianne Burrow~5F HS4
Eng Lit~8~11:05~11:50~Pete Williams~5F HS2
DP Comp. Sc.~8~12:50~13:40~Michael Chiang~6F-DP VA Studio
DP ESS~8~12:50~13:40~Billy Leong~5F HS2
DP Comp. Sc.~8~13:40~14:25~Michael Chiang~6F-DP VA Studio
DP ESS~8~13:40~14:25~Billy Leong~5F HS2
DP Chi A-2 SL Revision~8~14:35~15:20~Judy Wu 伍智梅~5F HS3
Academic Clubs~8~15:25~16:05~Judy Wu 伍智梅;Byron Dyck;Neil Hockin;Curtis Quick;David Huck;Emerson Michel;Maggie Gajewska;Michael Chiang;Adam Chiang;Benedikt Gottschlich;Sophia Lin~3F HS7 9B;3F HS6 9A;2F HS8 10A;5F-Lab;5F CC;6F DP Library;6F MYP Studio;6F-MPR;6F-DP VA Studio
DP Bio SL Revision~8~16:10~16:55~Sophia Lin~5F-Lab
DP Bus Man~8~16:10~16:55~Antony Chen~5F HS2
Guidance~9~08:10~08:30~Benedikt Gottschlich~5F HS3
DP Econ~9~08:35~09:25~Michael Chiang~5F HS3
DP History~9~08:35~09:25~Neil Hockin~5F HS2
DP Psych~9~08:35~09:25~Andrew Wang~5F HS5
DP Econ~9~09:25~10:10~Michael Chiang~5F HS3
DP History~9~09:25~10:10~Neil Hockin~5F HS2
DP Psych~9~09:25~10:10~Andrew Wang~5F HS5
DP Eng A-2~9~10:20~11:05~Jillianne Burrow~5F HS4
DP Eng A-2~9~11:05~11:50~Jillianne Burrow~5F HS4
Eng Lit~9~11:05~11:50~Pete Williams~5F HS2
DP Comp. Sc.~9~12:50~13:40~Michael Chiang~6F-DP VA Studio
DP ESS~9~12:50~13:40~Billy Leong~5F HS2
DP Comp. Sc.~9~13:40~14:25~Michael Chiang~6F-DP VA Studio
DP ESS~9~13:40~14:25~Billy Leong~5F HS2
DP Bio~9~14:35~15:20~Sophia Lin~5F-Lab
DP Bus Man~9~14:35~15:20~Antony Chen~5F HS5
DP Physics~9~14:35~15:20~Benedikt Gottschlich~5F HS3
DP V. Arts~9~14:35~15:20~David Wang~6F-DP VA Studio
DP Bio~9~15:20~16:05~Sophia Lin~5F-Lab
DP Bus Man~9~15:20~16:05~Antony Chen~5F HS5
DP Physics~9~15:20~16:05~Benedikt Gottschlich~5F HS3
DP V. Arts~9~15:20~16:05~David Wang~6F-DP VA Studio`;

  /* Tiger's diploma, read from My Classes on 30 Sep 2026. Edit this list if
     an option changes. */
  const TT_MINE = new Set([
    'DP Chi A-2', 'DP Chi A-2 SL Revision',   // Chinese A: Lang & Lit
    'DP Eng B-2',                             // English B
    'Eng Lit',                                // the school's own literature
                                              // class, not a DP course — it
                                              // runs opposite DP Eng A-2
    'DP MAI HL',                              // Mathematics AI HL
    'DP Comp. Sc.',                           // Computer Science
    'DP Econ',                                // Economics
    'DP Bus Man',                             // Business Management
    'DP TOK-1',                               // TOK group 1, Michael Chiang's
    'Guidance', 'G: Agency [EE, CAS, CC]', 'G: Weekly Alignment',
    'Service Clubs', 'Academic Clubs'
  ]);

  /* Slots on the timetable that aren't actually attended, as [subject, day].
     Chinese revision is once a week: Week 1 Wednesday and Week 2 Thursday,
     not the Week 1 Monday one as well. */
  const TT_SKIP = [
    ['DP Chi A-2 SL Revision', 0]
  ];

  const TT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  /* The two halves of the fortnight are marked with Eastern Arabic digits.
     Everything else in the strip is a Latin numeral — column numbers, times,
     minutes — and the week is not one more of those; it is the thing they all
     hang off, so it is written in a hand of its own. */
  const TT_WEEK_MARK = ['\u0661', '\u0662'];
  const ttMin = t => (+t.slice(0, 2)) * 60 + (+t.slice(3, 5));
  const ttHHMM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  const TT = TT_RAW.split('\n').map(line => {
    const [subject, d, start, end, staff, room] = line.split('~');
    return { subject, d: +d, s: ttMin(start), e: ttMin(end), start, end,
             staff: (staff || '').split(';').filter(Boolean),
             room: (room || '').split(';').filter(Boolean) };
  }).filter(l => TT_MINE.has(l.subject) && !TT_SKIP.some(([sub, d]) => sub === l.subject && d === l.d));

  /* The timetable only says "Service Clubs" and "Academic Clubs" and lists
     every club's teacher and room at once, so which club is actually yours
     is filled in here. Days 0-4 are Week 1 (the odd week), 5-9 Week 2. */
  const TT_CLUBS = [
    ['Service Clubs',  d => d < 5,  '台東服務隊',   'Claire Huang', '1F Library'],
    ['Service Clubs',  d => d >= 5, 'Scout Club',   'Jun-Wei Lee',  '1F'],
    ['Academic Clubs', () => true,  'Finance Club', '',             '2F']
  ];
  TT.forEach(l => {
    const c = TT_CLUBS.find(([sub, wk]) => sub === l.subject && wk(l.d));
    if (c) Object.assign(l, { subject: c[2], staff: c[3] ? [c[3]] : [], room: c[4] ? [c[4]] : [] });
  });

  /* School ends at 16:05. Any period before then with none of your classes in
     it is IB Core time, so it gets a row of its own rather than showing up as
     "Free". The periods are the ones the whole of 11B is timetabled in that
     day, so the rows keep to the real bells and the breaks stay breaks; an
     hour nobody in 11B is timetabled for falls back on the standard bells. */
  const TT_CORE = 'IB Core', TT_END = ttMin('16:05');
  const TT_ALL = TT_RAW.split('\n').map(line => {
    const [, d, start, end] = line.split('~');
    return { d: +d, s: ttMin(start), e: ttMin(end), start, end };
  });
  const TT_BELLS = ['08:35-09:25', '09:25-10:10', '10:20-11:05', '11:05-11:50',
                    '12:50-13:40', '13:40-14:25', '14:35-15:20', '15:20-16:05'];
  for (let d = 0; d < 10; d++) TT_BELLS.forEach(b => {
    const [start, end] = b.split('-');
    TT_ALL.push({ d, s: ttMin(start), e: ttMin(end), start, end });
  });
  for (let d = 0; d < 10; d++) {
    const day = TT.filter(l => l.d === d);
    if (!day.length) continue;
    const from = Math.min(...day.map(l => l.s));
    const taken = day.slice();
    TT_ALL.filter(p => p.d === d && p.s >= from && p.e <= TT_END)
      .sort((x, y) => x.s - y.s || x.e - y.e)
      .forEach(p => {
        if (taken.some(l => l.s < p.e && p.s < l.e)) return;
        const row = { subject: TT_CORE, d, s: p.s, e: p.e, start: p.start, end: p.end, staff: [], room: [] };
        TT.push(row); taken.push(row);
      });
  }

  /* The grid carries no dates. Week 2 is pinned to the week of Mon 7 Sep 2026
     and the rest alternate; if the cycle ever reads a week out, this is the
     only line to change. */
  const TT_ANCHOR = Date.UTC(2026, 8, 7);
  const ttMonday = dt => {
    const d = Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return d - ((new Date(d).getUTCDay() + 6) % 7) * 864e5;
  };
  const ttWeek = dt => (Math.round((ttMonday(dt) - TT_ANCHOR) / (7 * 864e5)) % 2 + 2) % 2 === 0 ? 1 : 0;
  const ttNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
  const ttToday = () => { const d = new Date().getDay(); return d >= 1 && d <= 5 ? d - 1 : -1; };
  const ttWhere = l => l.room.length === 1 ? l.room[0] : l.room.length ? l.room.length + ' rooms' : '';
  /* The DP prefix comes off, and TOK loses its group number — with only one
     of the two groups taken there is nothing left for it to tell apart. Every
     other trailing "-N" stays, which is why tidy() is not usable here: it
     strips them all, and would turn Eng B-2 into "Eng B". */
  const ttName = s => s.replace(/^DP\s+/, '').replace(/^TOK-\d+$/, 'TOK');

  /* Parallel option blocks share a start, so they become sibling rows under one
     time rather than competing for width. */
  function ttSlots(half, day) {
    const list = TT.filter(l => l.d === half * 5 + day).sort((a, b) => a.s - b.s || a.subject.localeCompare(b.subject));
    const out = [];
    list.forEach(l => {
      const last = out[out.length - 1];
      if (last && last.s === l.s && last.e === l.e) last.items.push(l);
      else out.push({ s: l.s, e: l.e, start: l.start, end: l.end, items: [l] });
    });
    return out;
  }

  /* Once the day is cut to six subjects the holes get long, and one "free" row
     would swallow the lunch hour whole, so any gap crossing it is split. */
  const TT_LUNCH_S = 11 * 60 + 50, TT_LUNCH_E = 12 * 60 + 50;
  function ttGaps(from, to) {
    const parts = [];
    const ls = Math.max(from, TT_LUNCH_S), le = Math.min(to, TT_LUNCH_E);
    if (ls < le) {
      if (from < ls) parts.push([from, ls, null]);
      parts.push([ls, le, 'Lunch']);
      if (le < to) parts.push([le, to, null]);
    } else parts.push([from, to, null]);
    return parts.filter(([a, b]) => b - a > 0)
                .map(([a, b, l]) => [a, b, l || (b - a <= 15 ? 'Break' : 'Free')]);
  }

  /* Taught slots and the stretches between them are the same kind of thing:
     either can be the one running now, and either can carry the marker. */
  function ttLine(half, day) {
    const out = [];
    let prev = null;
    ttSlots(half, day).forEach(sl => {
      if (prev != null && sl.s > prev)
        ttGaps(prev, sl.s).forEach(([a, b, label]) => out.push({ s: a, e: b, gap: label }));
      prev = sl.e;
      out.push({ s: sl.s, e: sl.e, slot: sl });
    });
    return out;
  }

  const ttWidth = (seg, t) => {
    const pct = Math.max(0, Math.min(1, (t - seg.s) / (seg.e - seg.s)));
    return 'calc(' + (pct * 100) + '% - ' + (pct * 8) + 'px + 4px)';
  };

  /* The stroke draws itself on once a visit, not once a page. ManageBac moves
     between sections by loading whole pages, so with the rail already out the
     highlighter swept across again on every class, every task, every trip to
     IB Manager — worth watching the first time, noise the twentieth.
     sessionStorage is per tab and survives a navigation, which makes it the
     record of "already seen"; a deliberate reload overrides that record, and
     so does opening the rail by hand. Storage that throws (a locked-down
     profile) falls back to drawing, which is the old behaviour. */
  let ttDrawOn = (() => {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      const seen = sessionStorage.getItem('mbs-tt-drawn');
      sessionStorage.setItem('mbs-tt-drawn', '1');
      return !seen || (nav && nav.type === 'reload');
    } catch (e) { return true; }
  })();

  /* Width is set to its resting value before the node goes in, so the mark is
     right even in a tab that never paints; the stroke is then drawn on over
     that, and only while the page is actually visible — a hidden tab never
     advances an animation, and a running one outranks the inline width. */
  /* Every "N min" in the dock — the Now card's and the running row's — is made
     here and carries the minute it counts down to, so the ticker below can move
     them all together and they never disagree. */
  function ttCountdown(end, unit, cls) {
    const c = el('span', 'mbs-tt__cd' + (cls ? ' ' + cls : ''), Math.ceil(end - ttNow()) + unit);
    c.dataset.end = end;
    c.dataset.unit = unit;
    return c;
  }

  function ttMarker(row, seg, t) {
    row._seg = seg;
    const sw = el('div', 'mbs-tt__swipe');
    sw.append(el('i'));
    sw.style.width = ttWidth(seg, t);
    row.append(sw, ttCountdown(seg.e, ' min', 'mbs-tt__left'));
    if (ttDrawOn && !REDUCED_MOTION.matches && document.visibilityState === 'visible') {
      ttDrawOn = false;   // spent only when it actually plays
      sw.animate([{ width: '0px' }, { width: sw.style.width }], { duration: 700, easing: EASE });
    }
  }

  let ttSel = null;

  /* ---------- the dock ----------
     A panel hung off a tab can only be as tall as a dropdown ought to be, and
     it closes the moment you touch the page behind it — which is most of what
     you want to be doing while you check what is next. The dock keeps its
     width instead, and stays out across pages and navigations, so the day is
     simply there to glance at. */
  let dock = null, dockList = null, dockGlobalsBound = false;
  let dockOpen = store.get('dock', false) === true;

  /* The dock hangs from the bottom edge of the top bar, wherever that is on
     this page. */
  function dockTop() {
    const nav = document.querySelector('nav.navbar');
    const top = nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
    document.documentElement.style.setProperty('--dock-top', top + 'px');
  }

  function bindDockGlobals() {
    if (dockGlobalsBound) return;
    const nav = document.querySelector('nav.navbar');
    if (!nav) return;
    dockGlobalsBound = true;
    let pending = false;
    const nudge = () => {
      if (pending || !dockOpen) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; dockTop(); });
    };
    addEventListener('resize', nudge);
    /* A pinned bar keeps the same bottom edge the whole way down the page, so
       only a bar that scrolls away is worth following — and following costs a
       forced layout per frame of scrolling. */
    const pos = getComputedStyle(nav).position;
    if (pos !== 'fixed' && pos !== 'sticky') addEventListener('scroll', nudge, { passive: true });
  }

  /* Same problem the palette has: ManageBac's client-side navigation replaces
     the body, taking the dock with it while this closure still holds the
     reference. Rebuilt whenever it isn't connected, and the caller re-renders
     only then. */
  function ensureDock() {
    if (dock && dock.isConnected) return false;
    dock = el('aside', 'mbs-dock');
    dock.setAttribute('aria-label', 'Timetable');
    document.body.appendChild(dock);
    return true;
  }

  /* Called on every pass, so it re-renders only when it has to: when the dock
     has just been rebuilt, or when the caller says the day has changed under
     it. `force` is what makes reopening land on today. */
  function syncDock(force) {
    if (!document.body) return;
    const root = document.documentElement;
    root.classList.toggle('mbs-docked', dockOpen);
    if (!dockOpen) { if (dock) dock.hidden = true; return; }
    root.classList.toggle('mbs-dock-loose', !document.querySelector('.f-layout-main__wrapper'));
    const fresh = ensureDock();
    dock.hidden = false;
    bindDockGlobals();
    dockTop();
    if (force || fresh || !dockList || !dockList.isConnected) renderTimetable(true);
  }

  /* The dock slides the whole of its width in and out, and the page slides
     with it: the wrapper's padding runs on the same duration and curve as the
     dock's transform, so the content's left edge stays glued to the dock's
     right edge the whole way instead of jumping once the dock has arrived.
     The padding transition only exists while a toggle is running (the
     mbs-dock-anim class) — left on, every page load with the dock already out
     would slide the content in from the left. */
  const DOCK_MS = 420, DOCK_EASE = 'cubic-bezier(.32, .72, 0, 1)';
  let dockAnimTimer = 0, dockSeq = 0;
  function dockAnimating() {
    const root = document.documentElement;
    root.classList.add('mbs-dock-anim');
    clearTimeout(dockAnimTimer);
    dockAnimTimer = setTimeout(() => root.classList.remove('mbs-dock-anim'), DOCK_MS + 60);
  }

  function toggleDock(force) {
    dockOpen = force == null ? !dockOpen : !!force;
    store.set('dock', dockOpen);
    // reopening always lands on today, however far the day picker was walked,
    // and is deliberate enough to be worth drawing the marker on again
    if (dockOpen) { ttSel = null; ttDrawOn = true; }
    const motion = !REDUCED_MOTION.matches;
    if (motion) dockAnimating();
    // a toggle mid-slide takes over from wherever the last one had got to
    const was = dock && dock.isConnected && !dock.hidden
      ? getComputedStyle(dock).transform : null;
    if (dock) dock.getAnimations().forEach(a => a.cancel());

    if (dockOpen) {
      syncDock(true);
      markActiveTab();
      if (motion)
        dock.animate([{ transform: was && was !== 'none' ? was : 'translateX(-100%)' }, { transform: 'none' }],
                     { duration: DOCK_MS, easing: DOCK_EASE });
      return;
    }

    markActiveTab();
    if (!motion || !dock || !dock.isConnected || dock.hidden) { syncDock(true); return; }
    // the page starts back across straight away; the dock stays drawn until
    // it has slid clear, and only then is it hidden
    document.documentElement.classList.remove('mbs-docked');
    const out = dock.animate([{ transform: was || 'none' }, { transform: 'translateX(-100%)' }],
                             { duration: DOCK_MS, easing: DOCK_EASE, fill: 'forwards' });
    // finish events wait for a frame, which a background tab never paints, so
    // a timer backs them up; the sequence number stops a stale one from
    // hiding a dock that has since been reopened and closed again
    const seq = ++dockSeq;
    const done = () => { if (!dockOpen && seq === dockSeq) { dock.hidden = true; out.cancel(); } };
    out.onfinish = done;
    setTimeout(done, DOCK_MS + 40);
  }

  function renderTimetable(focus) {
    if (!dock) return;
    const t = ttNow(), tIdx = ttToday(), tHalf = ttWeek(new Date());
    if (!ttSel) ttSel = tIdx >= 0 ? { half: tHalf, day: tIdx }
      : { half: ttWeek(new Date(Date.now() + (new Date().getDay() === 6 ? 2 : 1) * 864e5)), day: 0 };
    const live = ttSel.day === tIdx && ttSel.half === tHalf;

    const head = el('div', 'mbs-tt__head');
    head.append(el('h2', null, TT_DAYS[ttSel.day] + ' \u2014 Week ' + (ttSel.half + 1)));
    // Week 2's columns are named for the days, so the reference is the title again
    if (ttSel.half === 0) head.append(el('span', 'src', 'col ' + (ttSel.day + 1)));
    head.append(el('span', 'sp'));
    if (live) head.append(el('span', 'tdy', 'today'));
    const x = el('button', 'mbs-tt__x', '\u00d7');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close the timetable');
    x.addEventListener('click', e => { e.stopPropagation(); toggleDock(false); });
    head.append(x);

    const ruler = el('div', 'mbs-tt__ruler');
    [0, 1].forEach(half => {
      const wkrow = el('div', 'mbs-tt__wkrow');
      wkrow.append(el('div', 'mbs-tt__wk', TT_WEEK_MARK[half]));
      TT_DAYS.forEach((d, i) => {
        const b = el('button', 'mbs-tt__day' + (half === tHalf && i === tIdx ? ' is-today' : ''));
        b.type = 'button';
        b.setAttribute('aria-current', String(ttSel.half === half && ttSel.day === i));
        if (half === tHalf && i === tIdx) b.append(el('span', 'mbs-tt__mark'));
        // the numeral stands in for the name on the Week 1 row, so the day
        // has to be said somewhere a screen reader can still reach it
        b.setAttribute('aria-label', d + ', Week ' + (half + 1));
        // Week 1's columns are numbered rather than named, and the Week 2 row
        // standing underneath already says which day each column is
        b.append(el('b', null, half === 0 ? String(i + 1) : d));
        b.addEventListener('click', e => { e.stopPropagation(); ttSel = { half, day: i }; renderTimetable(true); });
        wkrow.append(b);
      });
      ruler.append(wkrow);
    });

    const list = el('div', 'mbs-tt__list');
    const line = ttLine(ttSel.half, ttSel.day);
    if (!line.length) list.append(el('div', 'mbs-tt__none', 'Nothing on this day.'));

    line.forEach(seg => {
      const isNow = live && t >= seg.s && t < seg.e;
      if (seg.gap) {
        const g = el('div', 'mbs-tt__gap' + (seg.gap === 'Lunch' ? ' is-lunch' : '') + (isNow ? ' is-now' : ''));
        g.append(el('span', 't', ttHHMM(seg.s)),
                 el('span', null, seg.gap + ' \u2014 ' + (seg.e - seg.s) + ' min'));
        if (isNow) ttMarker(g, seg, t);
        list.append(g);
        return;
      }
      seg.slot.items.forEach((l, i) => {
        const r = el('div', 'mbs-tt__row' + (i ? ' is-alt' : '') +
                     (live && t >= seg.e ? ' is-done' : '') +
                     (isNow && seg.slot.items.length === 1 ? ' is-now' : ''));
        if (isNow && seg.slot.items.length === 1) ttMarker(r, l, t);
        const tm = el('span', 't');
        if (i) tm.append(document.createTextNode('or'));
        else { tm.append(document.createTextNode(l.start)); tm.append(el('i', null, '(' + (l.e - l.s) + ' min)')); }
        r.append(tm);
        const sub = el('span', 's');
        sub.append(el('span', 'n', ttName(l.subject)));
        const w = ttWhere(l); if (w) sub.append(el('span', 'r', w));
        r.append(sub);
        list.append(r);
      });
    });

    /* A rebuild drops the scroll box, and the place you had scrolled to goes
       with it — without this, the refresh that follows a period rolling over
       would throw a scrolled day back to the top. */
    const foot = el('div', 'mbs-tt__foot');
    const src = el('a', null, 'Prime Timetable \u2197');
    src.href = TT_SOURCE;
    src.target = '_blank';
    src.rel = 'noopener noreferrer';
    foot.append(el('span', null, 'Source'), src);

    const keep = dockList && dockList.isConnected ? dockList.scrollTop : 0;
    const kids = [head, ruler, ttNowBar(), list, foot];
    // the aquarium is decoration: if it fails, the timetable still draws
    try { kids.unshift(ttClock()); } catch (err) { console.warn('[MBS]', err); }
    dock.replaceChildren(...kids);
    dockList = list;
    if (focus) ttFocus(list, live);
    else list.scrollTop = keep;
  }

  /* A new page, a reopened dock or a newly picked day lands on what's on now
     (or, before it starts, what's next) a little way down from the top, with
     the block before it still in view. A period rolling over keeps wherever
     the list had been scrolled to, so it never yanks the list from under you. */
  function ttFocus(list, live) {
    const at = live && (list.querySelector('.is-now') || list.querySelector('.mbs-tt__row:not(.is-done)'));
    list.scrollTop = at ? Math.max(0, at.offsetTop - list.offsetTop - list.clientHeight * .25) : 0;
  }

  /* The water fills in from empty the first time the corner is drawn on a
     page; after that (a period rolling over rebuilds the dock) it is simply
     set, so it doesn't drain and refill every 45 minutes. */
  let ttWaterShown = false;
  function ttClock() {
    const c = el('div', 'mbs-tt__clock');
    const cv = el('canvas', 'mbs-aq');
    cv.setAttribute('aria-hidden', 'true');
    const ink = () => {
      const k = el('div', 'mbs-aq__ink');
      const pc = el('span', 'pc');
      pc.append(el('b'), el('i', null, 'of the day'));
      k.append(el('span', 'dt'), el('span', 'tm'), pc);
      return k;
    };
    const dark = ink();
    const inkCv = el('canvas', 'mbs-aq-ink');
    inkCv.setAttribute('aria-hidden', 'true');
    c.append(cv, dark, inkCv);
    c._aq = {
      cv, ctx: cv.getContext('2d'), inkCv, inkCtx: inkCv.getContext('2d'), dark, layout: null,
      colours: aqColours(), kidPal: kidPalette(), last: 0,
      phases: AQ_LAYERS.map(L => L.waves.map(() => Math.random() * 6.2832)),
      swells: [], level: 0, target: 0, running: false
    };
    const first = !ttWaterShown;
    ttClockSet(c, first);
    ttWaterShown = true;
    c._aq.level = first && !REDUCED_MOTION.matches ? 0 : c._aq.target;
    // measured and drawn once it's in the page
    requestAnimationFrame(() => aqRun(c));
    return c;
  }
  function ttClockSet(c, fillIn) {
    const d = new Date();
    const mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const frac = mins / 1440;
    const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    c.querySelectorAll('.dt').forEach(e => { e.textContent = date; });
    c.querySelectorAll('.tm').forEach(e => { e.textContent = ttHHMM(Math.floor(mins)); });
    c.querySelectorAll('.pc b').forEach(e => { e.textContent = Math.floor(frac * 100) + '%'; });
    // the words moved or changed: measure them again on the next frame
    if (c._aq) { c._aq.target = frac; c._aq.layout = null; }
  }

  /* ---------- the aquarium's water ----------
     Drawn on a canvas rather than tiled: each of three layers is a sum of
     sines at unrelated wavelengths, speeds and directions, so the surface
     flows without ever visibly repeating. A swell is a real disturbance that
     travels through all three — a sech² solitary wave with a smaller trough
     and crest ringing behind it, growing in and dying away as it crosses —
     reaching the back layers a beat after the front. The loop runs only while
     the dock is out and the tab is showing (requestAnimationFrame stops with
     it), and a reduced-motion setting gets a still picture instead.
     Each wave is [amplitude px, wavelength px, speed rad/s]. */
  const AQ_STEP = 3;
  const AQ_LAYERS = [
    { key: 'back',  lift: 4, lag: .22, waves: [[1.9, 173, -.62], [1.0, 71, .95], [.45, 29, -1.8]] },
    { key: 'mid',   lift: 2, lag: .11, waves: [[1.5, 137, .78], [.8, 53, -1.2], [.35, 23, 2.1]] },
    { key: 'front', lift: 0, lag: 0,   waves: [[1.2, 211, -.9], [.7, 83, 1.4], [.3, 31, -2.6]] }
  ];
  const AQ_SWELL = {
    big:   { T: 3.4, A: 10,  sigma: 34 },
    small: { T: 2.6, A: 4.5, sigma: 24 }
  };

  function aqColours() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return {
      back: v('--aq-back', 'rgba(100,210,255,.38)'), mid: v('--aq-mid', 'rgba(10,132,255,.5)'),
      top: v('--aq-top', 'rgba(0,113,227,.9)'), bottom: v('--aq-bottom', 'rgba(0,62,158,.97)'),
      hi: v('--aq-hi', 'rgba(255,255,255,.65)'),
      light: v('--aq-light', '#FFFFFF'), light2: v('--aq-light2', 'rgba(255,255,255,.8)'),
      sand: v('--aq-sand', '#E6D2A3'), sand2: v('--aq-sand2', '#CDB27C')
    };
  }

  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(() => {
      const c = dock && dock.querySelector('.mbs-tt__clock');
      if (c && c._aq) c._aq.layout = null;
    });

  const aqSech2 = u => { const k = Math.cosh(u); return 1 / (k * k); };
  function aqSwellAt(s, x, t, w) {
    const p = (t - s.t0) / s.T;
    if (p <= 0 || p >= 1) return 0;
    const xc = -3 * s.sigma + p * (w + 6 * s.sigma);
    const u = (x - xc) / s.sigma;
    return s.A * Math.pow(Math.sin(Math.PI * p), 1.3) *
      (aqSech2(u) - .32 * aqSech2((u + 2.3) / .85) + .14 * aqSech2((u + 4.4) / .8));
  }

  function aqRun(c) {
    const aq = c._aq;
    if (!aq || aq.running || !c.isConnected) return;
    if (REDUCED_MOTION.matches) { aq.level = aq.target; aqDraw(c, 0); return; }
    aq.running = true;
    let last = performance.now();
    const frame = now => {
      if (!c.isConnected || !dock || dock.hidden) { aq.running = false; return; }
      const dt = Math.min(.1, (now - last) / 1000);
      last = now;
      aq.level += (aq.target - aq.level) * Math.min(1, dt * 2.2);
      aqDraw(c, now / 1000);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function aqDraw(c, t) {
    const aq = c._aq, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (aq.cv.width !== W || aq.cv.height !== H) { aq.cv.width = W; aq.cv.height = H; }
    const ctx = aq.ctx, col = aq.colours;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const base = h * (1 - aq.level);
    const dt = aq.last ? Math.min(.1, Math.max(0, t - aq.last)) : 0;
    aq.last = t;
    aq.swells = aq.swells.filter(s => t - s.t0 < s.T + 1);
    // the diver is decoration: if he fails, the water still draws
    let kid = null;
    try { kid = kidStep(aq, t, dt, w, h, base); } catch (err) { console.warn('[MBS]', err); }
    const sand = alpha => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col.sand;
      ctx.fillRect(0, h - 2, w, 2);
      ctx.fillStyle = col.sand2;
      for (let x = 3; x < w; x += 11) ctx.fillRect(x, h - 1, 1, 1);
      ctx.globalAlpha = 1;
    };
    sand(1);
    let front = null, frontPaint = null;
    AQ_LAYERS.forEach((L, li) => {
      const ys = [];
      for (let x = 0; x <= w + AQ_STEP; x += AQ_STEP) {
        let y = base - L.lift;
        L.waves.forEach(([a, lam, om], i) => { y += a * Math.sin(x / lam * 6.2832 + om * t + aq.phases[li][i]); });
        for (const s of aq.swells) y -= aqSwellAt(s, x, t - L.lag, w);
        ys.push(y);
      }
      ctx.beginPath();
      ctx.moveTo(0, h);
      ys.forEach((y, i) => ctx.lineTo(i * AQ_STEP, y));
      ctx.lineTo(w + AQ_STEP, h);
      ctx.closePath();
      if (L.key === 'front') {
        const g = ctx.createLinearGradient(0, base - 8, 0, h);
        g.addColorStop(0, col.top);
        g.addColorStop(1, col.bottom);
        ctx.fillStyle = g;
        front = ys;
        frontPaint = g;
      } else ctx.fillStyle = col[L.key];
      ctx.fill();
    });
    // a glassy line along the front surface
    ctx.beginPath();
    front.forEach((y, i) => (i ? ctx.lineTo(i * AQ_STEP, y + .5) : ctx.moveTo(0, y + .5)));
    ctx.strokeStyle = col.hi;
    ctx.lineWidth = 1;
    ctx.stroke();
    sand(.35);
    if (kid) {
      kidDraw(ctx, aq, kid, h);
      // wading: a wash of the water over whatever of him is below the
      // surface, so his legs read as in it without vanishing
      if (kid.land) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(kid.box[0] - 2, kid.box[1] - 2, kid.box[2] + 4, kid.box[3] + 4);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(0, h);
        front.forEach((y, i) => ctx.lineTo(i * AQ_STEP, y));
        ctx.lineTo(w + AQ_STEP, h);
        ctx.closePath();
        ctx.globalAlpha = .42;
        ctx.fillStyle = frontPaint;
        ctx.fill();
        ctx.restore();
      }
    }
    aqInk(c, front, w, h, dpr, W, H);
  }

  /* The words, twice: in their own colours clipped to above the front
     surface, then in white (with a faint shadow, for when a fish passes
     behind) clipped to below it. Positions, fonts, tracking and colours are
     read off the invisible text, so the stylesheet still sets the type. */
  function aqInk(c, front, w, h, dpr, W, H) {
    const aq = c._aq, cv = aq.inkCv, ctx = aq.inkCtx, col = aq.colours;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (!aq.layout || aq.layoutW !== w) { aq.layout = aqLayout(c); aq.layoutW = w; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const surface = (from) => {
      ctx.beginPath();
      if (from === 'top') {
        ctx.moveTo(0, 0);
        ctx.lineTo(w + AQ_STEP, 0);
        for (let i = front.length - 1; i >= 0; i--) ctx.lineTo(i * AQ_STEP, front[i]);
      } else {
        ctx.moveTo(0, h);
        front.forEach((y, i) => ctx.lineTo(i * AQ_STEP, y));
        ctx.lineTo(w + AQ_STEP, h);
      }
      ctx.closePath();
      ctx.clip();
    };
    ctx.save();
    surface('top');
    aq.layout.forEach(t => aqText(ctx, t, t.colour));
    ctx.restore();
    ctx.save();
    surface('bottom');
    ctx.shadowColor = 'rgba(0,0,0,.28)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = .5;
    aq.layout.forEach(t => aqText(ctx, t, t.secondary ? col.light2 : col.light));
    ctx.restore();
  }

  function aqLayout(c) {
    const box = c.getBoundingClientRect();
    return [...c._aq.dark.querySelectorAll('.dt, .tm, .pc b, .pc i')].map(e => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      const right = e.matches('.pc b, .pc i');
      return {
        text: cs.textTransform === 'uppercase' ? e.textContent.toUpperCase() : e.textContent,
        right, secondary: e.matches('.dt, .pc i'),
        x: (right ? r.right : r.left) - box.left, y: r.top - box.top + r.height / 2,
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
        track: parseFloat(cs.letterSpacing) || 0, colour: cs.color
      };
    });
  }

  // tracking by hand, letter by letter, where the canvas can't do it itself
  function aqText(ctx, t, colour) {
    ctx.font = t.font;
    ctx.fillStyle = colour;
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = t.track + 'px';
      ctx.textAlign = t.right ? 'right' : 'left';
      ctx.fillText(t.text, t.x, t.y);
      return;
    }
    const chars = [...t.text];
    const widths = chars.map(ch => ctx.measureText(ch).width);
    let x = t.right ? t.x - widths.reduce((a, b) => a + b, 0) - t.track * chars.length : t.x;
    ctx.textAlign = 'left';
    chars.forEach((ch, i) => { ctx.fillText(ch, x, t.y); x += widths[i] + t.track; });
  }

  function ttColours(name, keys, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const list = v ? v.split(/\s+/) : fallback;
    return Object.fromEntries([...keys].map((k, i) => [k, list[i]]));
  }
  /* ---------- the diver ----------
     One little figure, built from parts rather than drawn frame by frame, so
     he can take any pose: a 16×16 grid of art pixels (two screen pixels each)
     with his head, mask, tank, torso, arms, legs and fins placed from a pose,
     then turned (lying down, swimming face down, somersaulting) and mirrored
     to face either way. Coordinates are in that grid with him standing,
     facing right. Palette keys: K suit, k suit shade, Y tank, y tank shade,
     F fin, f fin tip, S skin, M mask glass, R regulator, B book cover,
     P page, L page text, and the props' own colours below. */
  const KID_N = 16, KID_S = 2;
  // feet [back x, y, front x, y]; knees optional per leg; hands [back x, y, front x, y]
  const KID_POSES = {
    stand:  { feet: [5, 14, 7, 14], hands: [5, 10, 9, 9] },
    walkA:  { feet: [3, 14, 9, 14], hands: [9, 9, 4, 10] },
    walkB:  { feet: [5, 14, 7, 14], hands: [6, 10, 8, 10] },
    runA:   { feet: [2, 13, 10, 13], hands: [10, 6, 3, 9] },
    runB:   { feet: [5, 14, 9, 13], knees: [null, [9, 11]], hands: [4, 9, 10, 7] },
    sit:    { dy: 3, feet: [10, 14, 11, 14], knees: [[9, 11], [10, 11]], hands: [7, 12, 10, 11] },
    kneel:  { dy: 2, feet: [3, 15, 9, 14], knees: [[6, 15], [9, 11]], hands: [6, 11, 12, 12] },
    jackOut:{ feet: [2, 14, 10, 14], hands: [2, 1, 11, 1] },
    jackIn: { feet: [5, 14, 7, 14], hands: [4, 11, 8, 11] },
    waveA:  { feet: [5, 14, 7, 14], hands: [5, 10, 10, 1] },
    waveB:  { feet: [5, 14, 7, 14], hands: [5, 10, 11, 3] },
    hoverA: { feet: [4, 14, 7, 13], hands: [5, 9, 9, 8] },
    hoverB: { feet: [5, 13, 6, 14], hands: [5, 9, 9, 8] },
    lie:    { feet: [5, 14, 7, 14], hands: [6, 9, 7, 9] }
  };
  // things he holds: where his front hand goes (absolute), and the art from (hand + at)
  const KID_ITEMS = {
    book:     { hand: [10, 9], at: [-1, -4], art: ['.PP.PP.', 'PLPBPLP', 'PPPBPPP', 'PLPBPLP', 'BBBBBBB'] },
    bookFlip: { hand: [10, 9], at: [-1, -4], art: ['.PP.P..', 'PLPBPP.', 'PPPBPP.', 'PLPBP..', 'BBBBBBB'] },
    cupUp:    { hand: [10, 8], at: [0, -2], art: ['cc', 'CC', 'CC'], mark: ['cup', 0, -2], noReg: true },
    cupDown:  { hand: [11, 11], at: [0, -2], art: ['cc', 'CC', 'CC'], mark: ['cup', 0, -3] },
    camera:   { hand: [9, 4], at: [0, -2], art: ['.DD', 'DDE', 'DDD'], mark: ['lens', 3, -1], noReg: true },
    laptop:   { hand: [9, 12], at: [-1, -4], art: ['....ED', '....ED', '....ED', '.....D', 'AAAAAA'] }
  };

  function kidBuild(pose, item) {
    const P = KID_POSES[pose], dy = P.dy || 0, g = [], marks = {};
    for (let i = 0; i < KID_N; i++) g.push(new Array(KID_N).fill(null));
    const put = (x, y, ch) => { if (x >= 0 && y >= 0 && x < KID_N && y < KID_N) g[y][x] = ch; };
    const line = (x0, y0, x1, y1, ch, thick) => {
      const ax = Math.abs(x1 - x0), ay = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = ax - ay, x = x0, y = y0;
      for (;;) {
        put(x, y, ch);
        if (thick) { if (ax > ay) put(x, y + 1, ch); else put(x + 1, y, ch); }
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -ay) { err -= ay; x += sx; }
        if (e2 < ax) { err += ax; y += sy; }
      }
    };
    const art = (x, y, rows) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') put(x + i, y + j, ch); }));
    const hold = item && KID_ITEMS[item];
    let [bhx, bhy, fhx, fhy] = P.hands;
    if (hold) [fhx, fhy] = hold.hand;
    const [bfx, bfy, ffx, ffy] = P.feet, knees = P.knees || [];
    const leg = (hx, fx, fy, knee, ch) => {
      const hy = 11 + dy;
      if (knee) { line(hx, hy, knee[0], knee[1], ch, true); line(knee[0], knee[1], fx, fy, ch, true); }
      else line(hx, hy, fx, fy, ch, true);
      const fin = Math.min(KID_N - 1, fy + 1);
      for (let i = 0; i < 4; i++) put(fx + i, fin, i === 3 ? 'f' : 'F');
    };
    // behind: back leg, back arm
    leg(5, bfx, bfy, knees[0], 'k');
    line(5, 6 + dy, bhx, bhy, 'k');
    put(bhx, bhy, 'S');
    // tank
    for (let y = 6; y <= 10; y++) { put(2, y + dy, 'y'); put(3, y + dy, 'Y'); }
    put(3, 5 + dy, 'y');
    // torso, with the belt
    for (let y = 6; y <= 10; y++) for (let x = 4; x <= 8; x++) put(x, y + dy, y === 10 || x === 4 ? 'k' : 'K');
    // head: hood, mask glass, face, regulator
    art(4, dy, ['.KKKK.', 'KKKKKK', 'KKKMMK', 'KKKMMK', 'KKSSSR', '.KKK..']);
    marks.head = [6, dy];
    if (!(hold && hold.noReg)) marks.reg = [9, 4 + dy];
    // in front: front leg, front arm, then whatever he's holding
    leg(7, ffx, ffy, knees[1], 'K');
    line(7, 6 + dy, fhx, fhy, 'K');
    put(fhx, fhy, 'S');
    if (hold) {
      art(fhx + hold.at[0], fhy + hold.at[1], hold.art);
      if (hold.mark) marks[hold.mark[0]] = [fhx + hold.mark[1], fhy + hold.mark[2]];
    }
    marks.hand = [fhx, fhy];
    return { g, marks };
  }

  // turn the grid a quarter at a time (clockwise), then mirror it to face left
  function kidTurn(fig, rot, flip) {
    const N = KID_N, g = [];
    for (let i = 0; i < N; i++) g.push(new Array(N).fill(null));
    const map = (x, y) => {
      for (let r = 0; r < rot; r++) [x, y] = [N - 1 - y, x];
      return [flip ? N - 1 - x : x, y];
    };
    let x0 = N, x1 = -1, y0 = N, y1 = -1;
    fig.g.forEach((row, y) => row.forEach((ch, x) => {
      if (!ch) return;
      const [X, Y] = map(x, y);
      g[Y][X] = ch;
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }));
    const marks = {};
    for (const k in fig.marks) marks[k] = map(...fig.marks[k]);
    return { g, marks, x0, x1, y0, y1 };
  }

  /* What he gets up to. Land activities are for dry sand or water no deeper
     than his chest; the rest need the water at least `deep` screen pixels
     deep. Each runs for a while (seconds, a random length within `dur`),
     then he picks something else that suits the water — never the same
     thing twice running. */
  const KID_WADE = 28;
  const KID_ACTS = [
    { id: 'walk',   land: true, dur: [7, 13], speed: 13 },
    { id: 'jog',    land: true, dur: [5, 9],  speed: 32 },
    { id: 'drink',  land: true, dur: [8, 12] },
    { id: 'read',   land: true, dur: [10, 16] },
    { id: 'nap',    land: true, dur: [8, 13] },
    { id: 'jacks',  land: true, dur: [4, 7] },
    { id: 'wave',   land: true, dur: [3, 5] },
    { id: 'laptop', land: true, dur: [9, 14] },
    { id: 'swim',   deep: 28, dur: [8, 14], speed: 22 },
    { id: 'float',  deep: 28, dur: [8, 12] },
    { id: 'chest',  deep: 34, dur: [7, 10] },
    { id: 'flip',   deep: 36, dur: [3.5, 5] },
    { id: 'photo',  deep: 38, dur: [6, 9] },
    { id: 'study',  deep: 38, dur: [10, 15] },
    { id: 'hello',  deep: 38, dur: [3, 5] }
  ];
  const KID_PROPS = { C: '#FFFFFF', c: '#8B5A2B', D: '#2C2C2E', E: '#64D2FF', A: '#D1D1D6',
                      T: '#B0703A', t: '#7A4A22', G: '#FFD60A', W: '#FFFFFF' };
  const KID_CHEST = [
    ['.tttttt.', 'tTTTTTTt', 'tGGGGGGt', 'tTTGGTTt', 'tTTTTTTt', 'tttttttt'],
    ['tttttttt', '.tTTTTt.', 'GWGGGWGG', 'tGGGGGGt', 'tTTTTTTt', 'tttttttt']
  ];
  const KID_BUBBLE = ['.rrr.', 'r.igr', 'ri..r', 'ri..r', '.rrr.'];
  const KID_Z = ['ZZZZ', '..Z.', '.Z..', 'ZZZZ'];

  function kidPalette() {
    return Object.assign(ttColours('--diver', 'KkYyFfSMRBPL',
      ['#1D1D1F', '#48484A', '#FFD60A', '#E0B400', '#FF9F0A', '#D97800',
       '#F5C6A5', '#9EE7FF', '#8E8E93', '#FF453A', '#FFFFFF', '#C7C7CC']), KID_PROPS);
  }

  function kidPick(k, t, fits) {
    const ok = KID_ACTS.filter(fits);
    const pool = ok.filter(a => a !== k.act);
    const list = pool.length ? pool : ok;
    k.act = list[Math.floor(Math.random() * list.length)];
    k.t0 = t;
    k.until = t + k.act.dur[0] + Math.random() * (k.act.dur[1] - k.act.dur[0]);
    if (!k.act.speed && Math.random() < .5) k.face *= -1;
    k.chest = null;
  }

  /* One step of his life: choose the activity, move, pose, and place him.
     Returns where to draw him and whether he's out of the water (then the
     front wave is drawn over him, so he wades) or diving (drawn in front). */
  function kidStep(aq, t, dt, w, h, surface) {
    const k = aq.kid || (aq.kid = { x: w * .55, face: 1, act: null, until: 0, t0: 0,
                                     breath: t + 1, puffs: [], zs: [], steam: [], sparks: [], tz: 0, ts: 0 });
    const depth = h - surface, land = depth <= KID_WADE;
    const fits = a => land ? !!a.land : !a.land && depth >= a.deep;
    if (!k.act || t >= k.until || !fits(k.act)) kidPick(k, t, fits);
    const a = k.act, e = t - k.t0, beat = n => Math.floor(e / n) % 2 === 0;
    let pose = 'stand', item = null, rot = 0, at = 'ground', bob = 0;
    switch (a.id) {
      case 'walk':   pose = beat(.22) ? 'walkA' : 'walkB'; break;
      case 'jog':    pose = beat(.14) ? 'runA' : 'runB'; bob = beat(.14) ? -2 : 0; break;
      case 'drink':  pose = 'sit'; item = e % 3.4 < 1.3 ? 'cupUp' : 'cupDown'; break;
      case 'read':   pose = 'sit'; item = e % 5 > 4.4 ? 'bookFlip' : 'book'; break;
      case 'nap':    pose = 'lie'; rot = 3; break;
      case 'jacks':  pose = beat(.3) ? 'jackOut' : 'jackIn'; bob = beat(.3) ? -2 : 0; break;
      case 'wave':   pose = beat(.25) ? 'waveA' : 'waveB'; break;
      case 'laptop': pose = 'sit'; item = 'laptop'; break;
      case 'swim':   pose = beat(.3) ? 'hoverA' : 'hoverB'; rot = 1; at = 'water'; bob = Math.sin(t * 2) * 1.5; break;
      case 'float':  pose = 'lie'; rot = 3; at = 'water'; bob = Math.sin(t * 1.3) * 2; break;
      case 'chest':  pose = 'kneel'; break;
      case 'flip': {
        const ph = e % 2.6;
        pose = 'hoverA'; at = 'water'; rot = ph < 1.6 ? Math.floor(ph * 5) % 4 : 0;
        break;
      }
      case 'photo':  pose = beat(.4) ? 'hoverA' : 'hoverB'; item = 'camera'; at = 'water'; bob = Math.sin(t * 1.6); break;
      case 'study':  pose = beat(.5) ? 'hoverA' : 'hoverB'; item = e % 5 > 4.4 ? 'bookFlip' : 'book'; at = 'water'; bob = Math.sin(t * 1.4); break;
      case 'hello':  pose = beat(.25) ? 'waveA' : 'waveB'; at = 'water'; bob = Math.sin(t * 1.6); break;
    }
    if (a.speed) {
      k.x += k.face * a.speed * dt;
      if (k.x < 18) { k.x = 18; k.face = 1; } else if (k.x > w - 18) { k.x = w - 18; k.face = -1; }
    }
    const fig = kidTurn(kidBuild(pose, item), rot, k.face < 0);
    const S = KID_S, fw = (fig.x1 - fig.x0 + 1) * S, fh = (fig.y1 - fig.y0 + 1) * S;
    let left = Math.round(k.x - fw / 2), top;
    if (at === 'water') {
      top = surface + depth * .55 - fh / 2 + bob;
      top = Math.max(surface + 3, Math.min(h - 2 - fh, top));
    } else top = h - 2 - fh + bob;
    top = Math.round(top);
    const ox = left - fig.x0 * S, oy = top - fig.y0 * S;
    const pt = name => fig.marks[name] && [ox + (fig.marks[name][0] + .5) * S, oy + (fig.marks[name][1] + .5) * S];

    // the treasure chest sits just ahead of him on the bottom
    if (a.id === 'chest') {
      if (k.chest == null) k.chest = Math.max(4, Math.min(w - 20, k.x + k.face * 18 - 8));
    }
    // effects: breath, z's, steam, sparkles — spawned here, moved below
    const reg = pt('reg');
    if (!land && reg && reg[1] > surface + 4 && t >= k.breath) {
      const n = Math.random() < .4 ? 3 : 2;
      for (let i = 0; i < n; i++)
        k.puffs.push({ x: reg[0], y: reg[1] + i * 5, ph: Math.random() * 6, px: Math.random() < .35 ? 2 : 1, at: t + i * .22 });
      k.breath = t + 2.4 + Math.random() * 1.6;
    }
    if ((a.id === 'nap' || a.id === 'float') && t >= k.tz) {
      const hd = pt('head');
      if (hd) k.zs.push({ x: hd[0], y: hd[1] - 6, at: t });
      k.tz = t + 1.3;
    }
    if (item === 'cupDown' && t >= k.ts) {
      const cp = pt('cup');
      if (cp) k.steam.push({ x: cp[0] + (Math.random() < .5 ? -1 : 1), y: cp[1], at: t });
      k.ts = t + .28;
    }
    if (a.id === 'chest' && e > 1.6 && Math.random() < dt * 6)
      k.sparks.push({ x: k.chest + 2 + Math.random() * 12, y: h - 14 - Math.random() * 10, at: t });
    k.puffs = k.puffs.filter(b => {
      if (t < b.at) return true;
      b.y -= 17 * dt;
      return b.y > surface + 3;
    });
    k.zs = k.zs.filter(z => t - z.at < 2.6);
    k.steam = k.steam.filter(s => t - s.at < 1.4);
    k.sparks = k.sparks.filter(s => t - s.at < .6);

    return { fig, ox, oy, land, surface, box: [left, top, fw, fh], flash: a.id === 'photo' && e % 1.9 < .12 ? pt('lens') : null,
             chest: a.id === 'chest' ? { x: k.chest, open: e > 1.6 } : null, t };
  }

  function kidPixels(ctx, x, y, rows, colour, s) {
    rows.forEach((r, j) => [...r].forEach((ch, i) => {
      if (ch === '.') return;
      ctx.fillStyle = typeof colour === 'function' ? colour(ch) : colour;
      ctx.fillRect(Math.round(x) + i * s, Math.round(y) + j * s, s, s);
    }));
  }

  function kidDraw(ctx, aq, info, h) {
    const k = aq.kid, pal = aq.kidPal, S = KID_S, t = info.t;
    if (info.chest) kidPixels(ctx, info.chest.x, h - 2 - 12, KID_CHEST[info.chest.open ? 1 : 0], ch => pal[ch], S);
    // him, row by row, one rect per run of a colour
    info.fig.g.forEach((row, y) => {
      for (let x = 0; x < KID_N;) {
        const ch = row[x];
        if (!ch) { x++; continue; }
        let end = x;
        while (end + 1 < KID_N && row[end + 1] === ch) end++;
        ctx.fillStyle = pal[ch];
        ctx.fillRect(info.ox + x * S, info.oy + y * S, (end - x + 1) * S, S);
        x = end + 1;
      }
    });
    if (info.flash) {
      const [fx, fy] = info.flash;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      kidPixels(ctx, fx - 4, fy - 4, ['..W..', '.W.W.', 'W.W.W', '.W.W.', '..W..'], '#FFFFFF', 2);
    }
    for (const s of k.sparks) {
      ctx.fillStyle = (t - s.at) < .3 ? '#FFFFFF' : pal.G;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
    }
    for (const s of k.steam) {
      const age = t - s.at;
      ctx.fillStyle = `rgba(200,200,205,${(1 - age / 1.4).toFixed(2)})`;
      ctx.fillRect(Math.round(s.x + Math.sin(age * 6) * 1.5), Math.round(s.y - age * 9), 2, 2);
    }
    for (const z of k.zs) {
      const age = t - z.at, y = z.y - age * 7;
      ctx.globalAlpha = Math.max(0, 1 - age / 2.6);
      kidPixels(ctx, z.x + age * 4, y, KID_Z, y > info.surface ? '#FFFFFF' : '#8E8E93', 1 + (age > 1 ? 1 : 0));
      ctx.globalAlpha = 1;
    }
    for (const b of k.puffs) {
      if (t < b.at) continue;
      const x = b.x + Math.round(Math.sin((t - b.at) * 5 + b.ph) * 1.5) - 2.5 * b.px;
      kidPixels(ctx, x, b.y - 2.5 * b.px, KID_BUBBLE,
        ch => ch === 'r' ? 'rgba(255,255,255,.95)' : ch === 'i' ? 'rgba(255,255,255,.3)' : '#FFFFFF', b.px);
    }
  }


  /* Swells keep to the clock: a big one on each minute, a small one on each
     half. The timer re-aims at the next :00 or :30 every time rather than
     repeating every 30s, so it can't drift off the second hand. */
  let ttWaveTimer = 0;
  function ttWaveSchedule() {
    clearTimeout(ttWaveTimer);
    const now = new Date();
    const wait = 30000 - ((now.getSeconds() % 30) * 1000 + now.getMilliseconds());
    ttWaveTimer = setTimeout(() => {
      const d = new Date(), sec = d.getSeconds() + d.getMilliseconds() / 1000;
      ttSwell(Math.round(sec / 30) % 2 === 0 ? 'big' : 'small');
      ttWaveSchedule();
    }, wait);
  }

  function ttSwell(kind) {
    const clock = dock && dock.isConnected && !dock.hidden && dock.querySelector('.mbs-tt__clock');
    if (!clock || !clock._aq || document.visibilityState !== 'visible' || REDUCED_MOTION.matches) return;
    clock._aq.swells.push(Object.assign({ t0: performance.now() / 1000 }, AQ_SWELL[kind]));
  }
  ttWaveSchedule();

  function ttNowBar() {
    const box = el('div', 'mbs-tt__now');
    const col = ttToday(), half = ttWeek(new Date()), t = ttNow();
    const day = col < 0 ? [] : TT.filter(l => l.d === half * 5 + col).sort((a, b) => a.s - b.s);
    const cur = day.filter(l => t >= l.s && t < l.e);
    const next = day.filter(l => l.s > t);
    const at = next.length ? next[0].s : null;

    const k = el('div', 'k'), v = el('div', 'v'), m = el('div', 'm');
    if (col < 0) { k.textContent = 'Right now'; v.textContent = 'Weekend'; m.append(el('span', null, 'Back Monday 08:10')); }
    else if (cur.length) {
      k.textContent = 'Now';
      v.textContent = cur.map(c => ttName(c.subject)).join('  or  ');
      m.append(el('span', null, cur[0].start + '\u2013' + cur[0].end),
               el('span', null, ttWhere(cur[0]) || 'room TBC'),
               ttCountdown(cur[0].e, ' min left'));
    } else if (at != null) {
      k.textContent = 'Now'; v.textContent = t < ttMin('08:10') ? 'Before school' : 'Free';
      m.append(el('span', null, 'Until ' + ttHHMM(at)), ttCountdown(at, ' min'));
    } else {
      k.textContent = 'Now'; v.textContent = 'Done for the day';
      m.append(el('span', null, TT_DAYS[col] + ' \u00b7 Week ' + (half + 1)));
    }
    box.append(k, v, m);

    if (next.length) {
      const n = next.filter(l => l.s === at);
      const row = el('div', 'mbs-tt__nx');
      row.append(el('span', 'k', 'Next'),
                 el('span', 'n', n.map(c => ttName(c.subject)).join('  or  ')),
                 el('span', 't', n[0].start + '  ' + (ttWhere(n[0]) || '\u2014')));
      box.append(row);
    }
    return box;
  }

  /* While the panel is open the marker creeps and the countdowns fall. A full
     re-render would restart the stroke, so only the width and the numbers
     move; the panel is rebuilt just when a period actually rolls over. */
  let ttLastKey = null;
  function ttTick() {
    if (!dockOpen || !dock || dock.hidden || !dock.isConnected) return;
    const col = ttToday();
    const key = col < 0 ? null : (() => {
      const t = ttNow(), seg = ttLine(ttWeek(new Date()), col).find(x => t >= x.s && t < x.e);
      return seg ? seg.s : null;
    })();
    if (key !== ttLastKey) { ttLastKey = key; renderTimetable(); return; }
    const t = ttNow();
    const row = dock.querySelector('.is-now');
    const sw = row && row._seg && row.querySelector('.mbs-tt__swipe');
    if (sw) sw.style.width = ttWidth(row._seg, t);
    dock.querySelectorAll('.mbs-tt__cd').forEach(c => {
      c.textContent = Math.ceil(+c.dataset.end - t) + c.dataset.unit;
    });
    const clock = dock.querySelector('.mbs-tt__clock');
    if (clock && clock._aq) {
      ttClockSet(clock);
      if (REDUCED_MOTION.matches) { clock._aq.level = clock._aq.target; aqDraw(clock, 0); }
      else aqRun(clock);   // restarts the loop if it had stopped
    }
  }
  setInterval(ttTick, 5000);
  // a background tab's timers are throttled, so catch up the moment it's back
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ttTick(); });

  /* ============================================================
     RUN
     ============================================================ */

  /* Drop the right-hand column when Guides was all it held, so the content
     gets that width back. Decided here rather than in CSS because it depends
     on which panels the page actually has — anything that isn't Guides
     counts as worth keeping, so panels I haven't seen still survive. */
  /* ============================================================
     INLINE TASK DETAILS
     ============================================================ */

  /* Opening a task to read one line of description costs a page load and
     your place in the list. Instead the task page is fetched in the
     background and its description opened underneath the row, so the list
     stays put. Anything interactive — submitting, discussions — still needs
     the real page, so every panel carries a link to it. */
  const taskDetailCache = new Map();

  async function loadTaskDetail(href) {
    if (!taskDetailCache.has(href)) {
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const wrap = document.createElement('div');

      const desc = doc.querySelector('.core-task-details');
      if (desc) wrap.append(desc.cloneNode(true));

      const dropbox = doc.querySelector('.core-task-show .mb-6');
      const status = dropbox ? dropbox.textContent.replace(/\s+/g, ' ').trim() : '';
      if (status) {
        const d = el('div', 'mbs-task-detail__status', status.slice(0, 140));
        wrap.append(d);
      }
      if (!wrap.childNodes.length) wrap.append(el('div', 'mbs-task-detail__status', 'This task has no description.'));

      // fetched markup is same-origin, but nothing here needs to run or submit
      wrap.querySelectorAll('script, iframe, style, form, noscript').forEach(n => n.remove());
      // keep the cache bounded over a long session
      if (taskDetailCache.size >= 24) taskDetailCache.delete(taskDetailCache.keys().next().value);
      taskDetailCache.set(href, wrap);
    }
    return cachedDetail(href);
  }

  /* Synchronous read, so a cached task can be built before the panel is
     inserted: it then animates once, straight to its final height, instead
     of opening small and jerking taller when the fetch lands. */
  function cachedDetail(href) {
    // the parsed node is kept and cloned; re-serialising it to HTML and
    // parsing it back on every open was doing the DOMParser's work twice
    const wrap = taskDetailCache.get(href);
    return wrap ? wrap.cloneNode(true) : null;
  }

  /* Height is animated explicitly rather than via a CSS transition: the
     panel's height isn't known ahead of time, and it changes twice — once
     when the row opens, again when the fetched description replaces the
     loading line. Both are measured and tweened, then height is cleared so
     the panel goes back to sizing itself. */
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
  const EASE = 'cubic-bezier(.4, 0, .2, 1)';

  function tween(panel, fromHeight, toHeight, fromOpacity, toOpacity, done) {
    panel.style.overflow = 'hidden';
    const anim = panel.animate(
      [{ height: fromHeight + 'px', opacity: fromOpacity },
       { height: toHeight + 'px',   opacity: toOpacity }],
      { duration: 190, easing: EASE }
    );
    anim.onfinish = anim.oncancel = () => {
      panel.style.overflow = '';
      panel.style.height = '';
      panel.style.opacity = '';
      if (done) done();
    };
  }

  function revealPanel(panel, tile) {
    panel.hidden = false;
    tile.classList.add('mbs-tile-open');
    if (REDUCED_MOTION.matches) return;
    tween(panel, 0, panel.scrollHeight, 0, 1);
  }

  function collapsePanel(panel, tile) {
    if (REDUCED_MOTION.matches) {
      panel.hidden = true;
      tile.classList.remove('mbs-tile-open');
      return;
    }
    tween(panel, panel.getBoundingClientRect().height, 0, 1, 0, () => {
      panel.hidden = true;
      tile.classList.remove('mbs-tile-open');
    });
  }

  /* Swap the panel's contents and tween between the two heights. */
  function resizePanel(panel, mutate) {
    if (REDUCED_MOTION.matches) { mutate(); return; }
    const from = panel.getBoundingClientRect().height;
    mutate();
    const to = panel.scrollHeight;
    if (Math.abs(to - from) < 2) return;
    tween(panel, from, to, 1, 1);
  }

  async function toggleTaskDetail(tile, href) {
    const existing = tile.nextElementSibling;
    if (existing && existing.classList.contains('mbs-task-detail')) {
      if (existing.hidden) revealPanel(existing, tile);
      else collapsePanel(existing, tile);
      return;
    }

    const panel = el('div', 'mbs-task-detail');
    const foot = el('div', 'mbs-task-detail__foot');
    const open = el('a', 'mbs-task-open', 'Open full task ↗');
    open.href = href;
    foot.append(open);

    // warm (hovered or opened before): one animation, no loading flash
    const warm = cachedDetail(href);
    if (warm) {
      panel.append(warm, foot);
      tile.after(panel);
      revealPanel(panel, tile);
      return;
    }

    panel.append(el('div', 'mbs-task-detail__status', 'Loading…'));
    tile.after(panel);
    revealPanel(panel, tile);

    try {
      const body = await loadTaskDetail(href);
      resizePanel(panel, () => { panel.textContent = ''; panel.append(body, foot); });
    } catch (err) {
      resizePanel(panel, () => {
        panel.textContent = '';
        panel.append(el('div', 'mbs-task-detail__status', 'Could not load this task — open it directly.'), foot);
      });
      console.warn('[MBS] task detail', err);
    }
  }

  /* Upcoming / Past / Overdue are plain links, so each click was a full page
     load — the flash. They're swapped in place instead: fetch the view,
     replace just the task list and the button group, and push the URL so
     back still works. Any failure falls back to a real navigation, so the
     buttons never become dead ends. */
  let swapInFlight = false;

  async function swapTaskView(href, push = true) {
    const list = document.querySelector('.js-tasks');
    const group = document.querySelector('.btn-group');
    if (!list || swapInFlight) { if (!list) location.href = href; return; }

    swapInFlight = true;
    list.classList.add('mbs-swapping');
    try {
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = doc.querySelector('.js-tasks');
      if (!fresh) throw new Error('no task list in response');

      list.replaceChildren(...fresh.childNodes);
      const freshGroup = doc.querySelector('.btn-group');
      if (freshGroup && group) group.replaceChildren(...freshGroup.childNodes);
      if (push) history.pushState({ mbsView: href }, '', href);
    } catch (err) {
      console.warn('[MBS] view swap', err);
      location.href = href;
      return;
    } finally {
      swapInFlight = false;
      list.classList.remove('mbs-swapping');
    }
  }

  function enhanceViewTabs() {
    document.querySelectorAll('.btn-group a[href*="view="]').forEach(a => {
      if (a.dataset.mbsView) return;
      a.dataset.mbsView = '1';
      a.addEventListener('click', e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (!document.querySelector('.js-tasks')) return;   // not a page we swap
        e.preventDefault();
        swapTaskView(a.getAttribute('href'));
      });
    });
  }

  addEventListener('popstate', () => {
    if (/view=/.test(location.search) && document.querySelector('.js-tasks')) {
      swapTaskView(location.href, false);
    }
  });

  const PREFETCH_DELAY = 180;
  let prefetchTimer = null;
  let prefetchBusy = false;
  let prefetchNext = null;

  /* One request at a time, but the one waiting is held rather than dropped.
     Dropping it meant that reading down a list — settling on a task while
     the previous one was still in flight — left the task you actually
     wanted cold, and the click paid the full fetch. */
  function runPrefetch(href) {
    if (taskDetailCache.has(href)) return;
    if (prefetchBusy) { prefetchNext = href; return; }
    prefetchBusy = true;
    loadTaskDetail(href).catch(() => {}).finally(() => {
      prefetchBusy = false;
      const next = prefetchNext;
      prefetchNext = null;
      if (next && next !== href) runPrefetch(next);
    });
  }

  function schedulePrefetch(href) {
    if (taskDetailCache.has(href)) return;
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => runPrefetch(href), PREFETCH_DELAY);
  }

  // leaving a row drops the queued follow-up too, so nothing keeps fetching
  // for a task the cursor has already moved off
  function cancelPrefetch() { clearTimeout(prefetchTimer); prefetchNext = null; }

  /* Four delegated listeners on the document, rather than three per tile
     re-attached on every mutation. The task list is replaced wholesale —
     by swapTaskView, and by ManageBac's own navigation — so the old
     per-tile binding had to re-walk every tile just to find the ones that
     had lost their handlers. Delegation survives the swap untouched.

     A link inside an expanded panel resolves to no tile (the panel is the
     tile's sibling, not its child), so "Open full task" still navigates. */
  function taskLinkAt(node) {
    const link = node && node.closest && node.closest('a[href*="/core_tasks/"]');
    if (!link) return null;
    const tile = link.closest('.f-task-tile');
    return tile ? { link, tile } : null;
  }

  document.addEventListener('click', e => {
    const hit = taskLinkAt(e.target);
    if (!hit) return;
    const { link, tile } = hit;
    // a bypass click we fired ourselves — let it navigate untouched
    if (link.dataset.mbsBypass) { delete link.dataset.mbsBypass; return; }
    // cmd/ctrl/shift keep their normal meaning (new tab, new window)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

    e.preventDefault();

    /* Option/Alt opens the full task page instead of expanding. This
       overrides the browser's own alt-click-to-download, which is not
       useful on a task link. Re-dispatching the click rather than
       assigning location keeps ManageBac's own navigation in play, so
       it stays a soft page swap instead of a full reload. */
    if (e.altKey) {
      link.dataset.mbsBypass = '1';
      link.click();
      return;
    }

    toggleTaskDetail(tile, link.getAttribute('href'));
  });

  /* Prefetch on hover, but only on deliberate hover. A task page is ~185KB,
     so firing on every pass of the cursor put a megabyte of competing
     requests behind a list you were only scrolling past. Waiting out a
     short intent delay keeps the click instant without saturating the
     connection. mouseover/mouseout are used because mouseenter/mouseleave
     don't bubble; the relatedTarget check filters the crossings that are
     still inside the same link. */
  document.addEventListener('mouseover', e => {
    const hit = taskLinkAt(e.target);
    if (!hit || (e.relatedTarget && hit.link.contains(e.relatedTarget))) return;
    schedulePrefetch(hit.link.getAttribute('href'));
  });

  document.addEventListener('mouseout', e => {
    const hit = taskLinkAt(e.target);
    if (!hit || (e.relatedTarget && hit.link.contains(e.relatedTarget))) return;
    cancelPrefetch();
  });

  document.addEventListener('focusin', e => {
    const hit = taskLinkAt(e.target);
    if (hit) schedulePrefetch(hit.link.getAttribute('href'));
  });

  function tidyRightSidebar() {
    document.querySelectorAll('.f-layout-main__sidebar').forEach(aside => {
      /* [class*=] is the most expensive selector this script runs, and it
         only needs running once: a sidebar's tab set is fixed once the page
         has populated it. An empty result means it hasn't yet, so the mark
         is withheld and the next pass tries again. */
      if (aside.dataset.mbsAside) return;
      const panels = [...aside.querySelectorAll('[class*="js-sidebar_"]')];
      if (!panels.length) return;
      aside.dataset.mbsAside = '1';
      const keep = panels.filter(p => !/js-sidebar_guides/.test(p.className));
      aside.classList.toggle('mbs-aside-empty', keep.length === 0);
    });
  }

  /* The calendar's "Add Personal Event" and "Subscribe to Calendar" go: both
     are one-off setup actions sitting in the calendar's best corner. They're
     matched by label because their classes (btn, cq-btn-responsive-md) are
     shared with buttons that stay. */
  const HIDE_BUTTONS = /^(add personal event|subscribe to calendar)$/i;
  function hideButtons() {
    document.querySelectorAll('.cq-btn-responsive-md, a.btn, button.btn').forEach(b => {
      if (!b.classList.contains('mbs-gone') && HIDE_BUTTONS.test(b.textContent.replace(/\s+/g, ' ').trim()))
        b.classList.add('mbs-gone');
    });
  }

  /* ---------- due today ----------
     Read from the same feed the calendar draws from, /student/events.json:
     today's entries, and the next fortnight's for "next up" when today is
     clear. Fetched once and reused for five minutes, so moving between
     calendar views doesn't refetch. */
  const dueYmd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dueDay = e => e.allDay ? e.start.slice(0, 10) : dueYmd(new Date(e.start));
  let dueCache = null;
  async function dueFetch() {
    const now = new Date(), day = dueYmd(now);
    if (dueCache && dueCache.day === day && Date.now() - dueCache.at < 5 * 60e3) return dueCache;
    const end = new Date(now);
    end.setDate(now.getDate() + 14);
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const res = await fetch(`/student/events.json?start=${day}T00:00:00&end=${dueYmd(end)}T00:00:00&timeZone=${tz}`,
                            { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('events.json ' + res.status);
    const all = (await res.json()).filter(e => e && e.start && e.url).sort((a, b) => a.start.localeCompare(b.start));
    return (dueCache = { day, at: Date.now(), items: all.filter(e => dueDay(e) === day), next: all.find(e => dueDay(e) > day) });
  }

  function dueFill(box, data) {
    box.classList.remove('mbs-due--loading');
    const names = new Map(readClasses().map(c => [String(c.id), c.name]));
    const head = box.querySelector('.mbs-due__head'), row = box.querySelector('.mbs-due__row');
    if (data.items.length) head.append(el('span', 'n', String(data.items.length)));
    if (!data.items.length) {
      const empty = el('div', 'mbs-due__empty');
      empty.append(el('b', null, 'Nothing due today'));
      if (data.next) {
        const when = new Date(data.next.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const a = el('a', null, `Next up: ${when} · ${data.next.title.trim()}`);
        a.href = data.next.url;
        empty.append(a);
      }
      row.replaceChildren(empty);
      return;
    }
    row.replaceChildren(...data.items.map(e => {
      const a = el('a', 'mbs-due__item');
      a.href = e.url;
      a.title = e.title.trim();
      if (e.backgroundColor) a.style.setProperty('--due', e.backgroundColor);
      const when = new Date(e.start);
      if (!e.allDay) a.dataset.at = when.getTime();
      const id = (e.url.match(/\/classes\/(\d+)/) || [])[1];
      a.append(el('span', 't', e.allDay ? 'All day' : ttHHMM(when.getHours() * 60 + when.getMinutes())),
               el('span', 'n', e.title.trim()),
               el('span', 'c', [names.get(id), e.category].filter(Boolean).join(' · ')));
      return a;
    }));
    duePast();
  }

  // whatever's already past its time fades; checked every minute
  function duePast() {
    document.querySelectorAll('.mbs-due__item[data-at]').forEach(a => a.classList.toggle('is-past', +a.dataset.at < Date.now()));
  }
  setInterval(duePast, 60e3);

  function dueMount() {
    if (!/^\/student\/calendar\/?$/.test(location.pathname)) return;
    const hero = document.querySelector('.f-hero__content');
    if (!hero || hero.querySelector('.mbs-due')) return;
    const box = el('div', 'mbs-due mbs-due--loading');
    const head = el('div', 'mbs-due__head');
    head.append(el('span', 'k', 'Due today'));
    box.append(head, el('div', 'mbs-due__row'));
    hero.classList.add('mbs-has-due');
    hero.append(box);
    dueFetch().then(d => dueFill(box, d)).catch(err => {
      console.warn('[MBS]', err);
      box.remove();
      hero.classList.remove('mbs-has-due');
    });
  }

  function apply() {
    injectCSS();
    if (!document.body) return;
    try { buildSwitch(); } catch (err) { console.warn('[MBS]', err); }
    try { syncDock(); } catch (err) { console.warn('[MBS]', err); }
    try { tidyRightSidebar(); } catch (err) { console.warn('[MBS]', err); }
    try { hideButtons(); } catch (err) { console.warn('[MBS]', err); }
    try { dueMount(); } catch (err) { console.warn('[MBS]', err); }
    try { enhanceViewTabs(); } catch (err) { console.warn('[MBS]', err); }
  }

  /* The observer sees every mutation on the page, and the script's own
     inserts land back in it — expanding a task queued an apply() for each
     node of the description it had just written. Two filters keep apply()
     off that path: a batch that adds no elements can't have added anything
     worth reacting to, and a node under our own UI is ours, not
     ManageBac's. What's left is the case the observer is actually for —
     ManageBac replacing the page under us. */
  const MINE = '.mbs-panel, .mbs-task-detail, .mbs-switch, .mbs-dock, .mbs-due';

  function pageChanged(records) {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.closest(MINE)) continue;
        return true;
      }
    }
    return false;
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  };

  apply();
  document.addEventListener('DOMContentLoaded', apply);
  new MutationObserver(records => { if (pageChanged(records)) schedule(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
