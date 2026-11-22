/*
 * gp-icosa.js \u2014 StakeScreener: odsek "ICOSA Screener" (22. 11. 2026)
 *
 * Samo branje. Icosa (ICSA) 0xfc4913214444aF5c715cc9F7b52655e788A569ed (9 decimalk), WAATSA (We Are All
 * the SA) 0x2520e62474ba3085693f856b3e93fa6c92a4ef48 \u2014 isti naslovi na PulseChainu in Ethereumu.
 *  - HDRN stake (en na naslov): prinasa ICSA.  ICSA stake (en na naslov): prinasa ICSA + HDRN.
 *    Zneski "ce koncas zdaj" so SIMULACIJA hdrnStakeEnd/icsaStakeEnd (eth_call z naslova lastnika,
 *    nic se ne zgodi) \u2014 natanko to, kar bi pogodba izplacala, vkljucno s kaznijo pred iztekom.
 *  - WAATSA NFT stake: ICSA = tocke x (nftPoolPayout[danes] - nftPoolPayout[zacetek]) / 1e18
 *    (formula iz nftStakeEnd, preverjena proti simulaciji). Kazni ni.
 * Denarnice iz Wallets Screenerja (gopulse_wallets). app.js in denarnica.js nespremenjena.
 */
(function () {
  'use strict';
  var ICSA = '0xfc4913214444af5c715cc9f7b52655e788a569ed';
  var WA = '0x2520e62474ba3085693f856b3e93fa6c92a4ef48';
  var HDRN = '0x3819f64f282bf135d62168c1e513280daf905e06';
  var RPC = {
    pls: ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'],
    eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  };
  var IME = { pls: 'PulseChain', eth: 'Ethereum' };
  var LAUNCH = 1645833600;   // Hedron/Icosa dan 0 (UTC)
  var MAX_NFT = 150;
  var SEL = {
    dan: '0x5c9302c9', bal: '0x70a08231', hS: '0x489a347f', iS: '0x86a99e4a',
    hEnd: '0x1f498005', iEnd: '0x900d58de', tob: '0x2f745c59', nft: '0xbcead218', nftPay: '0xeec0e91c'
  };
  var K_WAL = 'gopulse_wallets', K_LAB = 'gopulse_labels';

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function p64(x) { return BigInt(x).toString(16).padStart(64, '0'); }
  function pa(a) { return a.slice(2).toLowerCase().padStart(64, '0'); }
  function b(r, i) { return BigInt('0x' + (r || '0x').slice(2 + 64 * i, 2 + 64 * (i + 1)).padEnd(64, '0')); }
  function t9(x) { return Number(x) / 1e9; }
  function kompakt(n) {
    if (n >= 1e12) return (n / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'T';
    if (n >= 1e9) return (n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B';
    if (n >= 1e6) return (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    if (n >= 1e4) return (n / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2 });
  }
  function f9(x) { return kompakt(t9(x)); }
  function usd(n) {
    if (n == null || !isFinite(n)) return '';
    if (n > 0 && n < 0.01) return '<$0.01';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function datum(d) { return new Date((LAUNCH + Number(d) * 86400) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function kratko(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function beri(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function denarnice() {
    var a = beri(K_WAL, []);
    return Array.isArray(a) ? a.filter(function (x) { return /^0x[0-9a-fA-F]{40}$/.test(x); }).map(function (x) { return x.toLowerCase(); }) : [];
  }
  function oznaka(a) { var l = beri(K_LAB, {}); return (l && l[a]) || ''; }
  function klic(id, to, data, from) {
    var o = { to: to, data: data }; if (from) o.from = from;
    return { jsonrpc: '2.0', id: id, method: 'eth_call', params: [o, 'latest'] };
  }
  function rpc(chain, klici) {
    var urls = RPC[chain], i = 0;
    function poskus() {
      if (i >= urls.length) return Promise.reject(new Error('RPC ' + chain));
      return fetch(urls[i++], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(klici) })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          if (!Array.isArray(j)) return Promise.reject();
          var po = {}; j.forEach(function (x) { po[x.id] = x.result != null ? x.result : null; });
          return klici.map(function (k) { return po[k.id]; });
        }).catch(poskus);
    }
    return poskus();
  }
  function rpcVKosih(chain, klici) {
    var kosi = [], out = [];
    for (var i = 0; i < klici.length; i += 60) kosi.push(klici.slice(i, i + 60));
    return kosi.reduce(function (p, k) { return p.then(function () { return rpc(chain, k).then(function (r) { out = out.concat(r); }); }); }, Promise.resolve())
      .then(function () { return out; });
  }
  function cene() {
    function ena(tok) {
      return fetch('https://api.dexscreener.com/latest/dex/tokens/' + tok).then(function (r) { return r.json(); }).then(function (j) {
        var naj = {};
        (j.pairs || []).forEach(function (p) {
          if (!p.baseToken || p.baseToken.address.toLowerCase() !== tok) return;
          var ch = p.chainId === 'pulsechain' ? 'pls' : p.chainId === 'ethereum' ? 'eth' : null;
          if (!ch) return;
          var l = (p.liquidity && p.liquidity.usd) || 0, px = Number(p.priceUsd);
          if (isFinite(px) && (!naj[ch] || l > naj[ch].l)) naj[ch] = { l: l, px: px };
        });
        return { pls: naj.pls ? naj.pls.px : null, eth: naj.eth ? naj.eth.px : null };
      }).catch(function () { return { pls: null, eth: null }; });
    }
    return Promise.all([ena(ICSA), ena(HDRN)]).then(function (r) { return { icsa: r[0], hdrn: r[1] }; });
  }

  /* ---------- branje ---------- */
  function stake(r) { return { start: b(r, 0), cap: b(r, 1), pts: b(r, 2), akt: b(r, 3) !== 0n, amt: b(r, 6), min: b(r, 7) }; }
  function veriga(ch, wal) {
    var k = [klic(0, ICSA, SEL.dan)], id = 1;
    wal.forEach(function (a) {
      k.push(klic(id++, ICSA, SEL.bal + pa(a)));
      k.push(klic(id++, ICSA, SEL.hS + pa(a)));
      k.push(klic(id++, ICSA, SEL.iS + pa(a)));
      k.push(klic(id++, WA, SEL.bal + pa(a)));
    });
    return rpcVKosih(ch, k).then(function (r) {
      var dan = b(r[0], 0), j = 1, out = [];
      wal.forEach(function (a) {
        out.push({ chain: ch, a: a, dan: dan, bal: b(r[j], 0), hS: stake(r[j + 1]), iS: stake(r[j + 2]), nN: Number(b(r[j + 3], 0)), nfts: [] });
        j += 4;
      });
      // 2) simulacije koncev in seznam NFT
      var k2 = [], id2 = 0, ref = [];
      out.forEach(function (w) {
        if (w.hS.akt) { ref.push([w, 'hSim']); k2.push(klic(id2++, ICSA, SEL.hEnd, w.a)); }
        if (w.iS.akt) { ref.push([w, 'iSim']); k2.push(klic(id2++, ICSA, SEL.iEnd, w.a)); }
        for (var i = 0; i < Math.min(w.nN, MAX_NFT); i++) { ref.push([w, 'nftId']); k2.push(klic(id2++, WA, SEL.tob + pa(w.a) + p64(i))); }
      });
      if (!k2.length) return out;
      return rpcVKosih(ch, k2).then(function (r2) {
        r2.forEach(function (x, i) {
          var w = ref[i][0], kaj = ref[i][1];
          if (kaj === 'nftId') { if (x) w.nfts.push({ id: b(x, 0) }); }
          else w[kaj] = x;
        });
        // 3) NFT stake-i in tocke izplacila
        var vsiNft = [];
        out.forEach(function (w) { w.nfts.forEach(function (n) { vsiNft.push(n); }); });
        if (!vsiNft.length) return out;
        return rpcVKosih(ch, vsiNft.map(function (n, i) { return klic(i, ICSA, SEL.nft + p64(n.id)); })).then(function (r3) {
          var dnevi = {}; dnevi[String(dan)] = 1;
          r3.forEach(function (x, i) { var s = stake(x); vsiNft[i].s = s; if (s.akt) dnevi[String(s.cap)] = 1; });
          var seznam = Object.keys(dnevi);
          return rpcVKosih(ch, seznam.map(function (d, i) { return klic(i, ICSA, SEL.nftPay + p64(d)); })).then(function (r4) {
            var pp = {}; seznam.forEach(function (d, i) { pp[d] = b(r4[i], 0); });
            vsiNft.forEach(function (n) {
              n.icsa = n.s && n.s.akt ? (n.s.pts * (pp[String(dan)] - pp[String(n.s.cap)])) / (10n ** 18n) : 0n;
            });
            return out;
          });
        });
      });
    });
  }

  /* ---------- prikaz ---------- */
  var sec, statEl, vsebEl, zadnji = null, tece = false;
  function zgradi() {
    sec = el('div', null); sec.id = 'gpi-sec';
    var hdr = el('div', 'wbal-hdr gpv-hdr');
    hdr.appendChild(el('span', 'wbal-title', 'ICOSA'));
    hdr.appendChild(el('span', 'wbal-title2', 'Screener'));
    hdr.appendChild(el('span', 'gpv-veriga', 'ICSA \u00b7 HDRN \u00b7 WAATSA'));
    sec.appendChild(hdr);
    statEl = el('div', 'wbal-note gpv-stanje'); sec.appendChild(statEl);
    vsebEl = el('div', 'gpc-den'); sec.appendChild(vsebEl);
    sec.appendChild(el('div', 'wbal-note gpv-opomba',
      'Read-only. Icosa: a HDRN stake earns ICSA; an ICSA stake earns ICSA and HDRN (one of each per address). Ending ' +
      'before the minimum stake length (30\u2013360 days, by stake size) cuts both the reward and the principal in ' +
      'proportion to the days served \u2014 the figures above are a simulation of ending now, exactly as the contract would pay. ' +
      'WAATSA NFTs (from the 2022 launch event) earn ICSA with no penalty. Ending is done on icosa.pro, StakeScreener ' +
      'signs nothing. Informational only, not financial advice.'));
    sec.appendChild(el('div', 'gp-loc'));
  }
  function vstavi(n) {
    var pred = document.getElementById('gph-sec') || (n > 40 ? (document.getElementById('gpc-sec') || document.getElementById('gpv-sec') || document.getElementById('wbal-sec')) : null);
    if (!pred || !pred.parentNode) return false;
    pred.parentNode.insertBefore(sec, pred.nextSibling);
    return true;
  }
  function vUsd(x, px) { return px ? usd(t9(x) * px) : ''; }

  function kartica(w, c) {
    var pI = c.icsa[w.chain], pH = c.hdrn[w.chain], D = Number(w.dan);
    var k = el('div', 'gpc-k');
    var h = el('div', 'gpc-k-h', (oznaka(w.a) || kratko(w.a)) + ' \u00b7 ' + IME[w.chain]); h.title = w.a; k.appendChild(h);
    function vr(lbl, val, sub, cls) {
      var r = el('div', 'gpc-vr' + (cls ? ' ' + cls : ''));
      r.appendChild(el('span', null, lbl)); r.appendChild(el('b', null, val));
      if (sub) r.appendChild(el('em', null, sub));
      k.appendChild(r);
    }
    function podnaslov(t) { k.appendChild(el('div', 'gpi-pod', t)); }
    vr('ICSA in wallet', f9(w.bal), vUsd(w.bal, pI));
    function rokVr(s) {
      var prost = Number(s.cap + s.min);
      if (D >= prost) vr('Minimum length', s.min + ' days', 'served \u2713 \u2014 no penalty', 'gpc-dobro');
      else vr('Minimum length', s.min + ' days', 'penalty-free from ' + datum(prost) + ' (in ' + (prost - D) + ' days)', 'gpc-opoz-vr');
    }
    if (w.hS.akt) {
      podnaslov('HDRN stake');
      var s = w.hS, r = w.hSim;
      vr('Staked', f9(s.amt) + ' HDRN', [vUsd(s.amt, pH), 'since ' + datum(s.start)].filter(Boolean).join(' \u00b7 '));
      rokVr(s);
      if (r) {
        var pay = b(r, 0), penP = b(r, 1), penR = b(r, 2);
        vr('ICSA earned', f9(pay + penR) + ' ICSA', vUsd(pay + penR, pI), 'gpc-dobro');
        if (penP > 0n || penR > 0n)
          vr('If ended now', 'lose ' + f9(penP) + ' HDRN + ' + f9(penR) + ' ICSA', 'early-end penalty', 'gpc-slabo');
      }
    }
    if (w.iS.akt) {
      podnaslov('ICSA stake');
      var s2 = w.iS, r2 = w.iSim;
      vr('Staked', f9(s2.amt) + ' ICSA', [vUsd(s2.amt, pI), 'since ' + datum(s2.start)].filter(Boolean).join(' \u00b7 '));
      rokVr(s2);
      if (r2) {
        var pI2 = b(r2, 0), pH2 = b(r2, 1), penP2 = b(r2, 2), penI = b(r2, 3), penH = b(r2, 4);
        vr('Rewards earned', f9(pI2 + penI) + ' ICSA + ' + f9(pH2 + penH) + ' HDRN',
          [vUsd(pI2 + penI, pI), vUsd(pH2 + penH, pH)].filter(Boolean).join(' + '), 'gpc-dobro');
        if (penP2 > 0n || penI > 0n || penH > 0n)
          vr('If ended now', 'lose ' + f9(penP2) + ' ICSA principal + ' + f9(penI) + ' ICSA + ' + f9(penH) + ' HDRN', 'early-end penalty', 'gpc-slabo');
      }
    }
    var aktN = w.nfts.filter(function (n) { return n.s && n.s.akt; });
    if (aktN.length) {
      podnaslov('WAATSA NFT stakes');
      var sk = 0n, tocke = 0n;
      aktN.forEach(function (n) { sk += n.icsa; tocke += n.s.pts; });
      vr('NFTs', String(aktN.length) + (w.nN > MAX_NFT ? ' (first ' + MAX_NFT + ' of ' + w.nN + ')' : ''), 'launch value ' + usd(Number(tocke) / 1e6));
      vr('ICSA earned', f9(sk) + ' ICSA', [vUsd(sk, pI), 'no penalty'].filter(Boolean).join(' \u00b7 '), 'gpc-dobro');
    }
    return k;
  }

  function nalozi() {
    if (tece) return;
    var wal = denarnice();
    zadnji = localStorage.getItem(K_WAL);
    vsebEl.textContent = '';
    if (!wal.length) { statEl.textContent = 'Add a wallet above to see Icosa stakes and WAATSA NFTs.'; return; }
    tece = true;
    statEl.textContent = 'Reading Icosa\u2026';
    var c, rez = [], napake = [];
    cene().then(function (x) { c = x; })
      .then(function () {
        return ['pls', 'eth'].reduce(function (p, ch) {
          return p.then(function () {
            return veriga(ch, wal).then(function (o) { rez = rez.concat(o); }, function (e) { napake.push(IME[ch] + ': ' + (e && e.message || e)); });
          });
        }, Promise.resolve());
      })
      .then(function () {
        var z = rez.filter(function (w) { return w.hS.akt || w.iS.akt || w.nfts.some(function (n) { return n.s && n.s.akt; }) || w.bal > 0n; });
        var st = [];
        var nS = rez.filter(function (w) { return w.hS.akt; }).length + rez.filter(function (w) { return w.iS.akt; }).length;
        var nN = 0; rez.forEach(function (w) { nN += w.nfts.filter(function (n) { return n.s && n.s.akt; }).length; });
        st.push(nS + ' Icosa stake' + (nS === 1 ? '' : 's') + ' \u00b7 ' + nN + ' WAATSA NFT stake' + (nN === 1 ? '' : 's'));
        if (!z.length) st.push('no ICSA, Icosa stakes or WAATSA NFTs in these wallets');
        if (napake.length) st.push('could not read: ' + napake.join('; '));
        statEl.textContent = st.join(' \u00b7 ');
        z.forEach(function (w) { vsebEl.appendChild(kartica(w, c)); });
      })
      .catch(function (e) { statEl.textContent = 'Could not read Icosa: ' + (e && e.message || e); })
      .then(function () { tece = false; });
  }

  function zacni() {
    zgradi();
    var n = 0;
    (function cakaj() {
      if (vstavi(n)) {
        setTimeout(nalozi, 6000);   // po Wallets/Validator/Communis/Hedron, da RPC ni preobremenjen
        setInterval(function () { if (!tece && localStorage.getItem(K_WAL) !== zadnji) nalozi(); }, 5000);
        return;
      }
      if (++n < 480) setTimeout(cakaj, 250);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
