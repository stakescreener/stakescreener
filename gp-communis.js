/*
 * gp-communis.js - StakeScreener: "COMMUNIS Screener" section (22 Nov 2026)
 *
 * Read-only. Communis (COM) 0x5A9780Bfe63f3ec57f01b087cD65BD656C9034A8 - the same contract on PulseChain
 * and Ethereum. maxPayout and Start bonus are calculated exactly as in the contract (verified 16/16 against
 * getPayout and getStartBonusPayout on real stakes). Stakes come from the HEX Stake Screener
 * (renderAll is wrapped, like in gp-total.js); app.js and wallets.js stay unchanged.
 * Rules (contract): Start >=180 days, End >=365 days and within 37 days after the due day, while the stake is still
 * active in HEX; 50 % of the End bonus becomes End Bonus Debt; stake bonus = staked COM / 80 per 91 days,
 * if staked COM covers the debt.
 */
(function () {
  'use strict';
  if (typeof renderAll !== 'function') return;

  var COM = '0x5a9780bfe63f3ec57f01b087cd65bd656c9034a8';
  var HEX = '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39';
  var RPC = {
    pls: ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'],
    eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  };
  var DEX = 'https://api.dexscreener.com/latest/dex/tokens/' + COM;
  var IME_VERIGE = { pls: 'PulseChain', eth: 'Ethereum' };
  var MAX_STAKOV = 300, MAX_PRIKAZ = 100, ROK = 37;
  var ZAGON = Date.UTC(2019, 11, 3);   // HEX day 0
  var SEL = {
    dan: '0x5c9302c9', globals: '0xc3124525',
    staked: '0x7b4296db', debt: '0x3b665f9c', restake: '0x60bc0be8', bal: '0x70a08231',
    start: '0x741bf921', end: '0xea98ed9a'
  };
  var K_LAB = 'gopulse_labels';

  /* ---------- calculations as in the contract ---------- */
  function E(n) { return 10n ** BigInt(n); }
  function bonusHearts(h, d, cap) {
    var cd = 0n;
    if (cap) { if (d > 1n) cd = d <= 3640n ? d - 1n : 3640n; } else cd = d - 1n;
    var ch = h <= 15n * E(15) ? h : 15n * E(15);
    return h * ((cd * (15n * E(16))) + (ch * 1820n)) / (273n * E(18));
  }
  function payout(s) {
    var h = BigInt(s.stakedHearts), sh = BigInt(s.stakeShares), d = BigInt(s.stakedDays);
    var orig = ((h + bonusHearts(h, d, true)) * E(5)) / sh;
    var rec = (h + bonusHearts(h, d, false)) * E(17) / orig;
    return { orig: orig, max: (rec * ((d * E(15)) / 5555n)) / E(15) };
  }
  function startBonus(d, locked, max, orig, dan, sr) {
    d = BigInt(d);
    var bp;
    if (d > 364n) { bp = ((d - 365n) * E(10)) / 5190n; bp = ((6n * E(10)) * bp) / E(10); bp = (10n * E(10)) - bp; }
    else { bp = ((d - 180n) * E(10)) / 185n; bp = ((10n * E(10)) * bp) / E(10); bp = (20n * E(10)) - bp; }
    var p = (max * E(10)) / bp;
    if (BigInt(dan) !== BigInt(locked)) p = (p * ((orig * E(15)) / BigInt(sr))) / E(15);
    return p;
  }

  /* ---------- helpers ---------- */
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function p64(x) { return BigInt(x).toString(16).padStart(64, '0'); }
  function pa(a) { return a.slice(2).toLowerCase().padStart(64, '0'); }
  function beseda(r, i) { return BigInt('0x' + (r || '0x').slice(2 + 64 * i, 2 + 64 * (i + 1)).padEnd(64, '0')); }
  function com(b) { return Number(b) / 1e12; }
  function fCom(b) {
    var n = com(b);
    if (n >= 1e12) return (n / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'T';
    if (n >= 1e9) return (n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B';
    if (n >= 1e6) return (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    if (n >= 1e3) return (n / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function usd(n) {
    if (n == null || !isFinite(n)) return '';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function datum(dan) {
    return new Date(ZAGON + Number(dan) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function kratko(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function oznaka(a) {
    try { var l = JSON.parse(localStorage.getItem(K_LAB) || '{}'); return (l && l[a.toLowerCase()]) || ''; } catch (e) { return ''; }
  }

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
  function klic(id, to, data) { return { jsonrpc: '2.0', id: id, method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }; }

  function cenaCom() {
    return fetch(DEX).then(function (r) { return r.json(); }).then(function (j) {
      var naj = {};
      (j.pairs || []).forEach(function (p) {
        if (!p.baseToken || p.baseToken.address.toLowerCase() !== COM) return;
        var ch = p.chainId === 'pulsechain' ? 'pls' : p.chainId === 'ethereum' ? 'eth' : null;
        if (!ch) return;
        var l = (p.liquidity && p.liquidity.usd) || 0, px = Number(p.priceUsd);
        if (isFinite(px) && (!naj[ch] || l > naj[ch].l)) naj[ch] = { l: l, px: px };
      });
      return { pls: naj.pls ? naj.pls.px : null, eth: naj.eth ? naj.eth.px : null };
    }).catch(function () { return { pls: null, eth: null }; });
  }

  /* ---------- reading ---------- */
  function preberi(stakes) {
    var poVerigi = { pls: [], eth: [] };
    stakes.forEach(function (s) { (poVerigi[s.chain === 'eth' ? 'eth' : 'pls']).push(s); });
    var rez = { stake: [], denarnice: [], napake: [], cena: null, dan: {} };
    return cenaCom().then(function (c) { rez.cena = c; })
      .then(function () {
        return ['pls', 'eth'].reduce(function (p, ch) {
          return p.then(function () {
            var ss = poVerigi[ch];
            if (!ss.length) return;
            var lastniki = [];
            ss.forEach(function (s) { if (lastniki.indexOf(s.owner) < 0) lastniki.push(s.owner); });
            var k = [klic(0, HEX, SEL.dan), klic(1, HEX, SEL.globals)], id = 2;
            lastniki.forEach(function (a) {
              k.push(klic(id++, COM, SEL.staked + pa(a)));
              k.push(klic(id++, COM, SEL.debt + pa(a)));
              k.push(klic(id++, COM, SEL.restake + pa(a)));
              k.push(klic(id++, COM, SEL.bal + pa(a)));
            });
            ss.forEach(function (s) {
              k.push(klic(id++, COM, SEL.start + p64(s.stakeId)));
              k.push(klic(id++, COM, SEL.end + p64(s.stakeId)));
            });
            return rpcVKosih(ch, k).then(function (r) {
              var dan = beseda(r[0], 0), sr = beseda(r[1], 2), j = 2;
              rez.dan[ch] = Number(dan);
              lastniki.forEach(function (a) {
                var debt = r[j + 1], red = r[j + 2];
                rez.denarnice.push({
                  chain: ch, a: a, dan: dan,
                  staked: beseda(r[j], 0), bal: beseda(r[j + 3], 0),
                  next: beseda(debt, 0), debt: beseda(debt, 1),
                  redDni: beseda(red, 0), redDan: beseda(red, 1), redShares: beseda(red, 2)
                });
                j += 4;
              });
              ss.forEach(function (s) {
                var pr = payout(s);
                var st = beseda(r[j], 0), en = beseda(r[j + 1], 0);
                j += 2;
                var d = Number(s.stakedDays), L = Number(s.lockedDay), due = L + d, D = Number(dan);
                var z = { s: s, chain: ch, max: pr.max, st: st, en: en, due: due, dan: D };
                z.startZdaj = (st === 0n && en === 0n && d >= 180 && D >= L) ? startBonus(d, L, pr.max, pr.orig, dan, sr) : 0n;
                z.endZnesek = d >= 365 ? pr.max - st : 0n;
                if (en > 0n) z.endStanje = 'minted';
                else if (d < 365) z.endStanje = 'none';
                else if (D < due) z.endStanje = 'soon';
                else if (D <= due + ROK) z.endStanje = 'open';
                else z.endStanje = 'missed';
                rez.stake.push(z);
              });
            }).catch(function (e) { rez.napake.push(IME_VERIGE[ch] + ': ' + (e && e.message || e)); });
          });
        }, Promise.resolve());
      })
      .then(function () { return rez; });
  }

  /* ---------- display ---------- */
  var sec, statEl, opozEl, denEl, tabEl;
  function zgradi() {
    sec = el('div', null); sec.id = 'gpc-sec';
    var hdr = el('div', 'wbal-hdr gpv-hdr');
    hdr.appendChild(el('span', 'wbal-title', 'COMMUNIS'));
    hdr.appendChild(el('span', 'wbal-title2', 'Screener'));
    hdr.appendChild(el('span', 'gpv-veriga', 'COM'));
    sec.appendChild(hdr);
    statEl = el('div', 'wbal-note gpv-stanje'); sec.appendChild(statEl);
    opozEl = el('div', 'gpc-opoz'); sec.appendChild(opozEl);
    denEl = el('div', 'gpc-den'); sec.appendChild(denEl);
    tabEl = el('div', 'gpv-tab'); sec.appendChild(tabEl);
    sec.appendChild(el('div', 'wbal-note gpv-opomba',
      'Read-only. Communis (COM) mints bonuses for native HEX stakes: a Start bonus (stakes of 180+ days) is an advance ' +
      'on the total; the End bonus (365+ days) is the rest and can only be minted in the ' + ROK + ' days after the stake ' +
      'is due \u2014 and only while the stake is still active in HEX, so mint it before ending the stake. Half of each End ' +
      'bonus becomes End Bonus Debt; staked COM that covers the debt earns 1/80 every 91 days. Figures follow the Communis ' +
      'contract exactly; minting is done on communis.app, StakeScreener signs nothing. Informational only, not financial advice.'));
    sec.appendChild(el('div', 'gp-loc'));
    statEl.textContent = 'Communis bonuses appear after the HEX stakes below are loaded.';
  }
  function vstavi() {
    var pred = document.getElementById('gpv-sec') || document.getElementById('wbal-sec');
    if (!pred || !pred.parentNode) return false;
    pred.parentNode.insertBefore(sec, pred.nextSibling);
    return true;
  }

  function vUsd(b, ch, cena) { var px = cena && cena[ch]; return px ? usd(com(b) * px) : ''; }

  function risi(rez) {
    opozEl.textContent = ''; denEl.textContent = ''; tabEl.textContent = '';
    var cena = rez.cena;
    var vsi = rez.stake;
    var st = [];
    st.push(vsi.length + ' native HEX stake' + (vsi.length === 1 ? '' : 's') + ' checked');
    if (rez.napake.length) st.push('could not read: ' + rez.napake.join('; '));
    statEl.textContent = st.join(' \u00b7 ');

    // warnings
    var odprti = vsi.filter(function (z) { return z.endStanje === 'open'; })
      .sort(function (a, b) { return (a.due + ROK - a.dan) - (b.due + ROK - b.dan); });
    odprti.forEach(function (z) {
      var ost = z.due + ROK - z.dan;
      var o = el('div', 'gpc-o gpc-o-r');
      o.appendChild(el('b', null, 'End bonus open: '));
      o.appendChild(el('span', null, 'stake #' + z.s.stakeId + ' (' + kratko(z.s.owner) + ', ' + IME_VERIGE[z.chain] + ') \u2014 ' +
        fCom(z.endZnesek) + ' COM ' + (vUsd(z.endZnesek, z.chain, cena) ? '(' + vUsd(z.endZnesek, z.chain, cena) + ') ' : '') +
        '\u2014 closes in ' + ost + ' day' + (ost === 1 ? '' : 's') + ' (' + datum(z.due + ROK) + '). Mint before ending the stake.'));
      opozEl.appendChild(o);
    });
    var skStart = { pls: 0n, eth: 0n }, nStart = 0;
    vsi.forEach(function (z) { if (z.startZdaj > 0n) { skStart[z.chain] += z.startZdaj; nStart++; } });
    if (nStart) {
      var o2 = el('div', 'gpc-o');
      var deli = ['pls', 'eth'].filter(function (c) { return skStart[c] > 0n; }).map(function (c) {
        return fCom(skStart[c]) + ' COM on ' + IME_VERIGE[c] + (vUsd(skStart[c], c, cena) ? ' (' + vUsd(skStart[c], c, cena) + ')' : '');
      });
      o2.appendChild(el('b', null, 'Start bonus available: '));
      o2.appendChild(el('span', null, nStart + ' stake' + (nStart === 1 ? '' : 's') + ' \u2014 ' + deli.join(' + ') +
        '. It shrinks as the HEX share rate rises, and is deducted from the End bonus.'));
      opozEl.appendChild(o2);
    }

    // wallets
    var zDen = rez.denarnice.filter(function (w) { return w.staked > 0n || w.debt > 0n || w.bal > 0n || w.redDan > 0n; });
    zDen.forEach(function (w) {
      var k = el('div', 'gpc-k');
      var h = el('div', 'gpc-k-h', (oznaka(w.a) || kratko(w.a)) + ' \u00b7 ' + IME_VERIGE[w.chain]);
      h.title = w.a; k.appendChild(h);
      function vr(lbl, val, sub, cls) {
        var r = el('div', 'gpc-vr' + (cls ? ' ' + cls : ''));
        r.appendChild(el('span', null, lbl));
        var b = el('b', null, val); r.appendChild(b);
        if (sub) r.appendChild(el('em', null, sub));
        k.appendChild(r);
      }
      vr('COM in wallet', fCom(w.bal), vUsd(w.bal, w.chain, cena));
      vr('Staked COM', fCom(w.staked), vUsd(w.staked, w.chain, cena));
      if (w.debt > 0n) {
        var pokrito = w.staked >= w.debt;
        vr('End Bonus Debt', fCom(w.debt), pokrito ? 'covered \u2713' : 'not covered \u2014 stake bonus paused', pokrito ? '' : 'gpc-slabo');
        var D = Number(w.dan), nx = Number(w.next);
        if (pokrito) {
          if (D >= nx) {
            var n = BigInt(Math.floor((D - nx) / 91) + 1);
            var pay = (w.staked * n) / 80n;
            vr('Stake bonus', fCom(pay) + ' COM', 'available now' + (vUsd(pay, w.chain, cena) ? ' \u00b7 ' + vUsd(pay, w.chain, cena) : ''), 'gpc-dobro');
          } else {
            var p1 = w.staked / 80n;
            vr('Next stake bonus', fCom(p1) + ' COM', 'in ' + (nx - D) + ' days (' + datum(nx) + ')');
          }
        }
      }
      if (w.redDan > 0n) {
        vr('Restake bonus', 'open', 'new stake started after ' + datum(Number(w.redDan)) + ', ' +
          (Number(w.redDni) >= 5555 ? '5555' : 'at least ' + Math.max(365, Number(w.redDni) + 1)) + ' days, ' +
          'with ' + fCom(w.redShares * E(12)) + ' to ' + fCom(w.redShares * 2n * E(12)) + ' HEX shares');
      }
      denEl.appendChild(k);
    });

    // stake table
    var prikaz = vsi.slice().sort(function (a, b) {
      var pa1 = a.endStanje === 'open' ? 0 : 1, pb1 = b.endStanje === 'open' ? 0 : 1;
      return pa1 - pb1 || a.due - b.due;
    });
    var vec = prikaz.length > MAX_PRIKAZ ? prikaz.length - MAX_PRIKAZ : 0;
    prikaz = prikaz.slice(0, MAX_PRIKAZ);
    if (!prikaz.length) { if (!zDen.length) statEl.textContent += ' \u00b7 no Communis activity found for these wallets.'; return; }
    // short summary above the table
    var odp = vsi.filter(function (z) { return z.endStanje === 'open'; }).length;
    var kmalu = vsi.filter(function (z) { return z.endStanje === 'soon' && z.due - z.dan <= 30; }).length;
    var ostEnd = { pls: 0n, eth: 0n };
    vsi.forEach(function (z) { if (z.endStanje === 'open' || z.endStanje === 'soon') ostEnd[z.chain] += z.endZnesek; });
    var pov = el('div', 'gpc-pov');
    pov.appendChild(el('span', null, 'End bonus open now: ')); pov.appendChild(el('b', null, String(odp)));
    pov.appendChild(el('span', null, ' \u00b7 opening within 30 days: ')); pov.appendChild(el('b', null, String(kmalu)));
    ['pls', 'eth'].forEach(function (c) {
      if (ostEnd[c] > 0n) {
        pov.appendChild(el('span', null, ' \u00b7 End bonuses still ahead (' + IME_VERIGE[c] + '): '));
        pov.appendChild(el('b', null, fCom(ostEnd[c]) + ' COM' + (vUsd(ostEnd[c], c, cena) ? ' (' + vUsd(ostEnd[c], c, cena) + ')' : '')));
      }
    });
    tabEl.appendChild(pov);
    function tabela(vrste) {
    var ovoj = el('div', 'wbal-scroll gpv-scroll');
    var t = el('table', 'wbal-tbl gpv-tbl');
    var th = el('thead'), tr = el('tr');
    ['HEX stake', 'Days', 'Due', 'Max COM', 'Start bonus', 'End bonus', 'Wallet'].forEach(function (x) { tr.appendChild(el('th', null, x)); });
    th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    vrste.forEach(function (z) {
      var r = el('tr');
      var c0 = el('td', null, '#' + z.s.stakeId);
      c0.appendChild(el('span', 'gpv-mini', z.chain === 'eth' ? 'ETH' : 'PLS'));
      r.appendChild(c0);
      r.appendChild(el('td', null, String(z.s.stakedDays)));
      r.appendChild(el('td', null, datum(z.due)));
      var cm = el('td', null, Number(z.s.stakedDays) < 180 ? '\u2014' : fCom(z.max)); cm.title = vUsd(z.max, z.chain, cena); r.appendChild(cm);
      var cs = el('td');
      if (z.st > 0n) cs.appendChild(el('span', 'gpv-st gpv-st-izs', 'minted ' + fCom(z.st)));
      else if (z.startZdaj > 0n) { var x = el('span', 'gpv-st gpv-st-cak', 'available ' + fCom(z.startZdaj)); x.title = vUsd(z.startZdaj, z.chain, cena); cs.appendChild(x); }
      else cs.textContent = Number(z.s.stakedDays) < 180 ? '< 180 days' : '\u2014';
      r.appendChild(cs);
      var ce = el('td'), ost = z.due + ROK - z.dan;
      var m = {
        minted: ['minted ' + fCom(z.en), 'izs'],
        none: ['< 365 days', null],
        soon: ['opens in ' + (z.due - z.dan) + ' d \u00b7 ' + fCom(z.endZnesek), (z.due - z.dan) <= 30 ? 'izh' : null],
        open: ['OPEN ' + ost + ' d left \u00b7 ' + fCom(z.endZnesek), 'akt'],
        missed: ['missed', 'kaz']
      }[z.endStanje];
      if (m[1]) { var y = el('span', 'gpv-st gpv-st-' + m[1], m[0]); y.title = vUsd(z.endStanje === 'minted' ? z.en : z.endZnesek, z.chain, cena); ce.appendChild(y); }
      else ce.textContent = m[0];
      r.appendChild(ce);
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

  /* ---------- link with the HEX Stake Screener ---------- */
  var zadnjiKljuc = null, tece = false, cakajoci = null;
  function obdelaj(stakes) {
    var nat = (stakes || []).filter(function (s) {
      return (s.stakeType || 'Native') === 'Native' && !s.unlockedDay && BigInt(s.stakeShares || 0) > 9999n;
    }).slice(0, MAX_STAKOV);
    var kljuc = nat.map(function (s) { return (s.chain || 'pls') + s.stakeId; }).sort().join(',');
    if (kljuc === zadnjiKljuc) return;
    if (tece) { cakajoci = stakes; return; }
    zadnjiKljuc = kljuc;
    if (!nat.length) {
      statEl.textContent = 'No native HEX stakes with 10,000+ shares in these wallets \u2014 Communis bonuses do not apply.';
      opozEl.textContent = ''; denEl.textContent = ''; tabEl.textContent = '';
      return;
    }
    tece = true;
    statEl.textContent = 'Reading Communis for ' + nat.length + ' HEX stake' + (nat.length === 1 ? '' : 's') + '\u2026';
    preberi(nat).then(risi, function (e) { statEl.textContent = 'Could not read Communis: ' + (e && e.message || e); })
      .then(function () {
        tece = false;
        if (cakajoci) { var c = cakajoci; cakajoci = null; obdelaj(c); }
      });
  }

  var izvirnik = renderAll;
  renderAll = function (stakes, liq) {
    var r = izvirnik.apply(this, arguments);
    try { if (sec) obdelaj(stakes); } catch (e) { /* the HEX display stays as in the original */ }
    return r;
  };

  function zacni() {
    zgradi();
    var n = 0;
    (function cakaj() {
      if (vstavi()) {
        try { if (typeof lastStakes !== 'undefined' && lastStakes && lastStakes.length) obdelaj(lastStakes); } catch (e) {}
        return;
      }
      if (++n < 480) setTimeout(cakaj, 250);   // up to 2 min (slow loading)
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
