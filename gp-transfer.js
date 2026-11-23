/* gp-transfer.js — StakeScreener (22 Nov 2026)
 * Imports saved settings from the previous site address. The browser keeps localStorage
 * SEPARATELY for each address, so on a visit the old site packs its keys into
 * #gp-prenos=… (the part after # is NOT sent to the server) and redirects here.
 * Only known keys are imported, and only if they do not exist here yet (newer ones are never overwritten).
 * Loads BEFORE app.js and wallets.js so they already see the imported data.
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
    if (n && window.console) console.info('StakeScreener: saved settings imported: ' + n);
  } catch (e) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  }
})();
