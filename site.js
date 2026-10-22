// Mixtet web: jazyk (cookie pro přesměrování na /cs/), zdroj návštěvy (utm), formulář → /api/signup,
// lepkavé tlačítko na mobilu, zvětšení snímků. Bez sledování a bez knihoven.
(function () {
  'use strict';
  var M = window.MIXTET || { lang: 'en', msg: {} };
  var loadedAt = Date.now();

  // Zdroj návštěvy přežije přepnutí jazyka (sessionStorage), nic se neposílá jinam než do formuláře.
  var source = 'direct';
  try {
    var q = new URLSearchParams(location.search);
    source = q.get('utm_source') || q.get('src') || sessionStorage.getItem('mixtet-src') || 'direct';
    sessionStorage.setItem('mixtet-src', source);
  } catch (e) {}

  // Ruční volba jazyka: funkční cookie (bez souhlasu), server podle ní / přesměruje.
  document.querySelectorAll('.lang a').forEach(function (a) {
    a.addEventListener('click', function () {
      document.cookie = 'mixtet-lang=' + a.dataset.lang + '; path=/; max-age=31536000; SameSite=Lax; Secure';
      if (location.search) a.href = a.getAttribute('href') + location.search;
    });
  });

  // Lepkavé „Chci testovat“ na mobilu: až po úvodu, schová se u formuláře.
  var sticky = document.getElementById('sticky');
  var hero = document.querySelector('.hero');
  var join = document.getElementById('join');
  if (sticky && hero && join && 'IntersectionObserver' in window) {
    var heroVisible = true, joinVisible = false;
    var upd = function () { sticky.hidden = heroVisible || joinVisible; };
    new IntersectionObserver(function (en) { heroVisible = en[0].isIntersecting; upd(); }).observe(hero);
    new IntersectionObserver(function (en) { joinVisible = en[0].isIntersecting; upd(); }, { rootMargin: '0px 0px -30% 0px' }).observe(join);
  }

  // Na mobilu video na výšku: plakát 9:16 (zdroj vybírá <source media>).
  var vid = document.querySelector('.vid video');
  if (vid && window.matchMedia && matchMedia('(max-width: 600px)').matches) vid.poster = vid.poster.replace('16x9', '9x16');

  // Zvětšení snímku appky.
  var dlg = document.getElementById('zoom');
  document.querySelectorAll('.shot[data-full]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!dlg || !dlg.showModal) { window.open(b.dataset.full, '_blank'); return; }
      var img = dlg.querySelector('img');
      img.src = b.dataset.full; img.alt = b.querySelector('img').alt;
      dlg.showModal();
    });
  });
  if (dlg) dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  // Formulář.
  var form = document.getElementById('signup');
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var show = function (id, text) { var el = $(id); el.textContent = text || ''; el.hidden = !text; };
  var EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var fd = new FormData(form);
    var email = String(fd.get('email') || '').trim();
    var ok = true, first = null;
    var mark = function (cond, errId, msg, focusEl) {
      show(errId, cond ? '' : msg);
      if (!cond) { ok = false; first = first || focusEl; }
    };
    mark(EMAIL.test(email), 'email-err', M.msg.eEmail, $('email'));
    $('email').setAttribute('aria-invalid', String(!EMAIL.test(email)));
    mark(!!fd.get('mixer'), 'mixer-err', M.msg.eMixer, form.querySelector('input[name=mixer]'));
    mark(!!fd.get('consent'), 'consent-err', M.msg.eConsent, $('consent'));
    show('server-err', '');
    if (!ok) { first.focus(); return; }

    var body = {
      email: email, mixer: fd.get('mixer'), hub: fd.getAll('hub'), members: fd.get('members') || '',
      iem: fd.get('iem') || '', band: fd.get('band') || '', country: fd.get('country') || '',
      note: fd.get('note') || '', consent: true, web: fd.get('web') || '',
      lang: M.lang, source: source, t: loadedAt
    };
    var btn = $('submit');
    btn.disabled = true; btn.textContent = M.msg.fSending;
    fetch('/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.ok) return done(email);
        if (res.j && res.j.error === 'email') { show('email-err', M.msg.eEmail); $('email').focus(); }
        else if (res.j && res.j.error === 'mixer') show('mixer-err', M.msg.eMixer);
        else show('server-err', M.msg.eServer);
      })
      .catch(function () { show('server-err', M.msg.eServer); })
      .finally(function () { btn.disabled = false; btn.textContent = M.msg.fSubmit; });
  });

  function done(email) {
    var d = $('done');
    d.querySelector('h2').textContent = M.msg.okH;
    d.querySelector('p').textContent = M.msg.okP.replace('{email}', email);
    var share = $('share');
    share.textContent = M.msg.okShare;
    share.onclick = function () {
      var url = location.origin + location.pathname;
      if (navigator.share) { navigator.share({ url: url, title: document.title }).catch(function () {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { share.textContent = M.msg.okCopied; });
    };
    form.hidden = true; d.hidden = false; d.focus();
  }
})();
