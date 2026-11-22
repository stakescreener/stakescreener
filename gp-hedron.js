/*
 * gp-hedron.js \u2014 StakeScreener: odsek "HEDRON Screener" (22. 11. 2026)
 *
 * Samo branje. Hedron (HDRN) 0x3819f64f282bf135d62168C1e513280dAF905e06, 9 decimalk, ista pogodba
 * na PulseChainu in Ethereumu. HDRN na voljo za stake = shari x (odsluzeni dnevi - ze prevzeti dnevi),
 * + launch bonus (shranjen pri staku) + dnevni bonus (dailyDataList). Formula je natanko tista iz
 * mintNative/mintInstanced in je bila preverjena 6/6 proti simulaciji (eth_call) pogodbe.
 * Staki pridejo iz HEX Stake Screenerja (ovijem renderAll); app.js in denarnica.js nespremenjena.
 */
(function () {
  'use strict';
  if (typeof renderAll !== 'function') return;

  var HDRN = '0x3819f64f282bf135d62168c1e513280daf905e06';
  var HEX = '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39';
  var RPC = {
    pls: ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'],
    eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  };
  var DEX = 'https://api.dexscreener.com/latest/dex/tokens/' + HDRN;
  var IME = { pls: 'PulseChain', eth: 'Ethereum' };
  var MAX_STAKOV = 300, MAX_PRIKAZ = 100;
  var SEL = {
    dan: '0x5c9302c9', share: '0xd4029727', dd: '0x6144a2d8', bal: '0x70a08231',
    loaned: '0x4552788a', supply: '0x18160ddd'
  };
  var K_LAB = 'gopulse_labels';

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function p64(x) { return BigInt(x).toString(16).padStart(64, '0'); }
  function pa(a) { return a.slice(2).toLowerCase().padStart(64, '0'); }
  function beseda(r, i) { return BigInt('0x' + (r || '0x').slice(2 + 64 * i, 2 + 64 * (i + 1)).padEnd(64, '0')); }
  function hdrn(b) { return Number(b) / 1e9; }
  function kompakt(n, dec) {
    if (n >= 1e12) return (n / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'T';
    if (n >= 1e9) return (n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B';
    if (n >= 1e6) return (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    if (n >= 1e3) return (n / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: dec == null ? 2 : dec });
  }
  function fH(b) { return kompakt(hdrn(b)); }
  function usd(n) {
    if (n == null || !isFinite(n)) return '';
    if (n > 0 && n < 0.01) return '<$0.01';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function kratko(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function oznaka(a) {
    try { var l = JSON.parse(localStorage.getItem(K_LAB) || '{}'); return (l && l[a.toLowerCase()]) || ''; } catch (e) { return ''; }
  }
  function klic(id, to, data) { return { jsonrpc: '2.0', id: id, method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }; }
  function rpc(chain, klici) {
    var urls = RPC[chain], i = 0;
    function poskus() {
      if (i >= urls.length) return Promise.reject(new Error('RPC ' + chain));
      var u = urls[i++];
      return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(klici) })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          if (!Array.isArray(j)) return Promise.reject();
          var po = {}; j.forEach(function (x) { po[x.id] = x.result; });
          if (klici.some(function (k) { return po[k.id] == null; })) return Promise.reject();
          return klici.map(function (k) { return po[k.id]; });
        })
        .catch(poskus);
    }
    return poskus();
  }
  function rpcVKosih(chain, klici) {
    var kosi = [], out = [];
    for (var i = 0; i < klici.length; i += 60) kosi.push(klici.slice(i, i + 60));
    return kosi.reduce(function (p, k) {
      return p.then(function () { return rpc(chain, k).then(function (r) { out = out.concat(r); }); });
    }, Promise.resolve()).then(function () { return out; });
  }
  function cena() {
    return fetch(DEX).then(function (r) { return r.json(); }).then(function (j) {
      var naj = {};
      (j.pairs || []).forEach(function (p) {
        if (!p.baseToken || p.baseToken.address.toLowerCase() !== HDRN) return;
        var ch = p.chainId === 'pulsechain' ? 'pls' : p.chainId === 'ethereum' ? 'eth' : null;
        if (!ch) return;
        var l = (p.liquidity && p.liquidity.usd) || 0, px = Number(p.priceUsd);
        if (isFinite(px) && (!naj[ch] || l > naj[ch].l)) naj[ch] = { l: l, px: px };
      });
      return { pls: naj.pls ? naj.pls.px : null, eth: naj.eth ? naj.eth.px : null };
    }).catch(function () { return { pls: null, eth: null }; });
  }

  /* ---------- branje + izracun po pogodbi ---------- */
  function preberi(stakes) {
    var poVerigi = { pls: [], eth: [] };
    stakes.forEach(function (s) { poVerigi[s.chain === 'eth' ? 'eth' : 'pls'].push(s); });
    var rez = { stake: [], denarnice: [], napake: [], cena: null };
    return cena().then(function (c) { rez.cena = c; }).then(function () {
      return ['pls', 'eth'].reduce(function (p, ch) {
        return p.then(function () {
          var ss = poVerigi[ch];
          if (!ss.length) return;
          var lastniki = [];
          ss.forEach(function (s) { if (lastniki.indexOf(s.owner) < 0) lastniki.push(s.owner); });
          // 1) dnevi in dnevni bonus
          return rpc(ch, [klic(0, HEX, SEL.dan), klic(1, HDRN, SEL.dan), klic(2, HDRN, SEL.loaned), klic(3, HDRN, SEL.supply)])
            .then(function (r0) {
              var hexDan = beseda(r0[0], 0), hDan = beseda(r0[1], 0), loaned = beseda(r0[2], 0), supply = beseda(r0[3], 0);
              var k = [klic(0, HDRN, SEL.dd + p64(hDan))], id = 1;
              lastniki.forEach(function (a) { k.push(klic(id++, HDRN, SEL.bal + pa(a))); });
              ss.forEach(function (s) { k.push(klic(id++, HDRN, SEL.share + p64(s.stakeId))); });
              return rpcVKosih(ch, k).then(function (r) {
                // dnevni bonus: shranjen za danes, sicer kot _dailyDataLoad (izposojeno > 50 % -> (x-50)*2)
                var dm = beseda(r[0], 4);
                if (beseda(r[0], 3) === 0n && loaned > 0n && supply > 0n) {
                  var x = (loaned * 100n) / supply;
                  dm = x > 50n ? (x - 50n) * 2n : 0n;
                }
                var j = 1;
                lastniki.forEach(function (a) { rez.denarnice.push({ chain: ch, a: a, bal: beseda(r[j++], 0), zdaj: 0n, naDan: 0n }); });
                ss.forEach(function (s) {
                  var sl = r[j++];
                  var sh = BigInt(s.stakeShares), L = BigInt(s.lockedDay), D = BigInt(s.stakedDays);
                  var ujema = beseda(sl, 0) === BigInt(s.stakeId) && beseda(sl, 1) === sh &&
                              beseda(sl, 2) === L && beseda(sl, 3) === D;
                  var prevzeti = ujema ? beseda(sl, 4) : 0n;
                  var lb = ujema ? beseda(sl, 5) : 0n;
                  var posojilo = ujema && beseda(sl, 10) !== 0n;
                  var odsluzeni = hexDan >= L ? (hexDan - L > D ? D : hexDan - L) : 0n;
                  function zBonusi(b) {
                    var p = b;
                    if (lb > 0n) p += (p * lb) / 10n;
                    if (dm > 0n) p += (p * dm) / 10n;
                    return p;
                  }
                  var dni = odsluzeni > prevzeti ? odsluzeni - prevzeti : 0n;
                  var zdaj = hexDan >= L ? zBonusi(sh * dni) : 0n;
                  var naDan = (hexDan >= L && odsluzeni < D) ? zBonusi(sh) : 0n;
                  var stanje = hexDan < L ? 'pending' : posojilo ? 'loan' : s.stakeType === 'HSI-T' ? 'tokenized' :
                               (odsluzeni >= D && dni === 0n) ? 'done' : 'ok';
                  rez.stake.push({ s: s, chain: ch, odsluzeni: Number(odsluzeni), prevzeti: Number(prevzeti),
                                   zdaj: zdaj, naDan: naDan, stanje: stanje });
                  var w = rez.denarnice.filter(function (x) { return x.a === s.owner && x.chain === ch; })[0];
                  if (w) { w.zdaj += zdaj; w.naDan += naDan; }
                });
              });
            }).catch(function (e) { rez.napake.push(IME[ch] + ': ' + (e && e.message || e)); });
        });
      }, Promise.resolve());
    }).then(function () { return rez; });
  }

  /* ---------- prikaz ---------- */
  var sec, statEl, denEl, tabEl;
  function zgradi() {
    sec = el('div', null); sec.id = 'gph-sec';
    var hdr = el('div', 'wbal-hdr gpv-hdr');
    hdr.appendChild(el('span', 'wbal-title', 'HEDRON'));
    hdr.appendChild(el('span', 'wbal-title2', 'Screener'));
    hdr.appendChild(el('span', 'gpv-veriga', 'HDRN'));
    sec.appendChild(hdr);
    statEl = el('div', 'wbal-note gpv-stanje'); sec.appendChild(statEl);
    denEl = el('div', 'gpc-den'); sec.appendChild(denEl);
    tabEl = el('div', 'gpv-tab'); sec.appendChild(tabEl);
    sec.appendChild(el('div', 'wbal-note gpv-opomba',
      'Read-only. Hedron (HDRN) can be minted against active HEX stakes: shares \u00d7 days served, minus days already ' +
      'minted (1 T-share = 1,000 HDRN per day). It accrues for the whole length of the stake \u2014 there is no deadline. ' +
      'Stakes with an open Hedron loan cannot mint until it is repaid; tokenized HSIs (NFTs) must be detokenized first. ' +
      'Figures follow the Hedron contract exactly; minting is done on hedron.pro, StakeScreener signs nothing. ' +
      'Informational only, not financial advice.'));
    sec.appendChild(el('div', 'gp-loc'));
    statEl.textContent = 'Hedron amounts appear after the HEX stakes below are loaded.';
  }
  function vstavi(n) {
    // za COMMUNIS Screener; ce ga po ~10 s ni, za Validator / Wallets
    var pred = document.getElementById('gpc-sec') || (n > 40 ? (document.getElementById('gpv-sec') || document.getElementById('wbal-sec')) : null);
    if (!pred || !pred.parentNode) return false;
    pred.parentNode.insertBefore(sec, pred.nextSibling);
    return true;
  }
  function vUsd(b, ch, c) { var px = c && c[ch]; return px ? usd(hdrn(b) * px) : ''; }
  function tShares(sh) { return kompakt(Number(sh) / 1e12, 3); }

  function risi(rez) {
    denEl.textContent = ''; tabEl.textContent = '';
    var c = rez.cena, vsi = rez.stake;
    var st = [vsi.length + ' active HEX stake' + (vsi.length === 1 ? '' : 's') + ' checked'];
    if (rez.napake.length) st.push('could not read: ' + rez.napake.join('; '));
    statEl.textContent = st.join(' \u00b7 ');

    rez.denarnice.forEach(function (w) {
      if (w.bal === 0n && w.zdaj === 0n && w.naDan === 0n) return;
      var k = el('div', 'gpc-k');
      var h = el('div', 'gpc-k-h', (oznaka(w.a) || kratko(w.a)) + ' \u00b7 ' + IME[w.chain]); h.title = w.a; k.appendChild(h);
      function vr(lbl, val, sub, cls) {
        var r = el('div', 'gpc-vr' + (cls ? ' ' + cls : ''));
        r.appendChild(el('span', null, lbl)); r.appendChild(el('b', null, val));
        if (sub) r.appendChild(el('em', null, sub));
        k.appendChild(r);
      }
      vr('HDRN in wallet', fH(w.bal), vUsd(w.bal, w.chain, c));
      vr('Available to mint now', fH(w.zdaj) + ' HDRN', vUsd(w.zdaj, w.chain, c), w.zdaj > 0n ? 'gpc-dobro' : '');
      vr('Accruing per day', fH(w.naDan) + ' HDRN', vUsd(w.naDan, w.chain, c));
      denEl.appendChild(k);
    });

    var prikaz = vsi.slice().sort(function (a, b) { return a.zdaj === b.zdaj ? 0 : (a.zdaj > b.zdaj ? -1 : 1); });
    var vec = prikaz.length > MAX_PRIKAZ ? prikaz.length - MAX_PRIKAZ : 0;
    prikaz = prikaz.slice(0, MAX_PRIKAZ);
    if (!prikaz.length) return;
    function tabela(vrste) {
      var ovoj = el('div', 'wbal-scroll gpv-scroll');
      var t = el('table', 'wbal-tbl gpv-tbl');
      var th = el('thead'), tr = el('tr');
      ['HEX stake', 'T-shares', 'Served / days', 'Minted days', 'Available now', 'Per day', 'Status', 'Wallet'].forEach(function (x) { tr.appendChild(el('th', null, x)); });
      th.appendChild(tr); t.appendChild(th);
      var tb = el('tbody');
      vrste.forEach(function (z) {
        var r = el('tr');
        var c0 = el('td', null, '#' + z.s.stakeId);
        c0.appendChild(el('span', 'gpv-mini', (z.chain === 'eth' ? 'ETH' : 'PLS') + (z.s.stakeType && z.s.stakeType !== 'Native' ? ' \u00b7 ' + z.s.stakeType : '')));
        r.appendChild(c0);
        r.appendChild(el('td', null, tShares(z.s.stakeShares)));
        r.appendChild(el('td', null, z.odsluzeni + ' / ' + z.s.stakedDays));
        r.appendChild(el('td', null, String(z.prevzeti)));
        var cz = el('td', null, z.zdaj > 0n ? fH(z.zdaj) : '\u2014'); cz.title = vUsd(z.zdaj, z.chain, c); r.appendChild(cz);
        r.appendChild(el('td', null, z.naDan > 0n ? fH(z.naDan) : '\u2014'));
        var m = { ok: ['mintable', 'akt'], loan: ['Hedron loan', 'izh'], tokenized: ['detokenize to mint', 'cak'],
                  done: ['fully minted', 'izs'], pending: ['pending', 'izs'] }[z.stanje];
        var cs = el('td'); cs.appendChild(el('span', 'gpv-st gpv-st-' + m[1], m[0])); r.appendChild(cs);
        var cw = el('td', 'gpv-kam', oznaka(z.s.owner) || kratko(z.s.owner)); cw.title = z.s.owner; r.appendChild(cw);
        tb.appendChild(r);
      });
      t.appendChild(tb); ovoj.appendChild(t);
      return ovoj;
    }
    tabEl.appendChild(tabela(prikaz.slice(0, 10)));
    if (prikaz.length > 10) {
      var det = el('details', 'wbal-more gpc-vec');
      det.appendChild(el('summary', null, 'Show ' + (prikaz.length - 10) + ' more stakes'));
      det.appendChild(tabela(prikaz.slice(10)));
      tabEl.appendChild(det);
    }
    if (vec) statEl.textContent += ' \u00b7 showing ' + MAX_PRIKAZ + ', ' + vec + ' more not shown';
  }

  /* ---------- povezava z HEX Stake Screenerjem ---------- */
  var zadnjiKljuc = null, tece = false, cakajoci = null;
  function obdelaj(stakes) {
    var akt = (stakes || []).filter(function (s) {
      var t = s.stakeType || 'Native';
      return (t === 'Native' || t === 'HSI-U' || t === 'HSI-T') && !s.unlockedDay && BigInt(s.stakeShares || 0) > 0n;
    }).slice(0, MAX_STAKOV);
    var kljuc = akt.map(function (s) { return (s.chain || 'pls') + s.stakeId; }).sort().join(',');
    if (kljuc === zadnjiKljuc) return;
    if (tece) { cakajoci = stakes; return; }
    zadnjiKljuc = kljuc;
    if (!akt.length) { statEl.textContent = 'No active HEX stakes in these wallets.'; denEl.textContent = ''; tabEl.textContent = ''; return; }
    tece = true;
    statEl.textContent = 'Reading Hedron for ' + akt.length + ' HEX stake' + (akt.length === 1 ? '' : 's') + '\u2026';
    preberi(akt).then(risi, function (e) { statEl.textContent = 'Could not read Hedron: ' + (e && e.message || e); })
      .then(function () { tece = false; if (cakajoci) { var c = cakajoci; cakajoci = null; obdelaj(c); } });
  }
  var izvirnik = renderAll;
  renderAll = function (stakes, liq) {
    var r = izvirnik.apply(this, arguments);
    try { if (sec) obdelaj(stakes); } catch (e) { /* prikaz HEX ostane kot v izvirniku */ }
    return r;
  };
  function zacni() {
    zgradi();
    var n = 0;
    (function cakaj() {
      if (vstavi(n)) {
        try { if (typeof lastStakes !== 'undefined' && lastStakes && lastStakes.length) obdelaj(lastStakes); } catch (e) {}
        return;
      }
      if (++n < 480) setTimeout(cakaj, 250);   // do 2 min (pocasno nalaganje)
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
