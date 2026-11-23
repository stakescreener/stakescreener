/* gp-chain.js — scrolling price ticker (StakeScreener) (31 Oct 2026)
 *
 * Appearance ONLY. wallets.js draws the price cards in .eko-trak (on every render
 * it clears the content and draws it again). This script wraps the cards in .gp-tir and
 * duplicates them once so the ticker runs without a jump (animation to -50 %). The copies
 * are aria-hidden and outside the Tab key order. On every new render this repeats.
 * If the user turns animations off in the system (prefers-reduced-motion), the ticker stands still.
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
