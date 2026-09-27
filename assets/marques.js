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
