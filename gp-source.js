/* gp-source.js — StakeScreener (5 Nov 2026)
 * Primary PulseChain explorer: FusionScan (scan.pulsefusion.io).
 * Fallback: the official api.scan.pulsechain.com.
 * Loads BEFORE app.js and wraps window.fetch; app.js and wallets.js stay
 * unchanged. Every call to api.scan.pulsechain.com goes to FusionScan first
 * (same path and query); if it does not answer within 7 s, returns an HTTP error or
 * an error in the JSON (e.g. "Query Timeout"), the same call is repeated on the official one.
 * After 2 FusionScan errors in a row, everything goes straight to the official one for the rest of the visit.
 * Rollback: remove <script src="./gp-source.js"> from index.html.
 */
(function () {
  'use strict';
  var URADNI = 'https://api.scan.pulsechain.com/';
  var GLAVNI = 'https://scan.pulsefusion.io/';
  var CAS_MS = 7000;
  var napake = 0;
  var rezervaUporabljena = false;
  var izvirni = window.fetch.bind(window);

  function oznaci() {
    var el = document.getElementById('gp-vir');
    if (!el) return;
    el.textContent = rezervaUporabljena
      ? 'PulseChain data: api.scan.pulsechain.com (backup, FusionScan did not answer)'
      : 'PulseChain data: FusionScan (scan.pulsefusion.io), backup api.scan.pulsechain.com';
  }

  function slabJson(j) {
    if (!j || Array.isArray(j) || typeof j !== 'object') return false;
    if (j.status === '0') {
      return !(j.message === 'No records found' || j.message === 'No logs found');
    }
    return false;
  }

  window.fetch = function (vhod, opcije) {
    var url = typeof vhod === 'string' ? vhod : (vhod && vhod.url) || '';
    if (url.indexOf(URADNI) !== 0 || napake >= 2) {
      if (url.indexOf(URADNI) === 0 && !rezervaUporabljena) { rezervaUporabljena = true; oznaci(); }
      return izvirni(vhod, opcije);
    }
    var nov = GLAVNI + url.slice(URADNI.length);
    var ac = new AbortController();
    var zunanji = opcije && opcije.signal;
    if (zunanji) {
      if (zunanji.aborted) ac.abort();
      else zunanji.addEventListener('abort', function () { ac.abort(); }, { once: true });
    }
    var t = setTimeout(function () { ac.abort(); }, CAS_MS);
    var o = Object.assign({}, opcije || {}, { signal: ac.signal });

    function rezerva(razlog) {
      clearTimeout(t);
      if (zunanji && zunanji.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      napake++;
      rezervaUporabljena = true;
      oznaci();
      console.warn('[gp-source] FusionScan: ' + razlog + ' — using api.scan.pulsechain.com');
      return izvirni(vhod, opcije);
    }

    return izvirni(nov, o).then(function (r) {
      if (!r.ok) return rezerva('HTTP ' + r.status);
      return r.clone().json().then(function (j) {
        if (slabJson(j)) return rezerva(j.message || j.result || 'error');
        clearTimeout(t);
        napake = 0;
        return r;
      }, function () { return rezerva('not JSON'); });
    }, function (e) {
      return rezerva(e && e.name === 'AbortError' ? 'no answer within 7 s' : (e && e.message) || 'network');
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', oznaci);
  else oznaci();
})();
