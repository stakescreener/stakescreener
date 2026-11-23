/*
 * gp-support.js — StakeScreener (22. 11. 2026)
 * Enkratno, nevsiljivo okno "Support the project": pokaze se, ko je prva denarnica
 * dodana in so njeni rezultati nalozeni (+ nekaj sekund). Samo enkrat na brskalnik
 * (localStorage gopulse_podpora). Ne zakrije strani. app.js in wallets.js nespremenjena.
 */
(function () {
  'use strict';
  var KLJUC = 'gopulse_podpora';
  var ZAMIK = 4000;
  function prebrano() { try { return localStorage.getItem(KLJUC); } catch (e) { return 'x'; } }
  function zapisi(v) { try { localStorage.setItem(KLJUC, v); } catch (e) {} }
  if (prebrano()) return;

  var cakam = false, opazovalec = null;

  function nalozeno() {
    if (!document.querySelector('#wbal-sec .wbal-wallet')) return false;
    var t = document.querySelectorAll('#wbal-sec .wbal-total');
    for (var i = 0; i < t.length; i++) if (/loading/i.test(t[i].textContent)) return false;
    return true;
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  }

  function pokazi() {
    if (prebrano() || !nalozeno()) { cakam = false; return; }
    zapisi('prikazano');
    if (opazovalec) opazovalec.disconnect();

    var box = el('div', 'gp-podpora');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Support the project');
    var x = el('button', 'gp-podpora-x', '×');
    x.type = 'button'; x.setAttribute('aria-label', 'Close');
    var h = el('div', 'gp-podpora-h', 'Enjoying StakeScreener?');
    var p = el('p', 'gp-podpora-p', 'It’s free, read-only and ad-free. If it’s useful to you, you can support hosting and development.');
    var vr = el('div', 'gp-podpora-gumbi');
    var da = el('a', 'gp-podpora-da', 'Support the project');
    da.href = '/info.html#support';
    var ne = el('button', 'gp-podpora-ne', 'Not now');
    ne.type = 'button';
    vr.appendChild(da); vr.appendChild(ne);
    box.appendChild(x); box.appendChild(h); box.appendChild(p); box.appendChild(vr);
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add('on'); });

    function zapri(v) {
      zapisi(v);
      box.classList.remove('on');
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 300);
      document.removeEventListener('keydown', esc);
    }
    function esc(e) { if (e.key === 'Escape') zapri('zaprto'); }
    x.addEventListener('click', function () { zapri('zaprto'); });
    ne.addEventListener('click', function () { zapri('zaprto'); });
    da.addEventListener('click', function () { zapisi('podpora'); });
    document.addEventListener('keydown', esc);
  }

  function preveri() {
    if (cakam || !nalozeno()) return;
    cakam = true;
    setTimeout(pokazi, ZAMIK);
  }

  function zacni() {
    preveri();
    opazovalec = new MutationObserver(preveri);
    opazovalec.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
