/* gp-prenos.js — StakeScreener (22. 11. 2026)
 * Uvoz shranjenih nastavitev s prejsnjega naslova strani. Brskalnik hrani localStorage
 * LOCENO za vsak naslov, zato stara stran ob obisku zapakira svoje kljuce v
 * #gp-prenos=… (del za # se NE poslje na streznik) in preusmeri sem.
 * Uvozimo samo znane kljuce in samo, ce tu se ne obstajajo (novejsih ne povozimo).
 * Nalozi se PRED app.js in denarnica.js, da ti ze vidijo uvozene podatke.
 */
(function () {
  var DOVOLJENI = ['gopulse_wallets', 'gopulse_labels', 'gopulse_custom_tokens',
                   'gopulse_validators', 'gopulse_collapsed', 'hsa_recent_addrs'];
  try {
    var h = (location.hash || '').replace(/^#/, '');
    var m = /(?:^|&)gp-prenos=([A-Za-z0-9_-]+)/.exec(h);
    if (!m) return;
    var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var json = decodeURIComponent(escape(atob(b64)));
    var data = JSON.parse(json);
    var n = 0;
    DOVOLJENI.forEach(function (k) {
      if (typeof data[k] === 'string' && data[k].length < 200000 && localStorage.getItem(k) === null) {
        localStorage.setItem(k, data[k]); n++;
      }
    });
    var ostanek = h.replace(/(?:^|&)gp-prenos=[A-Za-z0-9_-]+/, '').replace(/^&/, '');
    history.replaceState(null, '', location.pathname + location.search + (ostanek ? '#' + ostanek : ''));
    if (n) { try { localStorage.setItem('gopulse_podpora', 'prenos'); } catch (_) {} }
    if (n && window.console) console.info('StakeScreener: uvozenih shranjenih nastavitev: ' + n);
  } catch (e) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  }
})();
