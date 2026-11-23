/* gp-source.js — StakeScreener (5. 11. 2026)
 * Glavni raziskovalec za PulseChain: FusionScan (scan.pulsefusion.io).
 * Rezerva: uradni api.scan.pulsechain.com.
 * Nalozi se PRED app.js in ovije window.fetch; app.js in wallets.js ostaneta
 * nespremenjena. Vsak klic na api.scan.pulsechain.com gre najprej na FusionScan
 * (isto pot in poizvedbo); ce ta ne odgovori v 7 s, vrne HTTP napako ali
 * napako v JSON (npr. "Query Timeout"), se isti klic ponovi na uradnem.
 * Po 2 zaporednih napakah FusionScana gre do konca obiska vse naravnost na uradnega.
 * Vrnitev: odstrani <script src="./gp-source.js"> iz index.html.
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
      console.warn('[gp-vir] FusionScan: ' + razlog + ' — uporabljam api.scan.pulsechain.com');
      return izvirni(vhod, opcije);
    }

    return izvirni(nov, o).then(function (r) {
      if (!r.ok) return rezerva('HTTP ' + r.status);
      return r.clone().json().then(function (j) {
        if (slabJson(j)) return rezerva(j.message || j.result || 'napaka');
        clearTimeout(t);
        napake = 0;
        return r;
      }, function () { return rezerva('ni JSON'); });
    }, function (e) {
      return rezerva(e && e.name === 'AbortError' ? 'ni odgovora v 7 s' : (e && e.message) || 'omrezje');
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', oznaci);
  else oznaci();
})();
