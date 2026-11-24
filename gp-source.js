/* gp-source.js — StakeScreener (5 Nov 2026)
 * Primary PulseChain explorer: FusionScan (scan.pulsefusion.io).
 * Fallback: the official api.scan.pulsechain.com.
 * Loads BEFORE app.js and wraps window.fetch; app.js and wallets.js stay
 * unchanged. Every call to api.scan.pulsechain.com goes to FusionScan first
 * (same path and query); if it does not answer within 7 s, returns an HTTP error or
 * an error in the JSON (e.g. "Query Timeout"), the same call is repeated on the official one.
 * After 2 FusionScan errors in a row, everything goes straight to the official one for the rest of the visit -
 * except token lists, which always stay on FusionScan (see below). HTTP 5xx and timeouts are retried once first.
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

  // 24 Nov 2026: token lists (/token-balances) are never sent to the official explorer - it did not
  // answer them at all (>30 s) while its other calls worked. FusionScan answered 503 under load, so a
  // 503, a timeout or a network error is retried once on FusionScan after 1.5 s before giving up.
  var SEZNAM = /\/token-balances$/;
  var CAS_SEZNAM = 12000;

  window.fetch = function (vhod, opcije) {
    var url = typeof vhod === 'string' ? vhod : (vhod && vhod.url) || '';
    if (url.indexOf(URADNI) !== 0) return izvirni(vhod, opcije);
    var samoGlavni = SEZNAM.test(url.split('?')[0]);
    if (napake >= 2 && !samoGlavni) {
      if (!rezervaUporabljena) { rezervaUporabljena = true; oznaci(); }
      return izvirni(vhod, opcije);
    }
    var nov = GLAVNI + url.slice(URADNI.length);
    var zunanji = opcije && opcije.signal;
    var cas = samoGlavni ? CAS_SEZNAM : CAS_MS;

    function poskus(stevec) {
      var ac = new AbortController();
      if (zunanji) {
        if (zunanji.aborted) ac.abort();
        else zunanji.addEventListener('abort', function () { ac.abort(); }, { once: true });
      }
      var t = setTimeout(function () { ac.abort(); }, cas);
      var o = Object.assign({}, opcije || {}, { signal: ac.signal });

      function neuspeh(razlog, odgovor, ponovljivo) {
        clearTimeout(t);
        if (zunanji && zunanji.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        if (stevec === 0 && ponovljivo) {
          return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return poskus(1); });
        }
        if (samoGlavni) {
          console.warn('[gp-source] FusionScan: ' + razlog + ' \u2014 token list not available right now');
          return odgovor || Promise.reject(new Error(razlog));
        }
        napake++;
        rezervaUporabljena = true;
        oznaci();
        console.warn('[gp-source] FusionScan: ' + razlog + ' \u2014 using api.scan.pulsechain.com');
        return izvirni(vhod, opcije);
      }

      return izvirni(nov, o).then(function (r) {
        if (!r.ok) return neuspeh('HTTP ' + r.status, r, r.status >= 500);
        return r.clone().json().then(function (j) {
          if (slabJson(j)) return neuspeh(j.message || j.result || 'error', r, false);
          clearTimeout(t);
          napake = 0;
          return r;
        }, function () { return neuspeh('not JSON', r, false); });
      }, function (e) {
        return neuspeh(e && e.name === 'AbortError' ? 'no answer within ' + cas / 1000 + ' s' : (e && e.message) || 'network', null, true);
      });
    }
    return poskus(0);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', oznaci);
  else oznaci();
})();
