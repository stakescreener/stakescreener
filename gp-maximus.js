/*
 * gp-maximus.js - StakeScreener: "MAXIMUS Screener" section (24 Nov 2026)
 *
 * Read-only. Maximus DAO pooled HEX stakes - the same contracts on PulseChain and Ethereum
 * (separate state on each chain since the fork):
 *   MAXI  0x0d86EB9f43C57f6FF3BC9E23D8F9d82503f0e84b  one 5555-day stake, redeemable after it ends
 *   BASE  0xe9f84d418B008888A992Ff8c6D22389C2C3504e0  perpetual pool, 369-day stakes
 *   TRIO  0xF55cD1e399e1cc3D95303048897a680be3313308  perpetual pool, 1111-day stakes
 *   LUCKY 0x6B0956258fF7bd7645aa35369B55B61b8e6d6140  perpetual pool, 2555-day stakes
 *   DECI  0x6b32022693210cd2cfc466b9ac0085de8fc34ea6  perpetual pool, 3696-day stakes
 *   TEAM  0xb7c9e99da8a857ce576a830a9c19312114d9de02  TEAM token (balance and staked amount only)
 *
 * HEX backing per token = (HEX in the pool + principal + yield to date - TEAM share) / supply.
 *  - yield to date: sum over the stake's days of shares x payout / sharesTotal from HEX dailyDataRange,
 *    exactly as HEX calculates the payout of a stake (verified 4/4 against StakeEnd events since the fork:
 *    BASE x3, TRIO x1, difference 0 hearts);
 *  - TEAM share (perpetual pools only): half of the Bigger Pays Better part of the earnings, the same
 *    integer formula as get_bonus_sharing_amount() in PerpetualPool (verified 4/4 against the HEX transfer
 *    to the TEAM contract in the same transactions);
 *  - MAXI has no TEAM share; its HDRN is redeemable too (getHedronRedemptionRate).
 * During a reload phase the contract's own HEX_REDEMPTION_RATE is shown (redeemable now).
 * Always shown: wallet cards for holders, plus an overview table of all pools. NOT added to TOTAL: the tokens are already
 * counted in the Wallets Screener at their DEX price. app.js and wallets.js unchanged.
 */
(function () {
  'use strict';
  var HEX = '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39';
  var HDRN = '0x3819f64f282bf135d62168c1e513280daf905e06';
  var TEAM = '0xb7c9e99da8a857ce576a830a9c19312114d9de02';
  var POOLS = [
    { t: 'MAXI', a: '0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b', maxi: true },
    { t: 'BASE', a: '0xe9f84d418b008888a992ff8c6d22389c2c3504e0' },
    { t: 'TRIO', a: '0xf55cd1e399e1cc3d95303048897a680be3313308' },
    { t: 'LUCKY', a: '0x6b0956258ff7bd7645aa35369b55b61b8e6d6140' },
    { t: 'DECI', a: '0x6b32022693210cd2cfc466b9ac0085de8fc34ea6' }
  ];
  var RPC = {
    pls: ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'],
    eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  };
  var IME = { pls: 'PulseChain', eth: 'Ethereum' };
  var DS = { pls: 'pulsechain', eth: 'ethereum' };
  var ZAGON = Date.UTC(2019, 11, 3);   // HEX day 0
  var SEL = {
    bal: '0x70a08231', sup: '0x18160ddd', dan: '0x5c9302c9', glob: '0xc3124525', cnt: '0x33060d90',
    list: '0x2607443b', range: '0x6a210a0e', akt: '0xb7241ba5', konec: '0x3d720dda', relEnd: '0x1d92803d',
    rate: '0x6a63ef6e', dolz: '0xb4a2bc0e', mEnd: '0x751279b9', mHdrn: '0x1f09a771', mRate: '0xe9ffdf0b',
    tStaked: '0x019cca4b'
  };
  var K_WAL = 'gopulse_wallets', K_LAB = 'gopulse_labels';
  var E8 = 100000000n;

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function p64(x) { return BigInt(x).toString(16).padStart(64, '0'); }
  function pa(a) { return a.slice(2).toLowerCase().padStart(64, '0'); }
  function b(r, i) { return BigInt('0x' + (r || '0x').slice(2 + 64 * i, 2 + 64 * (i + 1)).padEnd(64, '0')); }
  function kompakt(n) {
    if (n >= 1e12) return (n / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'T';
    if (n >= 1e9) return (n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B';
    if (n >= 1e6) return (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    if (n >= 1e4) return (n / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2 });
  }
  function t8(x) { return Number(x) / 1e8; }
  function usd(n) {
    if (n == null || !isFinite(n)) return '';
    if (n > 0 && n < 0.01) return '<$0.01';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function datum(d) { return new Date(ZAGON + Number(d) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function kratko(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function beri(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function denarnice() {
    var a = beri(K_WAL, []);
    return Array.isArray(a) ? a.filter(function (x) { return /^0x[0-9a-fA-F]{40}$/.test(x); }).map(function (x) { return x.toLowerCase(); }) : [];
  }
  function oznaka(a) { var l = beri(K_LAB, {}); return (l && l[a]) || ''; }
  function klic(id, to, data) { return { jsonrpc: '2.0', id: id, method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }; }
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
  // DexScreener /tokens/v1 is scoped to one chain: deepest pool per token (price and its liquidity)
  function cene(ch) {
    var adr = POOLS.map(function (p) { return p.a; }).concat([TEAM, HEX, HDRN]);
    return fetch('https://api.dexscreener.com/tokens/v1/' + DS[ch] + '/' + adr.join(','))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (arr) {
        var naj = {};
        (Array.isArray(arr) ? arr : []).forEach(function (p) {
          if (!p || !p.baseToken) return;
          var a = p.baseToken.address.toLowerCase(), l = (p.liquidity && p.liquidity.usd) || 0, px = Number(p.priceUsd);
          if (isFinite(px) && px > 0 && (!naj[a] || l > naj[a].l)) naj[a] = { l: l, px: px };
        });
        return naj;
      }).catch(function () { return {}; });
  }

  /* ---------- calculations as in the contracts ---------- */
  // PerpetualPool.get_bonus_sharing_amount(): half of the Bigger Pays Better part of the earnings goes to TEAM
  function delezTeam(principal, endValue, dolzina) {
    var th = 150000000n * E8, bpb, lm;
    if (principal > th) bpb = principal / 10n;
    else bpb = principal * ((E8 * principal) / (10n * th)) / E8;
    if (dolzina > 3650n) lm = 2n * E8; else lm = 2n * (E8 * dolzina) / 3650n;
    var lpb = principal * lm / E8;
    if (endValue <= principal) return 0n;
    var mk = (E8 * bpb) / (bpb + principal + lpb);
    return ((endValue - principal) * mk / E8) / 2n;
  }
  // HEX dailyData entry: payoutTotal = bits 0..71, stakeSharesTotal = bits 72..143
  function donos(rr, shares) {
    if (!rr || rr.length < 130) return 0n;
    var n = Number(b(rr, 1)), vs = 0n, M = (1n << 72n) - 1n;
    for (var i = 0; i < n; i++) {
      var d = b(rr, 2 + i), pay = d & M, sh = (d >> 72n) & M;
      if (sh > 0n) vs += shares * pay / sh;
    }
    return vs;
  }

  /* ---------- reading ---------- */
  function veriga(ch, wal) {
    var k = [klic(0, HEX, SEL.dan), klic(1, HEX, SEL.glob)], id = 2;
    POOLS.forEach(function (p) {
      p.id0 = id;
      k.push(klic(id++, p.a, SEL.sup));
      k.push(klic(id++, HEX, SEL.bal + pa(p.a)));
      k.push(klic(id++, HEX, SEL.cnt + pa(p.a)));
      k.push(klic(id++, HEX, SEL.list + pa(p.a) + p64(0)));
      if (p.maxi) {
        k.push(klic(id++, p.a, SEL.mEnd));
        k.push(klic(id++, p.a, SEL.mRate));
        k.push(klic(id++, p.a, SEL.mHdrn));
        k.push(klic(id++, HDRN, SEL.bal + pa(p.a)));
      } else {
        k.push(klic(id++, p.a, SEL.akt));
        k.push(klic(id++, p.a, SEL.konec));
        k.push(klic(id++, p.a, SEL.relEnd));
        k.push(klic(id++, p.a, SEL.rate));
      }
    });
    var wId = id;
    wal.forEach(function (a) {
      POOLS.forEach(function (p) { k.push(klic(id++, p.a, SEL.bal + pa(a))); });
      k.push(klic(id++, TEAM, SEL.bal + pa(a)));
      k.push(klic(id++, TEAM, SEL.tStaked + pa(a)));
    });
    return rpcVKosih(ch, k).then(function (r) {
      var dan = b(r[0], 0), ddc = b(r[1], 4);
      var pools = {};
      POOLS.forEach(function (p) {
        var j = p.id0, x = { t: p.t, a: p.a, maxi: !!p.maxi, sup: b(r[j], 0), hexBal: b(r[j + 1], 0), nSt: b(r[j + 2], 0) };
        var sl = r[j + 3];
        x.st = x.nSt > 0n ? { hearts: b(sl, 1), shares: b(sl, 2), locked: b(sl, 3), days: b(sl, 4) } : null;
        if (p.maxi) {
          x.konec = b(r[j + 4], 0); x.rate = b(r[j + 5], 0); x.hdrnRate = b(r[j + 6], 0); x.hdrnBal = b(r[j + 7], 0);
          x.akt = !!x.st;
        } else {
          x.akt = b(r[j + 4], 0) !== 0n; x.konec = b(r[j + 5], 0); x.relEnd = b(r[j + 6], 0); x.rate = b(r[j + 7], 0);
        }
        pools[p.t] = x;
      });
      var hold = [], j = wId;
      wal.forEach(function (a) {
        var h = { chain: ch, a: a, t: {} };
        POOLS.forEach(function (p) { h.t[p.t] = b(r[j++], 0); });
        h.team = b(r[j++], 0); h.teamSt = b(r[j++], 0);
        hold.push(h);
      });
      var rabi = {};
      POOLS.forEach(function (p) { rabi[p.t] = 1; });   // all pools: the overview table is shown even without holdings
      // yield to date for the active stakes of the pools someone holds
      var k2 = [], ref = [];
      Object.keys(rabi).forEach(function (t, i) {
        var x = pools[t];
        if (x.akt && x.st && ddc > x.st.locked) {
          var konecD = x.st.locked + x.st.days < ddc ? x.st.locked + x.st.days : ddc;
          ref.push(x); k2.push(klic(i, HEX, SEL.range + p64(x.st.locked) + p64(konecD)));
          x.doDne = konecD;
        }
      });
      var nadalje = k2.length ? rpc(ch, k2) : Promise.resolve([]);
      return nadalje.then(function (r2) {
        r2.forEach(function (rr, i) { ref[i].donos = donos(rr, ref[i].st.shares); });
        POOLS.forEach(function (p) {
          var x = pools[p.t];
          if (!x.sup) { x.podloga = null; return; }
          if (!x.akt) { x.podloga = x.rate; x.odprto = true; return; }      // reload phase: the contract's own rate, redeemable now
          if (x.donos == null) { x.podloga = null; return; }
          var endV = x.hexBal + x.st.hearts + x.donos;
          var team = x.maxi ? 0n : delezTeam(x.st.hearts, endV, x.st.days);
          x.team = team;
          x.podloga = (endV - team) * E8 / x.sup;
        });
        return { ch: ch, dan: dan, pools: pools, hold: hold };
      });
    });
  }

  /* ---------- display ---------- */
  var sec, statEl, vsebEl, tabEl, zadnji = null, tece = false;
  function zgradi() {
    sec = el('div', null); sec.id = 'gpm-sec';
    var hdr = el('div', 'wbal-hdr gpv-hdr');
    hdr.appendChild(el('span', 'wbal-title', 'MAXIMUS'));
    hdr.appendChild(el('span', 'wbal-title2', 'Screener'));
    hdr.appendChild(el('span', 'gpv-veriga', 'MAXI \u00b7 BASE \u00b7 TRIO \u00b7 LUCKY \u00b7 DECI \u00b7 TEAM'));
    sec.appendChild(hdr);
    statEl = el('div', 'wbal-note gpv-stanje'); sec.appendChild(statEl);
    vsebEl = el('div', 'gpc-den'); sec.appendChild(vsebEl);
    tabEl = el('div', 'gpv-tab gpm-tab'); sec.appendChild(tabEl);
    var op = el('div', 'wbal-note gpv-opomba');
    op.appendChild(document.createTextNode(
      'Read-only. Maximus pools are shared HEX stakes: each token is a claim on the pool\u2019s HEX. ' +
      'HEX backing = principal + yield to date, minus the TEAM share (half of the Bigger Pays Better bonus on BASE, TRIO, LUCKY and DECI), ' +
      'divided by the token supply \u2014 calculated from the HEX contract the same way the pool contract does at the end of a stake. ' +
      'The full HEX value can only be redeemed in the pool\u2019s next redeem window (MAXI: after its stake ends); ' +
      'before that the only exit is a DEX sale, where pools are often thin and the price can differ a lot from the backing. ' +
      'These tokens are already counted in the Wallets Screener at their DEX price, so nothing here is added to the total. ' +
      'TEAM: balance and staked amount only; TEAM rewards are claimed on '));
    var a = el('a', null, 'maximusdao.com'); a.href = 'https://www.maximusdao.com/'; a.target = '_blank'; a.rel = 'noopener';
    op.appendChild(a);
    op.appendChild(document.createTextNode(' (official site). Informational only, not financial advice.'));
    sec.appendChild(op);
    sec.appendChild(el('div', 'gp-loc'));
  }
  function vstavi(n) {
    var pred = document.getElementById('gpi-sec') || (n > 40 ? (document.getElementById('gph-sec') || document.getElementById('gpc-sec') || document.getElementById('gpv-sec') || document.getElementById('wbal-sec')) : null);
    if (!pred || !pred.parentNode) return false;
    pred.parentNode.insertBefore(sec, pred.nextSibling);
    return true;
  }
  function okno(x, dan) {
    if (x.maxi) {
      if (!x.akt) return 'redeemable now';
      var d = x.konec + 1n;
      return 'redeemable after the stake ends: ' + datum(d) + ' (in ' + (d - dan) + ' days)';
    }
    if (x.odprto) return dan <= x.relEnd ? 'redeem window OPEN until ' + datum(x.relEnd) : 'stake not started yet';
    var od = x.konec + 1n;
    if (dan >= od) return 'stake can be ended now \u2014 window opens when someone ends it';
    return 'next redeem window: ' + datum(od) + ' (in ' + (od - dan) + ' days)';
  }
  function premija(px, pHex, podloga) {
    if (!px || !pHex || podloga == null || podloga === 0n) return '';
    var trg = px / pHex, pod = t8(podloga), r = (trg / pod - 1) * 100;
    return trg.toFixed(3) + ' HEX on DEX (' + (Math.abs(r) < 0.5 ? '\u2248 backing' : (r >= 0 ? '+' : '') + r.toFixed(0) + '% vs backing') + ')';
  }

  function kartica(h, v) {
    var c = v.cene, pHex = c[HEX] && c[HEX].px;
    var k = el('div', 'gpc-k');
    var hh = el('div', 'gpc-k-h', (oznaka(h.a) || kratko(h.a)) + ' \u00b7 ' + IME[h.chain]); hh.title = h.a; k.appendChild(hh);
    function vr(lbl, val, sub, cls) {
      var r = el('div', 'gpc-vr' + (cls ? ' ' + cls : ''));
      r.appendChild(el('span', null, lbl)); r.appendChild(el('b', null, val));
      if (sub) r.appendChild(el('em', null, sub));
      k.appendChild(r);
    }
    POOLS.forEach(function (p) {
      var amt = h.t[p.t]; if (!(amt > 0n)) return;
      var x = v.pools[p.t];
      if (x.podloga == null) { vr(p.t, kompakt(t8(amt)), 'backing could not be read'); return; }
      var hexV = amt * x.podloga / E8;
      var deli = [];
      if (pHex) deli.push(usd(t8(hexV) * pHex));
      deli.push(t8(x.podloga).toFixed(4) + ' HEX per ' + p.t + (x.odprto ? '' : ' so far'));
      if (x.maxi && x.hdrnRate > 0n) {
        var hd = Number(amt * x.hdrnRate / E8) / 1e9, pH = c[HDRN] && c[HDRN].px;
        deli.push('+ ' + kompakt(hd) + ' HDRN' + (pH ? ' (' + usd(hd * pH) + ')' : '') + ' minted so far');
      }
      vr(kompakt(t8(amt)) + ' ' + p.t, '\u2248 ' + kompakt(t8(hexV)) + ' HEX', deli.join(' \u00b7 '));
      var px = c[p.a] && c[p.a].px, l = c[p.a] && c[p.a].l;
      var pod = [okno(x, v.dan)];
      var pr = premija(px, pHex, x.podloga); if (pr) pod.push(pr);
      if (px != null) pod.push('DEX pool ' + usd(l || 0).replace('.00', '') + (l < 5000 ? ' \u2014 thin' : ''));
      var r = el('div', 'gpm-pod' + (l != null && l < 5000 ? ' gpm-tanko' : ''), pod.join(' \u00b7 '));
      k.appendChild(r);
    });
    if (h.team > 0n || h.teamSt > 0n) {
      var pT = c[TEAM] && c[TEAM].px;
      if (h.team > 0n) vr('TEAM in wallet', kompakt(t8(h.team)) + ' TEAM', pT ? usd(t8(h.team) * pT) : '');
      if (h.teamSt > 0n) vr('TEAM staked', kompakt(t8(h.teamSt)) + ' TEAM', pT ? usd(t8(h.teamSt) * pT) + ' \u00b7 rewards on maximusdao.com' : 'rewards on maximusdao.com');
    }
    return k;
  }

  function tabela(vsi) {
    tabEl.textContent = '';
    var vrst = [];
    vsi.forEach(function (v) {
      POOLS.forEach(function (p) { vrst.push([v, v.pools[p.t], p]); });
    });
    if (!vrst.length) return;
    var t = el('table', 'wbal-tbl gpv-tbl gpm-t'), th = el('tr');
    ['Pool', 'Chain', 'Stake', 'HEX in stake', 'Supply', 'HEX per token', 'Next redeem'].forEach(function (s) { th.appendChild(el('th', null, s)); });
    var thead = el('thead'); thead.appendChild(th); t.appendChild(thead);
    var tb = el('tbody');
    vrst.forEach(function (z) {
      var v = z[0], x = z[1], p = z[2], r = el('tr');
      r.appendChild(el('td', null, p.t));
      r.appendChild(el('td', null, IME[v.ch]));
      r.appendChild(el('td', null, x.st ? x.st.days + ' days, since ' + datum(x.st.locked) : (x.odprto ? 'reload phase' : '\u2014')));
      r.appendChild(el('td', null, x.st ? kompakt(t8(x.st.hearts + (x.donos || 0n))) + (x.donos ? ' (incl. ' + kompakt(t8(x.donos)) + ' yield)' : '') : '\u2014'));
      r.appendChild(el('td', null, kompakt(t8(x.sup))));
      r.appendChild(el('td', null, x.podloga != null ? t8(x.podloga).toFixed(4) : '\u2014'));
      var kon = x.maxi ? x.konec + 1n : (x.odprto ? x.relEnd : x.konec + 1n);
      r.appendChild(el('td', null, x.odprto && !x.maxi ? 'open until ' + datum(kon) : datum(kon)));
      tb.appendChild(r);
    });
    t.appendChild(tb);
    var ovoj = el('div', 'wbal-scroll gpv-scroll'); ovoj.appendChild(t); tabEl.appendChild(ovoj);
  }

  function nalozi() {
    if (tece) return;
    var wal = denarnice();
    zadnji = localStorage.getItem(K_WAL);
    vsebEl.textContent = ''; tabEl.textContent = '';
    tece = true;
    statEl.textContent = 'Reading Maximus pools\u2026';
    var vsi = [], napake = [];
    ['pls', 'eth'].reduce(function (p, ch) {
      return p.then(function () {
        return Promise.all([veriga(ch, wal), cene(ch)]).then(function (o) { o[0].cene = o[1]; vsi.push(o[0]); },
          function (e) { napake.push(IME[ch] + ': ' + (e && e.message || e)); });
      });
    }, Promise.resolve())
      .then(function () {
        var z = [];
        vsi.forEach(function (v) {
          v.hold.forEach(function (h) {
            var ima = h.team > 0n || h.teamSt > 0n || POOLS.some(function (p) { return h.t[p.t] > 0n; });
            if (ima) z.push([h, v]);
          });
        });
        var nA = {}, nC = {}; z.forEach(function (x) { nA[x[0].a] = 1; nC[x[0].chain] = 1; });
        var nW = Object.keys(nA).length, nCh = Object.keys(nC).length;
        var st = [!wal.length ? 'Add a wallet above to see your MAXI, BASE, TRIO, LUCKY, DECI and TEAM \u2014 pool overview below'
          : !z.length ? 'No Maximus tokens in these wallets \u2014 pool overview below'
          : nW + ' wallet' + (nW === 1 ? '' : 's') + ' with Maximus tokens on ' + (nCh === 2 ? 'PulseChain and Ethereum' : IME[Object.keys(nC)[0]])];
        if (napake.length) st.push('could not read: ' + napake.join('; '));
        statEl.textContent = st.join(' \u00b7 ');
        z.forEach(function (x) { vsebEl.appendChild(kartica(x[0], x[1])); });
        tabela(vsi);
      })
      .catch(function (e) { statEl.textContent = 'Could not read Maximus: ' + (e && e.message || e); })
      .then(function () { tece = false; });
  }

  function zacni() {
    zgradi();
    var n = 0;
    (function cakaj() {
      if (vstavi(n)) {
        setTimeout(nalozi, 8000);   // after the other sections, so the RPC is not overloaded
        setInterval(function () { if (!tece && localStorage.getItem(K_WAL) !== zadnji) nalozi(); }, 5000);
        return;
      }
      if (++n < 480) setTimeout(cakaj, 250);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
