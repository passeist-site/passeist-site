// Pages Auteurs : panneau menu mobile (même comportement que index.html).
(function () {
  var toggle = document.getElementById('nav-toggle');
  var drawer = document.getElementById('mobile-nav');
  var backdrop = document.getElementById('mobile-nav-backdrop');
  var closeBtn = document.getElementById('mobile-nav-close');
  if (!toggle || !drawer) return;
  function setOpen(open) {
    var wasOpen = drawer.classList.contains('open');
    toggle.classList.toggle('open', open);
    drawer.classList.toggle('open', open);
    if (backdrop) backdrop.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('no-scroll', open);
    if (open && closeBtn) closeBtn.focus({ preventScroll: true });
    else if (wasOpen && !open) toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', function () { setOpen(!drawer.classList.contains('open')); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });
  if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });
  // Glisser vers la gauche pour fermer (comme sur le reste du site)
  (function () {
    var x0 = null, y0 = 0, dx = 0, horiz = null;
    drawer.addEventListener('touchstart', function (e) {
      if (!drawer.classList.contains('open') || e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horiz = null;
    }, { passive: true });
    drawer.addEventListener('touchmove', function (e) {
      if (x0 === null) return;
      var mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (horiz === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horiz = Math.abs(mx) > Math.abs(my);
      if (!horiz) return;
      dx = Math.min(0, mx);
      drawer.style.transition = 'none'; drawer.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    drawer.addEventListener('touchend', function () {
      if (x0 === null) return;
      x0 = null; drawer.style.transition = ''; drawer.style.transform = '';
      if (horiz && dx < -70) setOpen(false);
    }, { passive: true });
  })();
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('open')) setOpen(false);
  });
  // FR / EN = même action que le sélecteur de langue de la topbar
  var langBtn = document.getElementById('mobile-nav-lang');
  if (langBtn) langBtn.addEventListener('click', function () {
    var lt = document.querySelector('.topbar .lang-toggle');
    if (lt) lt.click();
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 900 && drawer.classList.contains('open')) setOpen(false);
  });
})();
