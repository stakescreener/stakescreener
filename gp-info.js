/* gp-info.js — Copy button for the address (StakeScreener, 22 Nov 2026) */
(function () {
  var b = document.getElementById('ii-kopiraj'), n = document.getElementById('ii-naslov');
  if (!b || !n) return;
  b.addEventListener('click', function () {
    var t = n.textContent.trim();
    var ok = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () {});
    else { var r = document.createRange(); r.selectNodeContents(n); var s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); ok(); } catch (e) {} }
  });
})();

/* Verify this site — compares the SHA-256 of files as the browser receives them with the public record on GitHub (22 Nov 2026) */
(function () {
  var gumb = document.getElementById('ii-preveri'), izid = document.getElementById('ii-izid');
  if (!gumb || !izid || !window.crypto || !crypto.subtle) return;
  var ZAPIS = 'https://raw.githubusercontent.com/stakescreener/stakescreener/main/sums.json';
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function hexOf(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  gumb.addEventListener('click', function () {
    gumb.disabled = true; izid.textContent = 'Downloading the published record…';
    fetch(ZAPIS + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('GitHub HTTP ' + r.status); return r.json();
    }).then(function (zapis) {
      var poti = Object.keys(zapis.files || {}).filter(function (p) { return (zapis.served || []).indexOf(p) >= 0; });
      var ok = [], slabo = [], napaka = [], i = 0;
      function naslednja() {
        if (i >= poti.length) return Promise.resolve();
        var p = poti[i++];
        izid.textContent = 'Checking ' + i + ' of ' + poti.length + ': ' + p;
        return fetch('/' + p + '?verify=' + Date.now(), { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer();
        }).then(function (b) { return crypto.subtle.digest('SHA-256', b); }).then(function (h) {
          (hexOf(h) === zapis.files[p] ? ok : slabo).push(p);
        }, function (e) { napaka.push(p + ' (' + e.message + ')'); }).then(naslednja);
      }
      return naslednja().then(function () {
        izid.textContent = '';
        var info = ok.indexOf('info.html') >= 0;
        var glava = el('div', 'ii-izid-h ' + (slabo.length ? 'slabo' : napaka.length ? 'delno' : 'dobro'),
          slabo.length ? '✗ ' + slabo.length + ' file(s) do NOT match the published source' :
          napaka.length ? '✓ ' + ok.length + ' of ' + poti.length + ' files match — ' + napaka.length + ' could not be downloaded' :
          '✓ All ' + ok.length + ' files match the published source');
        izid.appendChild(glava);
        izid.appendChild(el('div', 'ii-izid-p', 'Published record: ' + (zapis.commit ? 'commit ' + zapis.commit.slice(0, 12) + ', ' : '') + (zapis.generated || '')));
        if (info) izid.appendChild(el('div', 'ii-izid-p dobro', '✓ This page — including the support address — is the published version.'));
        if (slabo.length) {
          izid.appendChild(el('div', 'ii-izid-p slabo', 'Not matching: ' + slabo.join(', ') + '. Do not send anything to the support address and tell us at info@stakescreener.com.'));
        }
        if (napaka.length) izid.appendChild(el('div', 'ii-izid-p', 'Not downloaded (try again later): ' + napaka.join(', ')));
      });
    }).catch(function (e) {
      izid.textContent = 'Could not complete the check: ' + e.message;
    }).then(function () { gumb.disabled = false; });
  });
})();
