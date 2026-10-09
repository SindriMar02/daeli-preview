/* Dæli · Kleif hybrid
   v1 engine (../kleif: White Desert transplant) with the Eyvindarholt fixes
   (rail title grows as a compositor scale everywhere; the stay picker) and
   Rossar's position-tied line reveals. Vanilla + GSAP ScrollTrigger + Lenis
   (DESKTOP ONLY: Lenis never mounts on touch, it breaks iOS chrome).
   One writer per element. Mobile chrome: constant bar + awning, zero motion. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  var isDesktop = function () { return window.matchMedia('(min-width: 769px)').matches; };
  var body = document.body;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- header state: transparent over the hero, white bar after ---------- */
  function setNavTheme(v) { body.setAttribute('data-nav-theme', v === 'hero' ? 'hero' : 'bar'); }

  /* ---------- scroll lock: Lenis on desktop, fixed-body on touch ---------- */
  var lenis = null;
  var lockY = 0, locked = false;
  function lockScroll() {
    if (locked) return; locked = true;
    if (lenis) { lenis.stop(); return; }
    lockY = window.scrollY;
    body.style.position = 'fixed'; body.style.top = -lockY + 'px';
    body.style.left = '0'; body.style.right = '0'; body.style.width = '100%';
  }
  function unlockScroll() {
    if (!locked) return; locked = false;
    if (lenis) { lenis.start(); return; }
    body.style.position = ''; body.style.top = '';
    body.style.left = ''; body.style.right = ''; body.style.width = '';
    window.scrollTo(0, lockY);
  }

  /* ---------- mobile menu ---------- */
  var menuBtn = $('menuBtn');
  var menuPanel = $('menuPanel');
  var menuOpen = false;
  function openMenu() {
    menuOpen = true;
    menuPanel.classList.add('is-open');
    menuPanel.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
    lockScroll();
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menuPanel.classList.remove('is-open');
    menuPanel.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    unlockScroll();
  }
  menuBtn.addEventListener('click', function () { menuOpen ? closeMenu() : openMenu(); });
  /* close BEFORE the default anchor jump: unlock restores the old scroll
     position synchronously, then the browser jumps to the target */
  menuPanel.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMenu); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen) { closeMenu(); menuBtn.focus(); } });

  /* ---------- anchor jumps go through Lenis on desktop ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (!lenis || id.length < 2) return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      /* pins change the document height after load; measure again first */
      lenis.resize();
      lenis.scrollTo(id === '#top' ? 0 : target, { offset: id === '#top' ? 0 : -88, duration: 1.4 });
    });
  });

  /* ============================================================
     THE ENQUIRY: house choice + stay picker + request
     ============================================================ */
  var form = $('bookForm');
  /* each house sleeps what its own listing says (daeli.is/accommodation) */
  var SLEEPS = { old: 2, eyrin: 4, fytin: 3, grund: 5 };
  var NAMES = { old: 'Old Farmhouse', eyrin: 'Eyrin Cottage', fytin: 'Fytin Apartments', grund: 'Grund Family House' };
  /* Dæli has no booking desk wired yet: without an explicit API the form runs
     in preview mode (no network call, a plain message with phone and email) */
  var API = window.DAELI_API || null;
  var CONTACT = 'Call +354 451 2566 or write to daeli@daeli.is.';

  function houseId() { var r = form.querySelector('input[name="house"]:checked'); return r ? r.value : 'old'; }
  function syncHouse() {
    var max = SLEEPS[houseId()];
    $('bkGuests').max = String(max);
    $('errGuests').textContent = max > 1 ? 'How many of you, 1 to ' + max + '?' : 'How many of you?';
  }

  /* "Ask for dates here" on a house sheet preselects that house */
  document.querySelectorAll('[data-house]').forEach(function (a) {
    a.addEventListener('click', function () {
      var r = form.querySelector('input[name="house"][value="' + a.getAttribute('data-house') + '"]');
      if (r) { r.checked = true; syncHouse(); }
    });
  });

  /* ---------- THE STAY PICKER ----------
     Rules ported from the Eyvindarholt build (which took them from the
     audited Riverbank / Aurora Hills picker):
       1. past nights blocked; booked nights struck and still readable;
       2. a range may not CROSS a booked night; the refusal restarts the stay
          at the clicked day and says why;
       3. a booked night is still a legal CHECKOUT, so the crossing test runs
          over [start, end-1];
       4. the minimum stay is named at selection;
       5. hover previews the range, for a real mouse only;
       6. UNDO: tapping the check-in clears the stay, tapping the checkout
          clears only the checkout, and Clear dates appears once a date is set.
     Dæli has no live calendar in this preview, so no night is invented as
     booked and the picker says so. */
  var stay = (function () {
    var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var MIN_STAY = 1; /* no minimum is published; the family decides */
    var DAY = 86400000;
    var sod = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
    var add = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
    var addMo = function (d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); };
    var nights = function (a, b) { return Math.round((b - a) / DAY); };
    var key = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    var same = function (a, b) { return !!a && !!b && key(a) === key(b); };
    var fmt = function (d) { return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear(); };
    var fmtShort = function (d) { return WD[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MO[d.getMonth()].slice(0, 3); };

    var today = sod(new Date());
    var left = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
    var firstMonth = new Date(today.getFullYear(), today.getMonth() + (left < 7 ? 1 : 0), 1);
    var month = firstMonth;
    var start = null, end = null, hover = null, free = null, fetchSeq = 0;
    var grids = $('stayGrids');

    function taken(d) { return free ? !free.has(key(d)) : false; }
    function crosses(a, b) { for (var d = a; d < b; d = add(d, 1)) if (taken(d)) return true; return false; }
    function note(text) { var n = $('stayNote'); n.textContent = text || ''; n.hidden = !text; }

    function monthHTML(m, idx) {
      var first = new Date(m.getFullYear(), m.getMonth(), 1);
      var lead = (first.getDay() + 6) % 7;
      var previewTo = end || (start && hover && hover > start ? hover : null);
      var h = '<div class="stay_m' + (idx ? ' stay_m2' : '') + '">' +
        '<p class="stay_cap">' + MO[m.getMonth()] + ' ' + m.getFullYear() + '</p>' +
        '<div class="stay_wd" aria-hidden="true">' + WD.map(function (w) { return '<span>' + w.slice(0, 2) + '</span>'; }).join('') + '</div>' +
        '<div class="stay_g' + (end ? ' has-range' : '') + '">';
      for (var i = 0; i < 42; i++) {
        var d = add(first, i - lead);
        if (d.getMonth() !== m.getMonth()) { h += '<span class="stay_d is-blank" aria-hidden="true"></span>'; continue; }
        var past = d < today, tk = !past && taken(d);
        var cls = ['stay_d'];
        if (past) cls.push('is-past');
        if (tk) cls.push('is-taken');
        if (same(d, start)) cls.push('is-start');
        if (same(d, end)) cls.push('is-end');
        if (start && previewTo && d > start && d < previewTo) cls.push('is-in');
        if (same(d, previewTo) && !end) cls.push('is-preview');
        var label = fmt(d) + (tk ? ', booked' : '') + (same(d, start) ? ', arrival' : '') + (same(d, end) ? ', departure' : '');
        h += '<button type="button" class="' + cls.join(' ') + '" data-day="' + key(d) + '"' +
          (past ? ' disabled' : '') + (same(d, start) || same(d, end) ? ' aria-pressed="true"' : '') +
          ' aria-label="' + label + '">' + d.getDate() + '</button>';
      }
      return h + '</div></div>';
    }

    function render() {
      grids.innerHTML = monthHTML(month, 0) + monthHTML(addMo(month, 1), 1);
      $('stayLive').textContent = MO[month.getMonth()] + ' ' + month.getFullYear();
      $('stayPrev').disabled = month <= firstMonth && month <= new Date(today.getFullYear(), today.getMonth(), 1);
      $('stayIn').textContent = start ? fmtShort(start) : 'Pick a night';
      $('stayOut').textContent = end ? fmtShort(end) : (start ? 'Now the morning you leave' : 'Pick a morning');
      var n = start && end ? nights(start, end) : 0;
      $('stayNights').textContent = n ? n + (n === 1 ? ' night' : ' nights') + ' in ' + NAMES[houseId()] : 'Check-in 15:00 to 22:00, check-out by 11:00';
      $('stayClear').hidden = !start;
      $('bkArrive').value = start ? key(start) : '';
      $('bkDepart').value = start && end ? key(end) : '';
      if (start && end) { $('errArrive').hidden = true; $('errForm').hidden = true; }
    }

    function clear(keepStart) { if (!keepStart) start = null; end = null; hover = null; note(''); render(); }

    function pick(d) {
      if (d < today) return;
      if (start && same(d, start)) { clear(false); return; }
      if (end && same(d, end)) { clear(true); return; }
      if (taken(d) && (!start || end)) { note(fmt(d) + ' is already booked. The struck-through nights are taken.'); return; }
      if (!start || end || d <= start) { start = d; end = null; note(''); render(); return; }
      if (crosses(start, d)) {
        start = d; end = null;
        note('A booked night sits between those dates, so this is a new arrival on ' + fmt(d) + '. Pick the morning you leave.');
        render(); return;
      }
      if (nights(start, d) < MIN_STAY) { note('The earliest checkout is ' + fmt(add(start, MIN_STAY)) + '.'); return; }
      end = d; note(''); render();
    }

    grids.addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]'); if (!b || b.disabled) return;
      var p = b.getAttribute('data-day').split('-').map(Number);
      pick(new Date(p[0], p[1] - 1, p[2]));
      var again = grids.querySelector('[data-day="' + b.getAttribute('data-day') + '"]');
      if (again) again.focus({ preventScroll: true });
    });
    /* hover preview is for a real mouse only: a tap fires mouseover too */
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    grids.addEventListener('mouseover', function (e) {
      if (!finePointer.matches || !start || end) return;
      var b = e.target.closest('[data-day]'); if (!b) return;
      var p = b.getAttribute('data-day').split('-').map(Number);
      var d = new Date(p[0], p[1] - 1, p[2]);
      if (!same(d, hover)) { hover = d; render(); }
    });
    grids.addEventListener('mouseleave', function () { if (hover) { hover = null; render(); } });
    $('stayPrev').addEventListener('click', function () { month = addMo(month, -1); render(); });
    $('stayNext').addEventListener('click', function () { month = addMo(month, 1); render(); });
    $('stayClear').addEventListener('click', function () { clear(false); $('stayPrev').focus({ preventScroll: true }); });

    var PREVIEW_SRC = 'Design preview: every night shows open. No house calendar is connected yet.';
    function load(people) {
      var seq = ++fetchSeq;
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 6000);
      fetch(API + '/booking/days?from=' + key(today) + '&days=365&resourceId=' + encodeURIComponent(houseId()) + '&people=' + Math.max(1, people || 1), { signal: ctrl.signal })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (seq !== fetchSeq) return;
          /* an empty list is an answer (fully booked), only a failure is 'unknown' */
          free = data && Array.isArray(data.days) ? new Set(data.days) : null;
          $('staySrc').textContent = free ? 'Live from the house calendar. Struck-through nights are booked.' : PREVIEW_SRC;
          render();
        })
        .catch(function () { if (seq !== fetchSeq) return; free = null; $('staySrc').textContent = PREVIEW_SRC; render(); })
        .finally(function () { clearTimeout(timer); });
    }
    $('staySrc').textContent = PREVIEW_SRC;
    render();
    /* only ask a calendar when a booking desk is configured */
    if (API) load(1);
    return {
      reset: function () { clear(false); }, render: render, load: function (n) { if (API) load(n); },
      focus: function () { var f = grids.querySelector('button.stay_d:not([disabled])'); if (f) f.focus(); },
      state: function () { return { start: start && key(start), end: end && key(end), live: !!free }; }
    };
  })();
  window.__stay = stay; /* probe hook for QA */

  form.querySelectorAll('input[name="house"]').forEach(function (r) {
    r.addEventListener('change', function () { syncHouse(); stay.render(); stay.load(guestCount() || 1); });
  });
  syncHouse();
  /* the whole value, so 2.9 is refused rather than read as 2 */
  function guestCount() { var v = $('bkGuests').value.trim(); return /^\d+$/.test(v) ? Number(v) : NaN; }
  var guestTimer;
  $('bkGuests').addEventListener('input', function () {
    clearTimeout(guestTimer);
    guestTimer = setTimeout(function () { stay.load(guestCount() || 1); }, 400);
  });
  /* say it before anyone types: this preview sends nothing */
  if (!API) $('bookNote').textContent = 'In this design preview requests are not sent yet. ' + CONTACT;

  var errFor = { bkGuests: 'errGuests', bkName: 'errName', bkPhone: 'errPhone', bkEmail: 'errEmail' };
  Object.keys(errFor).forEach(function (id) {
    $(id).addEventListener('input', function () { $(errFor[id]).hidden = true; $('errForm').hidden = true; });
  });
  var REASON_TEXT = {
    ALREADY_BOOKED: 'Those nights are already taken in that house. Try other dates, or another house.',
    OVER_CAPACITY: 'That is more guests than the house sleeps. Grund Family House sleeps five.',
    TOO_SOON: 'That arrival is too soon for an online request. Call the family instead.',
    TOO_FAR_AHEAD: 'That is further ahead than the calendar is open. Write to the family.',
    MIN_NIGHTS: 'That stay is too short to request online.',
    MAX_NIGHTS: 'That stay is longer than can be requested online. Write to the family.',
    CLOSED_DAY: 'The farm is closed on those dates.',
    OUT_OF_SEASON: 'The farm is closed on those dates.',
    INVALID_RANGE: 'The morning you leave must come after the night you arrive.'
  };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var arrive = $('bkArrive').value, depart = $('bkDepart').value;
    var guests = guestCount();
    var name = $('bkName').value.trim(), phone = $('bkPhone').value.trim(), email = $('bkEmail').value.trim();
    var msg = $('bkMsg').value.trim();
    var house = houseId();
    var bad = [];
    function flag(id, when) { $(errFor[id]).hidden = !when; if (when) bad.push($(id)); }
    var datesBad = !arrive || !depart || depart <= arrive;
    $('errArrive').hidden = !datesBad;
    flag('bkGuests', !(guests >= 1 && guests <= SLEEPS[house]));
    flag('bkName', !name);
    flag('bkPhone', !phone);
    flag('bkEmail', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    var errForm = $('errForm');
    if (datesBad || bad.length) {
      errForm.textContent = 'Check the highlighted fields, then send again.';
      errForm.hidden = false;
      if (datesBad) stay.focus(); else bad[0].focus();
      return;
    }
    errForm.hidden = true;

    var submitBtn = $('bkSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    function fail(text) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send the request';
      errForm.textContent = text;
      errForm.hidden = false;
    }
    /* no booking desk configured: say so plainly, without a request that
       cannot answer */
    if (!API) {
      fail('Online requests are not switched on in this design preview. ' + CONTACT);
      return;
    }
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 10000);
    fetch(API + '/booking/request', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceId: house, date: arrive, endDate: depart, people: guests,
        customer: { name: name, phone: phone, email: email },
        note: msg || ''
      })
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (r) {
      window.__bookResult = r; /* probe hook for QA */
      if (r.data && r.data.ok) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send the request';
        form.hidden = true;
        $('bookRef').textContent = r.data.id || '';
        var done = $('bookDone'); done.hidden = false; done.focus();
        return;
      }
      if (r.status === 409 && r.data.reasons && r.data.reasons.length) {
        var known = r.data.reasons.map(function (x) { return REASON_TEXT[x]; }).filter(Boolean);
        fail(known[0] || 'Those dates cannot be requested online. ' + CONTACT);
        return;
      }
      if (r.status === 503 && r.data.reason === 'paused') { fail('Online requests are paused right now. ' + CONTACT); return; }
      if (r.data && r.data.messages && r.data.messages.length) { fail(r.data.messages[0]); return; }
      fail('The request did not go through. ' + CONTACT);
    }).catch(function () {
      fail('The booking desk cannot be reached right now. ' + CONTACT);
    }).finally(function () { clearTimeout(timer); });
  });

  /* ============================================================
     MOTION
     ============================================================ */

  /* reduced motion or no GSAP: a plain render, the header swaps by observer */
  if (reduced || !window.gsap) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setNavTheme(en.target.getAttribute('data-nav-theme-val')); });
    }, { rootMargin: '0px 0px -99% 0px' });
    document.querySelectorAll('[data-nav-section]').forEach(function (s) { io.observe(s); });
    document.querySelectorAll('.text-scroll-fade').forEach(function (el) { el.style.webkitMaskImage = 'none'; el.style.maskImage = 'none'; });
    var w = $('introWipe'); if (w) w.classList.add('is-done');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  /* iOS collapses its URL bar the moment a scroll starts; a refresh mid-fling
     writes scroll and WebKit kills the momentum. Height-only resizes on touch
     never reach ScrollTrigger. */
  ScrollTrigger.config({ ignoreMobileResize: true });

  if (!isTouch) {
    lenis = new Lenis({ lerp: 0.1, autoRaf: false });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
  }
  gsap.ticker.lagSmoothing(0);

  var vh = function () { return window.innerHeight; };
  /* iOS scroll events arrive async with rendering; a small lerp on touch */
  var SCRUB = isTouch ? 0.35 : true;

  /* ---------- intro wipe: time-based, never load-bearing ---------- */
  var wipe = $('introWipe');
  gsap.set(wipe, { clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' });
  gsap.to(wipe, {
    clipPath: 'polygon(0 0, 100% 0, 100% 0%, 0 0%)', duration: 0.8, delay: 0.15, ease: 'power4.inOut',
    onComplete: function () { wipe.classList.add('is-done'); }
  });

  /* ---------- header state per section (the bar never hides) ---------- */
  document.querySelectorAll('[data-nav-section]').forEach(function (sec) {
    if (sec.id === 'hero') return;
    ScrollTrigger.create({
      trigger: sec, start: 'top 5rem', end: 'bottom 5rem',
      onToggle: function (self) { if (self.isActive) setNavTheme(sec.getAttribute('data-nav-theme-val')); }
    });
  });
  /* the fog turns the hero white well before the hero ends, so the header
     takes its bar as the bank arrives, not when the next section does */
  ScrollTrigger.create({
    trigger: '#hero', start: 'top top', end: function () { return '+=' + Math.round(0.42 * vh()); },
    onEnter: function () { setNavTheme('hero'); }, onEnterBack: function () { setNavTheme('hero'); },
    onLeave: function () { setNavTheme('bar'); }
  });

  /* ---------- HERO (not a pin: the wrapper rides the scroll) ---------- */
  var hero = $('hero');
  var heroWrapper = $('heroWrapper');
  var heroContent = $('heroContent');
  var heroST = function (extra) {
    var o = { trigger: hero, start: 'top top', end: 'bottom top', scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 10 };
    for (var k in extra) o[k] = extra[k];
    return o;
  };
  gsap.to(heroWrapper, { y: function () { return vh(); }, ease: 'none', scrollTrigger: heroST() });
  if (!isTouch) {
    /* a scrubbed blur repaints the hero every frame; WebKit pays that in paint */
    gsap.fromTo(heroContent, { filter: 'blur(0px)' }, { filter: 'blur(10px)', ease: 'none', scrollTrigger: heroST() });
  }
  /* layers rest at translateY(100%) in CSS and animate `y` with a unit string */
  hero.querySelectorAll('[data-scroll-speed]').forEach(function (el) {
    gsap.to(el, { y: el.getAttribute('data-scroll-speed'), ease: 'none', scrollTrigger: heroST() });
  });
  var heroBgFade = $('heroBgFade');
  gsap.fromTo(heroBgFade, { opacity: 0 }, {
    opacity: 1, ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top-=8%', end: 'top top-=52%', scrub: SCRUB, refreshPriority: 10 }
  });
  var mistPlane = $('mistPlane');
  var mistTransition = $('mistTransition');
  mistPlane.classList.add('visible');
  gsap.fromTo(mistPlane, { rotateX: 90 }, {
    rotateX: 0, ease: 'none',
    scrollTrigger: { trigger: mistTransition, start: 'top top-=55%', end: 'bottom center', scrub: SCRUB, refreshPriority: 8 }
  });
  hero.querySelectorAll('[data-hero-drift]').forEach(function (el) {
    gsap.to(el, { y: function () { return -0.45 * vh(); }, ease: 'none', scrollTrigger: heroST() });
  });

  /* ---------- manifesto: mask develop + scribble ---------- */
  var maskEl = $('maskDevelop');
  gsap.set(maskEl, { '--mask-position': -40 });
  gsap.to(maskEl, {
    '--mask-position': 100, ease: 'none',
    scrollTrigger: { trigger: maskEl, start: 'top 80%', end: 'bottom 60%', scrub: SCRUB, refreshPriority: 9 }
  });
  var scribblePath = document.querySelector('#scribble path');
  var len = scribblePath.getTotalLength();
  gsap.set(scribblePath, { strokeDasharray: len, strokeDashoffset: len });
  gsap.to(scribblePath, {
    strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut',
    scrollTrigger: { trigger: '.manifesto_kicker', start: 'top 80%', toggleActions: 'play none none reverse' }
  });

  /* ---------- Rossar line reveal, tied to POSITION (a short scrub band),
     so a fast scroll can never outrun it ---------- */
  document.querySelectorAll('[data-lines]').forEach(function (h) {
    var inner = document.createElement('span'); inner.className = 'lines-inner';
    while (h.firstChild) inner.appendChild(h.firstChild);
    var mask = document.createElement('span'); mask.className = 'lines-mask';
    mask.appendChild(inner); h.appendChild(mask);
    gsap.fromTo(inner, { yPercent: 125 }, {
      yPercent: 0, ease: 'none',
      scrollTrigger: { trigger: h, start: 'top 92%', end: 'top 68%', scrub: SCRUB }
    });
  });

  var mm = gsap.matchMedia();

  /* ---------- frames unclip (desktop) ---------- */
  mm.add('(min-width: 769px)', function () {
    document.querySelectorAll('[data-unclip]').forEach(function (el, i) {
      gsap.fromTo(el, { clipPath: 'inset(0% 0% 20% 0% round 0.3rem)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 0.3rem)', ease: 'none',
        scrollTrigger: { trigger: '.story_images', start: 'top 85%', end: 'top ' + (45 - i * 8) + '%', scrub: SCRUB }
      });
    });
    document.querySelectorAll('#comfortsStrip .comforts_plate img').forEach(function (el, i) {
      gsap.fromTo(el, { clipPath: 'inset(0% 0% 22% 0% round 0.3rem)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 0.3rem)', ease: 'none',
        scrollTrigger: { trigger: '#comfortsStrip', start: 'top 85%', end: 'top ' + (50 - i * 6) + '%', scrub: SCRUB }
      });
    });
  });

  /* ---------- card-flick: hover accordion (desktop) ---------- */
  mm.add('(min-width: 769px)', function () {
    var items = Array.prototype.slice.call($('cardFlick').querySelectorAll('.card-flick_item'));
    var GROW_ACTIVE = items.length - 1, GROW_REST = 1;
    var current = 0, tl = null;
    items.forEach(function (item, i) {
      gsap.set(item, { flexGrow: i === 0 ? GROW_ACTIVE : GROW_REST });
      gsap.set(item.querySelector('.card-flick_content'), { opacity: i === 0 ? 1 : 0 });
    });
    function activate(idx) {
      if (idx === current) return;
      current = idx;
      if (tl) tl.kill();
      tl = gsap.timeline();
      items.forEach(function (item, i) {
        var on = i === idx;
        item.classList.toggle('is-active', on);
        tl.to(item, { flexGrow: on ? GROW_ACTIVE : GROW_REST, duration: 0.75, ease: 'expo' }, 0);
        tl.to(item.querySelector('.card-flick_content'), { opacity: on ? 1 : 0, duration: on ? 0.75 : 0.2, ease: on ? 'power1.out' : 'expo.out' }, 0);
      });
    }
    var handlers = items.map(function (item, i) {
      var f = function () { activate(i); };
      item.addEventListener('mouseenter', f);
      item.addEventListener('focusin', f);
      return f;
    });
    return function () {
      if (tl) tl.kill();
      items.forEach(function (item, i) {
        item.removeEventListener('mouseenter', handlers[i]);
        item.removeEventListener('focusin', handlers[i]);
        gsap.set(item, { clearProps: 'flexGrow' });
        gsap.set(item.querySelector('.card-flick_content'), { clearProps: 'opacity' });
      });
    };
  });

  /* ---------- THE RAIL (v1, hold shortened per the no-empty-scroll rule) ---------- */
  var railOuter = document.querySelector('.rail_outer');
  var rail = $('rail');
  var railContainer = $('railContainer');
  var railTitleWrap = document.querySelector('.rail_title-wrap');
  var railTitle = $('railTitle');
  var railBehind = $('railBehind');
  var railOverlay = $('railOverlay');
  var curtainRects = Array.prototype.slice.call(document.querySelectorAll('#curtainClip rect'));
  var railTravel = function () { return railContainer.scrollWidth - window.innerWidth; };

  mm.add('(min-width: 769px)', function () {
    gsap.fromTo(railOuter, { clipPath: 'inset(0% 10% 0% 10%)' }, {
      clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', clearProps: 'clipPath',
      scrollTrigger: { trigger: railOuter, start: 'top bottom', end: 'top top', scrub: SCRUB, refreshPriority: 6 }
    });
  });
  /* the title grows as a compositor-only SCALE on every device, rasterised at
     its largest size so it only ever scales down (Eyvindarholt fix) */
  var railType = function () {
    return isDesktop() ? { enter: 3, grown: 6, settled: 4.25 } : { enter: 2, grown: 3, settled: 2.6 };
  };
  var railGrow = null;
  function buildRailGrow() {
    if (railGrow) { railGrow.scrollTrigger && railGrow.scrollTrigger.kill(); railGrow.kill(); }
    var t = railType();
    gsap.set(railTitle, { fontSize: t.grown + 'rem', transformOrigin: '50% 50%' });
    railGrow = gsap.fromTo(railTitle, { scale: t.enter / t.grown }, {
      scale: 1, ease: 'none',
      scrollTrigger: { trigger: railOuter, start: 'top bottom', end: 'top top', scrub: SCRUB, refreshPriority: 6 }
    });
  }
  buildRailGrow();
  gsap.fromTo(railBehind, { yPercent: 18 }, {
    yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: railOuter, start: 'top 60%', end: 'top top', scrub: SCRUB, refreshPriority: 6 }
  });

  var railTl = null;
  function buildRail() {
    if (railTl) {
      railTl.scrollTrigger && railTl.scrollTrigger.kill();
      railTl.kill();
      gsap.set([railContainer, railTitleWrap], { clearProps: 'x,opacity' });
      gsap.set(railBehind, { clearProps: 'clipPath' });
      gsap.set(railOverlay, { opacity: 0.12 });
      curtainRects.forEach(function (r, i) { r.setAttribute('width', '0.3334'); r.setAttribute('x', String(i * 0.3333)); });
      gsap.set(railTitle, { clearProps: 'scale,transform' });
    }
    var H = vh();
    var L = railTravel();
    var sText = 0.7 * H;     /* v1: 1.5 */
    var sCurtain = 0.6 * H;  /* v1: 1.0 */
    var sX = 1.0 * L;      /* v1: 1.5; four houses already make a long rail */
    railTl = gsap.timeline({
      scrollTrigger: {
        trigger: rail, start: 'top top', end: '+=' + (sText + sCurtain + sX),
        pin: true, scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 5
      }
    });
    var rt = railType();
    railTl.fromTo(railTitle, { scale: 1 }, { scale: rt.settled / rt.grown, ease: 'none', duration: 0.5 * sText }, 0);
    var tCurtain = 0.5 * sText;
    railTl.to(curtainRects[2], { attr: { width: 0 }, ease: 'none', duration: 0.5 * sCurtain }, tCurtain);
    railTl.to(curtainRects[1], { attr: { width: 0 }, ease: 'none', duration: 0.75 * sCurtain }, tCurtain);
    railTl.to(curtainRects[0], { attr: { width: 0 }, ease: 'none', duration: 1.0 * sCurtain }, tCurtain);
    var tX = tCurtain + 0.3 * sCurtain;
    railTl.to(railContainer, { x: -L, ease: 'none', duration: sX }, tX);
    railTl.to(railTitleWrap, { x: L, ease: 'none', duration: sX }, tX);
    var tWipe = tX + 0.35 * sX;
    railTl.to(railBehind, { clipPath: 'inset(0% 100% 0% 0%)', ease: 'none', duration: 0.45 * sX }, tWipe);
    railTl.to(railOverlay, { opacity: 0.4, ease: 'none', duration: 0.45 * sX }, tWipe);
    /* the title rides with the camera; it leaves before the closing quote
       arrives so the two never sit on top of each other */
    railTl.fromTo(railTitleWrap, { opacity: 1 }, { opacity: 0, ease: 'none', duration: 0.12 * sX }, tX + 0.72 * sX);
  }
  gsap.set(railOverlay, { opacity: 0.12 });
  buildRail();

  /* ---------- the road draws itself; the pulse rides it ----------
     The svg box has the road's own aspect, so a viewBox point maps to a
     percentage of the box with no distortion. */
  var flown = $('routeFlown');
  var indicator = $('routeIndicator');
  var flightWrap = $('flightWrap');
  var vbox = flown.ownerSVGElement.viewBox.baseVal;
  var flownLen = flown.getTotalLength();
  gsap.set(flown, { strokeDasharray: flownLen, strokeDashoffset: flownLen });
  var prog = { p: 0 };
  function placeIndicator() {
    var pt = flown.getPointAtLength(flownLen * prog.p);
    indicator.style.left = (pt.x / vbox.width * 100) + '%';
    indicator.style.top = (pt.y / vbox.height * 100) + '%';
  }
  placeIndicator();
  gsap.to(prog, {
    p: 1, ease: 'none',
    scrollTrigger: { trigger: flightWrap, start: 'top 62%', end: 'bottom 62%', scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 3 },
    onUpdate: function () { flown.style.strokeDashoffset = String(flownLen * (1 - prog.p)); placeIndicator(); }
  });

  /* ---------- resize: rebuild the rail, then refresh ---------- */
  var rto, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    /* on touch only a WIDTH change is a real resize (URL bar changes height) */
    if (isTouch && window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rto);
    rto = setTimeout(function () { buildRailGrow(); buildRail(); ScrollTrigger.refresh(); }, 250);
  });
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
