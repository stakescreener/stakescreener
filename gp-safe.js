/*
 * gp-safe.js - StakeScreener: Safe (Gnosis Safe / Staker app smart account) badge, 27 Nov 2026
 *
 * Read-only. For every address in the Wallets Screener it checks on PulseChain and Ethereum
 * whether the address is a Safe contract (getOwners / getThreshold). If it is, a badge
 * "SAFE . PLS 1 of 2 . ETH 1 of 2" is added next to the Rename button; a click shows the owners
 * (with the wallet names from this list where they are known). An owner that is NOT in the
 * wallet list is pointed out, because with threshold 1 any single owner can move the funds
 * and end the stakes. Staker app "smart accounts" are such Safes.
 * app.js and wallets.js stay unchanged.
 */
(function () {
  'use strict';
  var RPC = {
    pls: ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'],
    eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  };
  var KRATKO = { pls: 'PLS', eth: 'ETH' };
  var SEL_OWNERS = '0xa0e67e2b', SEL_THRESHOLD = '0xe75235b8';
  var K_WAL = 'gopulse_wallets', K_LAB = 'gopulse_labels';
  var pomnilnik = {};   // address -> Promise of { pls: {owners, threshold} | null, eth: ... }

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function beri(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function kratko(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function denarnice() {
    var a = beri(K_WAL, []);
    return Array.isArray(a) ? a.filter(function (x) { return /^0x[0-9a-fA-F]{40}$/.test(x); }) : [];
  }
  function oznaka(a) {
    var l = beri(K_LAB, {}) || {};
    return l[a] || l[a.toLowerCase()] || Object.keys(l).reduce(function (r, k) { return r || (k.toLowerCase() === a.toLowerCase() ? l[k] : ''); }, '');
  }

  function rpc(chain, klici) {
    var urls = RPC[chain], i = 0;
    function poskus() {
      if (i >= urls.length) return Promise.reject(new Error('RPC ' + chain));
      var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 10000);
      return fetch(urls[i++], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(klici), signal: ac.signal })
        .then(function (r) { clearTimeout(t); return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          if (!Array.isArray(j)) return Promise.reject();
          var po = {}; j.forEach(function (x) { po[x.id] = x.result != null ? x.result : null; });
          return klici.map(function (k) { return po[k.id]; });
        }).catch(poskus);
    }
    return poskus();
  }

  function preberi(chain, a) {
    return rpc(chain, [
      { jsonrpc: '2.0', id: 0, method: 'eth_getCode', params: [a, 'latest'] },
      { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: a, data: SEL_OWNERS }, 'latest'] },
      { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: a, data: SEL_THRESHOLD }, 'latest'] }
    ]).then(function (r) {
      if (!r[0] || r[0] === '0x' || !r[1] || r[1].length < 130 || !r[2] || r[2].length < 66) return null;
      var n = parseInt(r[1].slice(66, 130), 16), owners = [];
      if (!(n > 0 && n < 50)) return null;
      for (var i = 0; i < n; i++) owners.push('0x' + r[1].slice(130 + 64 * i + 24, 130 + 64 * (i + 1)));
      var th = parseInt(r[2].slice(2), 16);
      if (!(th > 0 && th <= n)) return null;
      return { owners: owners, threshold: th };
    }).catch(function () { return null; });
  }

  function podatki(a) {
    var k = a.toLowerCase();
    if (!pomnilnik[k]) {
      pomnilnik[k] = Promise.all([preberi('pls', a), preberi('eth', a)]).then(function (r) { return { pls: r[0], eth: r[1] }; });
    }
    return pomnilnik[k];
  }

  function znacka(hdr, a, d) {
    if (hdr.querySelector('.gp-safe')) return;
    var verige = ['pls', 'eth'].filter(function (c) { return d[c]; });
    if (!verige.length) return;
    var moje = denarnice().map(function (x) { return x.toLowerCase(); });
    var tuji = {};
    verige.forEach(function (c) { d[c].owners.forEach(function (o) { if (moje.indexOf(o.toLowerCase()) < 0) tuji[o.toLowerCase()] = 1; }); });
    var nTuji = Object.keys(tuji).length;
    var b = el('button', 'gp-safe' + (nTuji ? ' gp-safe-tuj' : ''),
      'SAFE \u00b7 ' + verige.map(function (c) { return KRATKO[c] + ' ' + d[c].threshold + ' of ' + d[c].owners.length; }).join(' \u00b7 ') +
      (nTuji ? ' \u00b7 ' + nTuji + ' owner' + (nTuji === 1 ? '' : 's') + ' not in your list' : ''));
    b.type = 'button';
    b.title = 'Smart account (Safe contract). Click to show its owners.';
    b.addEventListener('click', function () {
      var box = hdr.parentNode, det = box && box.querySelector('.gp-safe-det');
      if (det) { det.parentNode.removeChild(det); return; }
      det = el('div', 'gp-safe-det');
      verige.forEach(function (c) {
        var v = el('div', null);
        v.appendChild(el('b', null, KRATKO[c] + ': '));
        v.appendChild(document.createTextNode(d[c].threshold + ' of ' + d[c].owners.length + ' signatures needed \u2014 owners: '));
        d[c].owners.forEach(function (o, i) {
          var ime = oznaka(o), tuj = moje.indexOf(o.toLowerCase()) < 0;
          var s = el('span', tuj ? 'gp-safe-o gp-safe-o-tuj' : 'gp-safe-o', (ime ? ime + ' ' : '') + kratko(o) + (tuj ? ' (not in your list)' : ''));
          s.title = o;
          if (i) v.appendChild(document.createTextNode(', '));
          v.appendChild(s);
        });
        det.appendChild(v);
      });
      var op = el('div', 'gp-safe-op',
        'A Safe is a contract wallet: its HEX stakes and tokens are controlled by the owners above. ' +
        (verige.some(function (c) { return d[c].threshold === 1 && d[c].owners.length > 1; })
          ? 'With a threshold of 1, each owner alone can move the funds and end the stakes \u2014 make sure you know every owner.'
          : ''));
      det.appendChild(op);
      if (hdr.nextSibling) box.insertBefore(det, hdr.nextSibling); else box.appendChild(det);
    });
    var mini = hdr.querySelector('.wbal-mini');
    if (mini && mini.nextSibling) hdr.insertBefore(b, mini.nextSibling); else hdr.appendChild(b);
  }

  function obdelaj() {
    var sec = document.getElementById('wbal-sec'); if (!sec) return;
    var wal = denarnice(); if (!wal.length) return;
    var po = {}; wal.forEach(function (a) { po[kratko(a).toLowerCase()] = a; });
    [].slice.call(sec.querySelectorAll('.wbal-wallet-hdr')).forEach(function (hdr) {
      if (hdr.querySelector('.gp-safe') || hdr.getAttribute('data-gp-safe') === 'ne') return;
      var ae = hdr.querySelector('.wbal-addr'); if (!ae) return;
      var a = po[(ae.textContent || '').trim().toLowerCase()]; if (!a) return;
      podatki(a).then(function (d) {
        if (!d.pls && !d.eth) { hdr.setAttribute('data-gp-safe', 'ne'); return; }
        znacka(hdr, a, d);
      });
    });
  }

  function zacni() {
    var t = null, n = 0;
    (function cakaj() {
      var sec = document.getElementById('wbal-sec');
      if (sec) {
        new MutationObserver(function () { clearTimeout(t); t = setTimeout(obdelaj, 400); }).observe(sec, { childList: true, subtree: true });
        obdelaj();
        return;
      }
      if (++n < 480) setTimeout(cakaj, 250);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
