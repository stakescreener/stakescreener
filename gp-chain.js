/* gp-chain.js — tekoci trak cen (StakeScreener) (31. 10. 2026)
 *
 * SAMO videz. wallets.js izrise kartice cen v .eko-trak (ob vsakem izrisu
 * vsebino pocisti in narise znova). Ta skripta kartice zavije v .gp-tir in jih
 * enkrat podvoji, da trak tece brez preskoka (animacija do -50 %). Kopije so
 * aria-hidden in izven zaporedja tipke Tab. Ob novem izrisu se postopek ponovi.
 * Ce uporabnik v sistemu izklopi animacije (prefers-reduced-motion), trak stoji.
 */
(function () {
  'use strict';
  function uredi(t) {
    if (t.querySelector('.gp-tir')) return;
    var kartice = Array.prototype.slice.call(t.children).filter(function (c) {
      return c.classList && c.classList.contains('eko-card');
    });
    if (kartice.length < 3) return;
    var tir = document.createElement('div');
    tir.className = 'gp-tir';
    kartice.forEach(function (c) { tir.appendChild(c); });
    kartice.forEach(function (c) {
      var k = c.cloneNode(true);
      k.setAttribute('aria-hidden', 'true');
      k.classList.add('gp-kopija');
      Array.prototype.forEach.call(k.querySelectorAll('a'), function (a) { a.tabIndex = -1; });
      tir.appendChild(k);
    });
    t.appendChild(tir);
    t.classList.add('gp-tece');
  }
  function preglej() {
    var t = document.querySelector('.eko-trak');
    if (t) uredi(t);
  }
  if (window.MutationObserver) {
    new MutationObserver(preglej).observe(document.documentElement, { childList: true, subtree: true });
  }
  preglej();
})();
