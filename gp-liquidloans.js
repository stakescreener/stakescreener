/*
 * gp-liquidloans.js - StakeScreener: "LIQUID LOANS Screener" section (27 Nov 2026)
 *
 * Read-only. Liquid Loans on PulseChain is a Liquity v1 fork (Trove -> Vault, LUSD -> USDL, LQTY -> LOAN):
 * borrow USDL against PLS at 0% interest (one-time fee), minimum collateral ratio 110%. Immutable, no admin
 * keys (owner() of VaultManager, StabilityPool, LOANStaking and PriceFeed is 0x0 - checked 27 Nov 2026).
 * Addresses from docs.liquidloans.io/pulsechain/contracts:
 *   VaultManager  0xD79bfb86fA06e8782b401bC0197d92563602D2Ab
 *   StabilityPool 0x7bFD406632483ad00c6EdF655E04De91A96f84bc
 *   LOANStaking   0x853F0CD4B0083eDf7cFf5Ad9A296f02Ffb71C995
 *   PriceFeed     0xc65Abc8B9B4B3cEE03430f6fc3d8A4760221A113
 *   USDL 0x0dEEd1486bc52aA0d3E6f8849cEC5adD6598A162, LOAN 0x9159f1D2a9f51998Fc9Ab03fbd8f265ab14A1b3B
 *
 * Shown per wallet: vault (collateral, debt, collateral ratio, liquidation price, place in the redemption
 * queue), Stability Pool deposit with PLS and LOAN gains, LOAN stake with PLS and USDL gains.
 * Always shown: system overview (TCR, price at which Recovery Mode starts, debt, Stability Pool, fees).
 *  - price: PriceFeed.fetchPrice() via eth_call (what the next transaction would use), lastGoodPrice() as fallback;
 *  - debt and collateral include pending redistribution rewards (getEntireDebtAndColl);
 *  - collateral ratio = coll x price / debt (verified 91/91 against VaultManager.getCurrentICR, 27 Nov 2026);
 *  - redemptions take the vaults with the lowest ratio first and skip vaults below 110% (Liquity v1 rule);
 *    "redeemed before yours" = debt minus the 200 USDL gas reserve of every vault ranked below.
 * NOT added to TOTAL. app.js and wallets.js unchanged.
 */
(function () {
  'use strict';
  var VM = '0xd79bfb86fa06e8782b401bc0197d92563602d2ab';
  var SP = '0x7bfd406632483ad00c6edf655e04de91a96f84bc';
  var LS = '0x853f0cd4b0083edf7cff5ad9a296f02ffb71c995';
  var PF = '0xc65abc8b9b4b3cee03430f6fc3d8a4760221a113';
  var USDL = '0x0deed1486bc52aa0d3e6f8849cec5add6598a162';
  var LOAN = '0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b';
  var RPC = ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'];
  var SEL = {
    count: '0xcf80c372', owner: '0xc0d52873', entire: '0xb91af97c', status: '0x180d97c1',
    mcr: '0x794e5724', ccr: '0x5733d58f', gas: '0x44a4a3af', sysColl: '0x887105d3', sysDebt: '0x795d26c3',
    redRate: '0xc52861f2', borRate: '0x66ca4a21', fetch: '0x0fdb11cf', last: '0x0490be83',
    spTotal: '0xffc9b9b4', spDep: '0xa957c0c2', spPls: '0x22052a34', spLoan: '0x9f9d78ba',
    lsTotal: '0x52366ec2', lsStake: '0x16934fc4', lsPls: '0x4dd0dae3', lsUsdl: '0x816ddaa1'
  };
  var K_WAL = 'gopulse_wallets', K_LAB = 'gopulse_labels';
  var E18 = 1000000000000000000n;

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function p64(x) { return BigInt(x).toString(16).padStart(64, '0'); }
  function pa(a) { return a.slice(2).toLowerCase().padStart(64, '0'); }
  function b(r, i) { return BigInt('0x' + ((r || '0x').slice(2 + 64 * i, 2 + 64 * (i + 1)) || '0').padEnd(64, '0')); }
  function n18(x) { return Number(x) / 1e18; }
  function kompakt(n) {
    if (n >= 1e12) return (n / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'T';
    if (n >= 1e9) return (n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B';
    if (n >= 1e6) return (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    if (n >= 1e4) return (n / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2 });
  }
  function usd(n) {
    if (n == null || !isFinite(n)) return '';
    if (n > 0 && n < 0.01) return '<$0.01';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function cena(p) {   // small prices such as PLS: $0.00000469
    if (!isFinite(p) || p <= 0) return '\u2014';
    if (p >= 0.01) return '$' + p.toFixed(4);
    var d = Math.min(14, Math.ceil(-Math.log10(p)) + 2);
    return '$' + p.toFixed(d);
  }
  function pct(x) { return (x * 100).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + '%'; }
  function odmik(p, now) { var r = (p / now - 1) * 100; return (r >= 0 ? '+' : '\u2212') + Math.abs(r).toFixed(1) + '%'; }
  function kratko(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function beri(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function denarnice() {
    var a = beri(K_WAL, []);
    return Array.isArray(a) ? a.filter(function (x) { return /^0x[0-9a-fA-F]{40}$/.test(x); }).map(function (x) { return x.toLowerCase(); }) : [];
  }
  function oznaka(a) { var l = beri(K_LAB, {}); return (l && l[a]) || ''; }
  function klic(id, to, data) { return { jsonrpc: '2.0', id: id, method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }; }
  function rpc(klici) {
    var i = 0;
    function poskus() {
      if (i >= RPC.length) return Promise.reject(new Error('RPC not reachable'));
      return fetch(RPC[i++], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(klici) })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          if (!Array.isArray(j)) return Promise.reject();
          var po = {}; j.forEach(function (x) { po[x.id] = x.result != null ? x.result : null; });
          return klici.map(function (k) { return po[k.id]; });
        }).catch(poskus);
    }
    return poskus();
  }
  function rpcVKosih(klici) {
    var kosi = [], out = [];
    for (var i = 0; i < klici.length; i += 60) kosi.push(klici.slice(i, i + 60));
    return kosi.reduce(function (p, k) { return p.then(function () { return rpc(k).then(function (r) { out = out.concat(r); }); }); }, Promise.resolve())
      .then(function () { return out; });
  }
  function cene() {
    return fetch('https://api.dexscreener.com/tokens/v1/pulsechain/' + [USDL, LOAN].join(','))
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

  /* ---------- reading ---------- */
  function preberi(wal) {
    var k = [klic(0, PF, SEL.fetch), klic(1, PF, SEL.last), klic(2, VM, SEL.count), klic(3, VM, SEL.mcr), klic(4, VM, SEL.ccr),
      klic(5, VM, SEL.gas), klic(6, VM, SEL.sysColl), klic(7, VM, SEL.sysDebt), klic(8, VM, SEL.redRate), klic(9, VM, SEL.borRate),
      klic(10, SP, SEL.spTotal), klic(11, LS, SEL.lsTotal)];
    return rpc(k).then(function (r) {
      var s = {
        price: r[0] ? b(r[0], 0) : b(r[1], 0), priceSvez: !!r[0], n: Number(b(r[2], 0)), mcr: b(r[3], 0), ccr: b(r[4], 0), gas: b(r[5], 0),
        coll: b(r[6], 0), debt: b(r[7], 0), redRate: b(r[8], 0), borRate: b(r[9], 0), spTotal: b(r[10], 0), lsTotal: b(r[11], 0)
      };
      if (!s.price || !s.n) throw new Error('Liquid Loans contracts did not answer');
      var ko = [];
      for (var i = 0; i < s.n; i++) ko.push(klic(i, VM, SEL.owner + p64(i)));
      return rpcVKosih(ko).then(function (ro) {
        var lastniki = ro.map(function (x) { return x ? '0x' + x.slice(-40).toLowerCase() : null; }).filter(Boolean);
        var kv = [];
        lastniki.forEach(function (a, i) { kv.push(klic(i, VM, SEL.entire + pa(a))); });
        var id0 = kv.length;
        wal.forEach(function (a, i) {
          var j = id0 + i * 6;
          kv.push(klic(j, SP, SEL.spDep + pa(a)), klic(j + 1, SP, SEL.spPls + pa(a)), klic(j + 2, SP, SEL.spLoan + pa(a)),
            klic(j + 3, LS, SEL.lsStake + pa(a)), klic(j + 4, LS, SEL.lsPls + pa(a)), klic(j + 5, LS, SEL.lsUsdl + pa(a)));
        });
        return rpcVKosih(kv).then(function (rv) {
          s.vaults = lastniki.map(function (a, i) {
            var e = rv[i], debt = b(e, 0), coll = b(e, 1);
            return { a: a, debt: debt, coll: coll, icr: debt > 0n ? coll * s.price / debt : 0n };
          }).filter(function (v) { return v.debt > 0n; });
          s.vaults.sort(function (x, y) { return x.icr < y.icr ? -1 : x.icr > y.icr ? 1 : 0; });   // redemption order: lowest first
          s.wal = wal.map(function (a, i) {
            var j = id0 + i * 6;
            return { a: a, sp: b(rv[j], 0), spPls: b(rv[j + 1], 0), spLoan: b(rv[j + 2], 0), st: b(rv[j + 3], 0), stPls: b(rv[j + 4], 0), stUsdl: b(rv[j + 5], 0) };
          });
          return s;
        });
      });
    });
  }

  /* ---------- display ---------- */
  var sec, statEl, sysEl, vsebEl, zadnji = null, tece = false;
  function zgradi() {
    sec = el('div', null); sec.id = 'gpl-sec';
    var hdr = el('div', 'wbal-hdr gpv-hdr');
    hdr.appendChild(el('span', 'wbal-title', 'LIQUID LOANS'));
    hdr.appendChild(el('span', 'wbal-title2', 'Screener'));
    hdr.appendChild(el('span', 'gpv-veriga', 'Vaults \u00b7 USDL \u00b7 Stability Pool \u00b7 LOAN'));
    sec.appendChild(hdr);
    statEl = el('div', 'wbal-note gpv-stanje'); sec.appendChild(statEl);
    sysEl = el('div', 'gpv-pov gpl-sys'); sec.appendChild(sysEl);
    vsebEl = el('div', 'gpc-den'); sec.appendChild(vsebEl);
    var op = el('div', 'wbal-note gpv-opomba');
    op.appendChild(document.createTextNode(
      'Read-only. Liquid Loans (a Liquity v1 fork, immutable, no admin keys) lends USDL against PLS at 0% interest with a one-time fee. ' +
      'A vault is liquidated when its collateral ratio falls below 110%. If the whole system falls below 150% (Recovery Mode), ' +
      'vaults below the system ratio can be liquidated as well. Redemptions swap USDL for PLS from the vaults with the lowest ratio first: ' +
      'such a vault loses part of its PLS and the same value of debt. Values come straight from the contracts on PulseChain ' +
      '(PLS price from the Liquid Loans price feed; USDL counted at $1, its redemption value; LOAN price from DexScreener). Nothing here is added to the total. Official site: '));
    var a = el('a', null, 'liquidloans.io'); a.href = 'https://www.liquidloans.io/pulsechain'; a.target = '_blank'; a.rel = 'noopener';
    op.appendChild(a);
    op.appendChild(document.createTextNode('. Informational only, not financial advice.'));
    sec.appendChild(op);
    sec.appendChild(el('div', 'gp-loc'));
  }
  function vstavi(n) {
    var pred = document.getElementById('gpm-sec') || (n > 60 ? (document.getElementById('gpi-sec') || document.getElementById('gph-sec') || document.getElementById('gpc-sec') || document.getElementById('wbal-sec')) : null);
    if (!pred || !pred.parentNode) return false;
    pred.parentNode.insertBefore(sec, pred.nextSibling);
    return true;
  }
  function ploscica(lbl, val, sub, cls) {
    var k = el('div', 'gpv-k' + (cls ? ' ' + cls : ''));
    k.appendChild(el('div', 'gpv-k-lbl', lbl));
    k.appendChild(el('div', 'gpv-k-val', val));
    if (sub) k.appendChild(el('div', 'gpv-k-sub', sub));
    return k;
  }

  function sistem(s, c) {
    sysEl.textContent = '';
    var p = n18(s.price), tcr = s.debt > 0n ? Number(s.coll * s.price / s.debt) / 1e18 : 0, ccr = n18(s.ccr);
    var pRec = n18(s.debt) * ccr / n18(s.coll);
    var rec = tcr < ccr;
    sysEl.appendChild(ploscica('PLS price (feed)', cena(p), s.priceSvez ? 'Liquid Loans price feed' : 'last good price of the feed'));
    sysEl.appendChild(ploscica('System ratio (TCR)', pct(tcr),
      rec ? 'RECOVERY MODE \u2014 below ' + pct(ccr) : 'Recovery Mode below ' + pct(ccr) + ': PLS at ' + cena(pRec) + ' (' + odmik(pRec, p) + ')',
      rec ? 'gpl-slabo' : tcr < ccr * 1.2 ? 'gpl-pazi' : ''));
    sysEl.appendChild(ploscica('USDL debt', kompakt(n18(s.debt)), s.vaults.length + ' vaults \u00b7 collateral ' + kompakt(n18(s.coll)) + ' PLS'));
    var spDel = s.debt > 0n ? n18(s.spTotal) / n18(s.debt) : 0;
    sysEl.appendChild(ploscica('Stability Pool', kompakt(n18(s.spTotal)) + ' USDL', pct(spDel) + ' of all debt'));
    var naj = s.vaults[0];
    if (naj) sysEl.appendChild(ploscica('Lowest vault', pct(n18(naj.icr)), 'first in line for redemptions', n18(naj.icr) < 1.2 ? 'gpl-pazi' : ''));
    var u = c[USDL], l = c[LOAN];
    sysEl.appendChild(ploscica('USDL on DEX', u ? '$' + u.px.toFixed(4) : '\u2014',
      (u ? (Math.abs(u.px - 1) < 0.01 ? 'on peg' : (u.px < 1 ? 'below' : 'above') + ' $1 by ' + Math.abs((u.px - 1) * 100).toFixed(1) + '%') + ' \u00b7 ' : '') +
      'fee ' + pct(n18(s.borRate)) + ' borrow \u00b7 ' + pct(n18(s.redRate)) + ' redeem',
      u && Math.abs(u.px - 1) >= 0.03 ? 'gpl-pazi' : ''));
    if (l) sysEl.appendChild(ploscica('LOAN', cena(l.px), kompakt(n18(s.lsTotal)) + ' LOAN staked'));
  }

  function kartica(w, s, c) {
    var p = n18(s.price), ccr = n18(s.ccr), mcr = n18(s.mcr);
    var idx = -1;
    for (var i = 0; i < s.vaults.length; i++) if (s.vaults[i].a === w.a) { idx = i; break; }
    var v = idx >= 0 ? s.vaults[idx] : null;
    if (!v && !(w.sp > 0n) && !(w.spPls > 0n) && !(w.spLoan > 0n) && !(w.st > 0n) && !(w.stPls > 0n) && !(w.stUsdl > 0n)) return null;
    var k = el('div', 'gpc-k');
    var hh = el('div', 'gpc-k-h', (oznaka(w.a) || kratko(w.a)) + ' \u00b7 PulseChain'); hh.title = w.a; k.appendChild(hh);
    function vr(lbl, val, sub, cls) {
      var r = el('div', 'gpc-vr' + (cls ? ' ' + cls : ''));
      r.appendChild(el('span', null, lbl)); r.appendChild(el('b', null, val));
      if (sub) r.appendChild(el('em', null, sub));
      k.appendChild(r);
    }
    var pU = 1, pL = c[LOAN] && c[LOAN].px;   // USDL valued at $1: debt is repaid and redemptions settle at face value; the DEX price is shown in the overview
    if (v) {
      k.appendChild(el('div', 'gpi-pod', 'Vault'));
      var coll = n18(v.coll), debt = n18(v.debt), icr = n18(v.icr);
      vr('Collateral', kompakt(coll) + ' PLS', usd(coll * p));
      vr('Debt', kompakt(debt) + ' USDL', 'incl. ' + kompakt(n18(s.gas)) + ' USDL gas reserve, returned when the vault closes');
      vr('Net value', usd(coll * p - debt * pU));
      var cls = icr < 1.2 ? 'gpl-slabo' : icr < ccr ? 'gpl-pazi' : 'gpl-dobro';
      vr('Collateral ratio', pct(icr), icr < ccr ? 'below ' + pct(ccr) + ' \u2014 at risk if the system enters Recovery Mode' : '', cls);
      var pLiq = debt * mcr / coll;
      vr('Liquidation price', cena(pLiq), 'PLS ' + odmik(pLiq, p) + ' from now (ratio 110%)', cls);
      var pRec = n18(s.debt) * ccr / n18(s.coll);
      var icrPriRec = icr * pRec / p;
      if (pRec > pLiq && icrPriRec < ccr) {
        vr('Recovery Mode', cena(pRec), 'starts at this PLS price (' + odmik(pRec, p) + '); this vault would then be at ' + pct(icrPriRec) + ' and could be liquidated', 'gpl-pazi');
      }
      var pred = 0n;
      for (var j = 0; j < idx; j++) { var x = s.vaults[j]; if (x.icr >= s.mcr) pred += x.debt - s.gas; }
      vr('Redemption queue', '#' + (idx + 1) + ' of ' + s.vaults.length,
        idx === 0 ? 'first in line: the next redemption takes PLS from this vault'
          : kompakt(n18(pred)) + ' USDL of other vaults is redeemed before this one', idx < 5 ? 'gpl-pazi' : '');
    }
    if (w.sp > 0n || w.spPls > 0n || w.spLoan > 0n) {
      k.appendChild(el('div', 'gpi-pod', 'Stability Pool'));
      vr('Deposit', kompakt(n18(w.sp)) + ' USDL', usd(n18(w.sp) * pU));
      if (w.spPls > 0n) vr('PLS gain', kompakt(n18(w.spPls)) + ' PLS', usd(n18(w.spPls) * p) + ' \u00b7 from liquidations');
      if (w.spLoan > 0n) vr('LOAN gain', kompakt(n18(w.spLoan)) + ' LOAN', pL ? usd(n18(w.spLoan) * pL) : '');
    }
    if (w.st > 0n || w.stPls > 0n || w.stUsdl > 0n) {
      k.appendChild(el('div', 'gpi-pod', 'LOAN staking'));
      vr('Staked', kompakt(n18(w.st)) + ' LOAN', pL ? usd(n18(w.st) * pL) : '');
      if (w.stPls > 0n) vr('PLS gain', kompakt(n18(w.stPls)) + ' PLS', usd(n18(w.stPls) * p) + ' \u00b7 redemption fees');
      if (w.stUsdl > 0n) vr('USDL gain', kompakt(n18(w.stUsdl)) + ' USDL', usd(n18(w.stUsdl) * pU) + ' \u00b7 borrowing fees');
    }
    return k;
  }

  function nalozi() {
    if (tece) return;
    var wal = denarnice();
    zadnji = localStorage.getItem(K_WAL);
    tece = true;
    statEl.textContent = 'Reading Liquid Loans\u2026';
    Promise.all([preberi(wal), cene()]).then(function (o) {
      var s = o[0], c = o[1];
      vsebEl.textContent = '';
      sistem(s, c);
      var n = 0;
      s.wal.forEach(function (w) { var k = kartica(w, s, c); if (k) { vsebEl.appendChild(k); n++; } });
      statEl.textContent = !wal.length ? 'Add a wallet above to see its vault, Stability Pool deposit and LOAN stake \u2014 system overview below'
        : !n ? 'No Liquid Loans positions in these wallets \u2014 system overview below'
        : n + ' wallet' + (n === 1 ? '' : 's') + ' with Liquid Loans positions on PulseChain';
    }).catch(function (e) {
      statEl.textContent = 'Could not read Liquid Loans: ' + (e && e.message || e);
    }).then(function () { tece = false; });
  }

  function zacni() {
    zgradi();
    var n = 0;
    (function cakaj() {
      if (vstavi(n)) {
        setTimeout(nalozi, 10000);   // after the other sections, so the RPC is not overloaded
        setInterval(function () { if (!tece && localStorage.getItem(K_WAL) !== zadnji) nalozi(); }, 5000);
        return;
      }
      if (++n < 480) setTimeout(cakaj, 250);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
