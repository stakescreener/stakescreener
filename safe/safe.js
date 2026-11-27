/*
 * safe.js - StakeScreener Safe Manager (27 Nov 2026)
 *
 * Manages HEX stakes held in a Safe contract (Staker app smart accounts are Safe 1.3.0).
 * Read-only parts use public RPCs; transactions go only through the wallet injected in the
 * browser (window.ethereum). No WalletConnect, no third-party SDK, no tracking.
 *
 * Transactions: the inner call is wrapped in Safe.execTransaction(to, value, data, 0, 0, 0, 0,
 * 0x0, 0x0, signature) with a "pre-validated" signature (r = owner, s = 0, v = 1). The Safe accepts
 * it when msg.sender is that owner and the threshold is 1 - one transaction, one confirmation.
 * Every action is simulated with eth_call first; a reverted simulation is never sent.
 * Verified 27 Nov 2026: execTransaction simulation from an owner returns true on PulseChain and
 * Ethereum; from a non-owner it reverts with GS025.
 *
 * Early-end penalty = HEX _calcPayoutAndEarlyPenalty, verified 8/8 against real StakeEnd events
 * (payout and penalty equal to the heart, both branches). Late penalty: 1/700 of the return per day
 * after the 14-day grace period.
 */
(function () {
  'use strict';

  var CH = {
    pls: { id: 369, hex: '0x171', name: 'PulseChain', sym: 'PLS', rpc: ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'], tx: 'https://scan.pulsefusion.io/tx/' },
    eth: { id: 1, hex: '0x1', name: 'Ethereum', sym: 'ETH', rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'], tx: 'https://etherscan.io/tx/' }
  };
  var HEX = '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39';
  var HDRN = '0x3819f64f282bf135d62168c1e513280daf905e06';
  var COM = '0x5a9780bfe63f3ec57f01b087cd65bd656c9034a8';
  var TOK = [
    { k: 'HEX', a: HEX, dec: 8 },
    { k: 'HDRN', a: HDRN, dec: 9 },
    { k: 'COM', a: COM, dec: 12 }
  ];
  var S = {
    exec: '0x6a761202', stakeEnd: '0x343009a2', transfer: '0xa9059cbb', mintNative: '0xf812b9a4',
    mintStart: '0x67350ffe', mintEnd: '0xe107625d', nonce: '0xaffed0e0', owners: '0xa0e67e2b',
    threshold: '0xe75235b8', version: '0xffa1ad74', day: '0x5c9302c9', globals: '0xc3124525',
    count: '0x33060d90', list: '0x2607443b', range: '0x6a210a0e', bal: '0x70a08231'
  };
  var ZAGON = Date.UTC(2019, 11, 3);
  var ZERO = '0x0000000000000000000000000000000000000000';

  var st = { ch: 'pls', safe: null, d: null, acc: null, busy: false };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function p64(x) { return BigInt(x).toString(16).padStart(64, '0'); }
  function pa(a) { return a.slice(2).toLowerCase().padStart(64, '0'); }
  function w(r, i) { return BigInt('0x' + ((r || '0x').slice(2 + 64 * i, 2 + 64 * (i + 1)) || '0')); }
  function kratko(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function datum(d) { return new Date(ZAGON + Number(d) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmt(v, dec, maks) {
    var n = Number(v) / Math.pow(10, dec);
    return n.toLocaleString('en-US', { maximumFractionDigits: maks == null ? (n >= 1000 ? 2 : 4) : maks });
  }
  function jeNaslov(a) { return /^0x[0-9a-fA-F]{40}$/.test(a || ''); }
  function enako(a, b) { return a && b && a.toLowerCase() === b.toLowerCase(); }
  function stat(t, err) { var s = $('sm-stat'); s.textContent = t || ''; s.className = 'sm-stat' + (err ? ' err' : ''); }
  function log(t, cls, link) {
    var box = $('sm-log'); box.hidden = false;
    var li = el('div', 'sm-li' + (cls ? ' ' + cls : ''), new Date().toLocaleTimeString() + '  ' + t);
    if (link) { li.appendChild(document.createTextNode(' ')); var a = el('a', null, 'view \u2197'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; li.appendChild(a); }
    $('sm-logi').insertBefore(li, $('sm-logi').firstChild);
  }

  function rpc(ch, klici) {
    var urls = CH[ch].rpc, i = 0;
    function poskus() {
      if (i >= urls.length) return Promise.reject(new Error('RPC not reachable (' + CH[ch].name + ')'));
      var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 20000);
      return fetch(urls[i++], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(klici), signal: ac.signal })
        .then(function (r) { clearTimeout(t); return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { if (!Array.isArray(j)) return Promise.reject(new Error('bad answer')); var po = {}; j.forEach(function (x) { po[x.id] = x; }); return klici.map(function (k) { return po[k.id] || {}; }); })
        .catch(poskus);
    }
    return poskus();
  }
  function klic(id, to, data, from) { var p = { to: to, data: data }; if (from) p.from = from; return { jsonrpc: '2.0', id: id, method: 'eth_call', params: [p, 'latest'] }; }
  function res(x) { return x && x.result != null ? x.result : null; }
  function napaka(x) { var e = x && x.error; if (!e) return null; var m = e.message || 'reverted'; if (e.data && typeof e.data === 'string' && e.data.length > 10) { var r = razlog(e.data); if (r) m += ': ' + r; } return m; }
  function razlog(data) { // Error(string)
    try { if (data.slice(0, 10) !== '0x08c379a0') return ''; var n = parseInt(data.slice(74, 138), 16); var h = data.slice(138, 138 + n * 2), s = ''; for (var i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return s; } catch (e) { return ''; }
  }

  /* ---------- HEX maths (as in the HEX contract) ---------- */
  var M72 = (1n << 72n) - 1n;
  function vsota(rr, shares) {
    if (!rr || rr.length < 130) return 0n;
    var n = Number(w(rr, 1)), s = 0n;
    for (var i = 0; i < n; i++) { var d = w(rr, 2 + i), pay = d & M72, sh = (d >> 72n) & M72; if (sh > 0n) s += shares * pay / sh; }
    return s;
  }
  // payout over [b, e) from a dailyData array that starts at day `od`
  function izplacilo(arr, od, shares, b, e) {
    var s = 0n;
    for (var d = b; d < e; d++) { var x = arr[d - od]; if (x == null) break; var pay = x & M72, sh = (x >> 72n) & M72; if (sh > 0n) s += shares * pay / sh; }
    return s;
  }
  function razbij(rr) { var n = rr && rr.length >= 130 ? Number(w(rr, 1)) : 0, a = []; for (var i = 0; i < n; i++) a.push(w(rr, 2 + i)); return a; }
  // value if ended now: { payout, penalty, ret, early, late }
  function koncajZdaj(s, dan, arr) {
    var locked = Number(s.locked), staked = Number(s.days), served = Math.max(0, Number(dan) - locked);
    var hearts = s.hearts, shares = s.shares, payout = 0n, pen = 0n;
    if (served < staked) {
      if (served === 0) return { payout: 0n, penalty: 0n, ret: hearts, early: true, served: 0, nopen: true };
      var pd = Math.floor((staked + 1) / 2); if (pd < 90) pd = 90;
      if (pd < served) { pen = izplacilo(arr, locked, shares, locked, locked + pd); payout = pen + izplacilo(arr, locked, shares, locked + pd, locked + served); }
      else { payout = izplacilo(arr, locked, shares, locked, locked + served); pen = pd === served ? payout : payout * BigInt(pd) / BigInt(served); }
      var ret = hearts + payout, cap = pen;
      if (pen > ret) { cap = ret; ret = 0n; } else ret -= pen;
      return { payout: payout, penalty: cap, ret: ret, early: true, served: served };
    }
    payout = izplacilo(arr, locked, shares, locked, locked + staked);
    var r = hearts + payout, lateDays = Number(dan) - (locked + staked) - 14, lp = 0n;
    if (lateDays > 0) { lp = r * BigInt(lateDays) / 700n; if (lp > r) lp = r; }
    return { payout: payout, penalty: lp, ret: r - lp, early: false, late: lateDays > 0, served: staked };
  }

  /* ---------- Safe transaction ---------- */
  function execData(to, value, data, owner) {
    var body = (data || '0x').slice(2), len = body.length / 2;
    var padded = body + '0'.repeat((64 - (body.length % 64)) % 64);
    var sig = pa(owner) + p64(0) + '01';
    var sigPad = sig + '0'.repeat((64 - (sig.length % 64)) % 64);
    var dataOff = 10 * 32, sigOff = dataOff + 32 + padded.length / 2;
    return S.exec + pa(to) + p64(value || 0) + p64(dataOff) + p64(0) + p64(0) + p64(0) + p64(0) + pa(ZERO) + pa(ZERO) + p64(sigOff) +
      p64(len) + padded + p64(65) + sigPad;
  }

  /* ---------- reading ---------- */
  function preberi() {
    var ch = st.ch, a = st.safe;
    var k = [
      { jsonrpc: '2.0', id: 0, method: 'eth_getCode', params: [a, 'latest'] },
      klic(1, a, S.owners), klic(2, a, S.threshold), klic(3, a, S.nonce), klic(4, a, S.version),
      { jsonrpc: '2.0', id: 5, method: 'eth_getBalance', params: [a, 'latest'] },
      klic(6, HEX, S.day), klic(7, HEX, S.globals), klic(8, HEX, S.count + pa(a))
    ];
    TOK.forEach(function (t, i) { k.push(klic(9 + i, t.a, S.bal + pa(a))); });
    return rpc(ch, k).then(function (r) {
      var code = res(r[0]);
      if (!code || code === '0x') throw new Error('This address is not a contract on ' + CH[ch].name + '.');
      var ow = res(r[1]), th = res(r[2]);
      if (!ow || ow.length < 130 || !th) throw new Error('This contract is not a Safe (no getOwners / getThreshold).');
      var n = Number(w(ow, 1)), owners = [];
      for (var i = 0; i < n; i++) owners.push('0x' + ow.slice(2 + 64 * (2 + i) + 24, 2 + 64 * (3 + i)));
      var ver = '';
      try { var v = res(r[4]); var L = parseInt(v.slice(66, 130), 16); var h = v.slice(130, 130 + L * 2); for (var j = 0; j < h.length; j += 2) ver += String.fromCharCode(parseInt(h.substr(j, 2), 16)); } catch (e) { ver = '?'; }
      var d = {
        owners: owners, threshold: Number(w(th, 0)), nonce: Number(w(res(r[3]), 0)), version: ver,
        native: BigInt(res(r[5]) || '0x0'), dan: w(res(r[6]), 0), ddc: w(res(r[7]), 4), nSt: Number(w(res(r[8]), 0)),
        tok: TOK.map(function (t, i) { return w(res(r[9 + i]), 0); }), stakes: []
      };
      if (!d.nSt) return d;
      var k2 = [];
      for (var s = 0; s < d.nSt; s++) k2.push(klic(s, HEX, S.list + pa(a) + p64(s)));
      return rpc(ch, k2).then(function (r2) {
        r2.forEach(function (x, i) {
          var o = res(x);
          d.stakes.push({ idx: i, id: w(o, 0), hearts: w(o, 1), shares: w(o, 2), locked: w(o, 3), days: w(o, 4), unlocked: w(o, 5) });
        });
        // daily data + simulations (Hedron mint, Communis bonuses) per stake
        var k3 = [], id = 0;
        d.stakes.forEach(function (s) {
          var konec = s.locked + s.days < d.ddc ? s.locked + s.days : d.ddc;
          s.kRange = id; k3.push(klic(id++, HEX, S.range + p64(s.locked) + p64(konec > s.locked ? konec : s.locked)));
          s.kHdrn = id; k3.push(klic(id++, HDRN, S.mintNative + p64(s.idx) + p64(s.id), a));
          s.kComS = id; k3.push(klic(id++, COM, S.mintStart + p64(s.idx) + p64(s.id) + p64(0) + pa(a) + p64(0), a));
          s.kComE = id; k3.push(klic(id++, COM, S.mintEnd + p64(s.idx) + p64(s.id) + pa(a) + p64(0), a));
        });
        return rpc(ch, k3).then(function (r3) {
          d.stakes.forEach(function (s) {
            var rr = res(r3[s.kRange]);
            s.arr = razbij(rr);
            s.yieldNow = vsota(rr, s.shares);
            s.end = koncajZdaj(s, d.dan, s.arr);
            var h = r3[s.kHdrn]; s.hdrn = res(h) ? w(res(h), 0) : null; s.hdrnErr = napaka(h);
            s.comS = !!res(r3[s.kComS]) && !r3[s.kComS].error; s.comE = !!res(r3[s.kComE]) && !r3[s.kComE].error;
          });
          return d;
        });
      });
    });
  }

  /* ---------- display ---------- */
  function jazLastnik() { return st.acc && st.d && st.d.owners.some(function (o) { return enako(o, st.acc); }); }
  function lahkoPisem() { return jazLastnik() && st.d.threshold === 1 && st.walletCh === CH[st.ch].hex; }

  function risiInfo() {
    var d = st.d, c = CH[st.ch], box = $('sm-info'); box.hidden = false; box.textContent = '';
    box.appendChild(el('div', 'sm-lbl', 'Safe \u00b7 ' + c.name + ' \u00b7 version ' + d.version + ' \u00b7 nonce ' + d.nonce));
    var g = el('div', 'sm-grid');
    function kv(k, v, sub) { var x = el('div'); x.appendChild(el('div', 'sm-k', k)); var vv = el('div', 'sm-v', v); if (sub) vv.appendChild(el('small', null, ' ' + sub)); x.appendChild(vv); g.appendChild(x); }
    kv(c.sym, fmt(d.native, 18));
    TOK.forEach(function (t, i) { kv(t.k, fmt(d.tok[i], t.dec)); });
    kv('HEX stakes', String(d.nSt));
    kv('Signatures needed', d.threshold + ' of ' + d.owners.length);
    box.appendChild(g);
    var o = el('div', 'sm-own'); o.appendChild(el('div', 'sm-k', 'Owners'));
    d.owners.forEach(function (x) { o.appendChild(el('div', enako(x, st.acc) ? 'sm-me' : null, x + (enako(x, st.acc) ? '  \u2190 connected' : ''))); });
    box.appendChild(o);
    var msg;
    if (d.threshold !== 1) msg = el('div', 'sm-warn', 'This Safe needs ' + d.threshold + ' signatures. This page shows it read-only; use Safe{Wallet} to collect the signatures.');
    else if (!st.acc) msg = el('div', 'sm-warn', 'Connect a wallet that is one of the owners above to end stakes, mint or send.');
    else if (!jazLastnik()) msg = el('div', 'sm-warn', 'The connected wallet ' + kratko(st.acc) + ' is not an owner of this Safe on ' + c.name + '. Switch to an owner account in your wallet.');
    else if (st.walletCh !== c.hex) msg = el('div', 'sm-warn', 'Your wallet is on another network. Actions will ask it to switch to ' + c.name + '.');
    else msg = el('div', 'sm-ok', 'Connected as owner ' + kratko(st.acc) + ' \u2014 each action is one transaction confirmed in your wallet.');
    box.appendChild(msg);
  }

  function gumb(txt, cls, fn, dis) { var b = el('button', 'sm-btn sm-btn-s' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.disabled = !!dis; b.addEventListener('click', fn); return b; }

  function risiStake() {
    var d = st.d, box = $('sm-stakes'); box.hidden = false; box.textContent = '';
    box.appendChild(el('div', 'sm-lbl', 'HEX stakes \u2014 HEX day ' + d.dan + ' (' + datum(d.dan) + ')'));
    if (!d.stakes.length) { box.appendChild(el('div', 'sm-stat', 'No HEX stakes in this Safe on ' + CH[st.ch].name + '.')); return; }
    var tw = el('div', 'sm-tw'), t = el('table', 'sm-t'), th = el('tr');
    [['Stake'], ['Principal'], ['Served'], ['Value now'], ['If ended now'], ['HDRN to mint'], ['Actions']].forEach(function (x) { th.appendChild(el('th', x[1] || null, x[0])); });
    var thead = el('thead'); thead.appendChild(th); t.appendChild(thead);
    var tb = el('tbody');
    d.stakes.forEach(function (s) {
      var r = el('tr'), served = Math.max(0, Number(d.dan - s.locked)), dni = Number(s.days), konec = s.locked + s.days;
      var c1 = el('td'); c1.appendChild(el('b', null, '#' + s.id)); c1.appendChild(el('span', 'sm-sub', datum(s.locked) + ' \u2192 ' + datum(konec))); r.appendChild(c1);
      var c2 = el('td', null, fmt(s.hearts, 8) + ' HEX'); c2.appendChild(el('span', 'sm-sub', (Number(s.shares) / 1e12).toFixed(4) + ' T-shares')); r.appendChild(c2);
      var c4 = el('td', null, Math.min(served, dni) + ' / ' + dni + ' d'); var bar = el('div', 'sm-bar'), bi = el('i'); bi.style.width = Math.min(100, served / dni * 100).toFixed(1) + '%'; bar.appendChild(bi); c4.appendChild(bar); r.appendChild(c4);
      r.appendChild(el('td', null, fmt(s.hearts + s.yieldNow, 8) + ' HEX'));
      var e = s.end, c6 = el('td');
      if (e.early) { c6.appendChild(el('span', null, fmt(e.ret, 8) + ' HEX')); c6.appendChild(el('span', 'sm-sub', 'penalty ' + fmt(e.penalty, 8) + ' HEX')); }
      else { c6.appendChild(el('span', null, fmt(e.ret, 8) + ' HEX')); c6.appendChild(el('span', 'sm-sub', e.late ? 'late penalty ' + fmt(e.penalty, 8) : 'no penalty \u2014 due')); }
      r.appendChild(c6);
      r.appendChild(el('td', null, s.hdrn != null ? fmt(s.hdrn, 9, 0) : '\u2014'));
      var c8 = el('td', 'sm-act'), acts = el('div', 'sm-acts'), ok = lahkoPisem() || (jazLastnik() && st.d.threshold === 1);
      if (e.early) acts.appendChild(gumb('Emergency end (EES)', 'sm-btn-w', function () { eesPotrdi(s, c8); }, !ok));
      else acts.appendChild(gumb('End stake', 'sm-btn-p', function () { izvedi(HEX, 0n, S.stakeEnd + p64(s.idx) + p64(s.id), 'End stake #' + s.id); }, !ok));
      acts.appendChild(gumb('Mint HDRN', null, function () { izvedi(HDRN, 0n, S.mintNative + p64(s.idx) + p64(s.id), 'Mint HDRN for #' + s.id); }, !ok || !(s.hdrn > 0n)));
      if (s.comS) acts.appendChild(gumb('Mint COM start bonus', null, function () { izvedi(COM, 0n, S.mintStart + p64(s.idx) + p64(s.id) + p64(0) + pa(st.safe) + p64(0), 'Mint COM start bonus for #' + s.id); }, !ok));
      if (s.comE) acts.appendChild(gumb('Mint COM end bonus', null, function () { izvedi(COM, 0n, S.mintEnd + p64(s.idx) + p64(s.id) + pa(st.safe) + p64(0), 'Mint COM end bonus for #' + s.id); }, !ok));
      c8.appendChild(acts); r.appendChild(c8);
      // labels for the phone layout (cells become rows)
      ['Stake', 'Principal', 'Served', 'Value now', 'If ended now', 'HDRN to mint', 'Actions'].forEach(function (l, i) { if (r.children[i]) r.children[i].setAttribute('data-l', l); });
      tb.appendChild(r);
    });
    t.appendChild(tb); tw.appendChild(t); box.appendChild(tw);
    box.appendChild(el('div', 'sm-stat', 'Value now = principal + yield to date. HDRN and COM buttons appear active only when the contract simulation says the mint would succeed. Communis bonuses follow the Communis rules (start bonus \u2265180 days; end bonus within 37 days after the end date). Mint COM before ending a stake.'));
  }

  function eesPotrdi(s, celica) {
    var stara = celica.querySelector('.sm-ees'); if (stara) { stara.parentNode.removeChild(stara); return; }
    var e = s.end, box = el('div', 'sm-ees');
    box.appendChild(el('div', null, 'Ending #' + s.id + ' early, ' + e.served + ' of ' + Number(s.days) + ' days served:'));
    var b = el('div'); b.appendChild(document.createTextNode('You receive about ')); b.appendChild(el('b', null, fmt(e.ret, 8) + ' HEX')); b.appendChild(document.createTextNode(' \u2014 HEX keeps a penalty of ')); b.appendChild(el('b', null, fmt(e.penalty, 8) + ' HEX')); b.appendChild(document.createTextNode('.')); box.appendChild(b);
    box.appendChild(el('div', null, 'If you wait until ' + datum(s.locked + s.days) + ', there is no penalty. The amount above uses the HEX data stored up to now; the contract updates it to the exact day when the stake ends.'));
    var row = el('div', 'sm-acts'); row.style.marginTop = '8px';
    row.appendChild(gumb('Confirm emergency end', 'sm-btn-w', function () { izvedi(HEX, 0n, S.stakeEnd + p64(s.idx) + p64(s.id), 'Emergency end #' + s.id); }));
    row.appendChild(gumb('Cancel', null, function () { box.parentNode.removeChild(box); }));
    box.appendChild(row); celica.appendChild(box);
  }

  function risiSend() {
    var d = st.d, c = CH[st.ch], box = $('sm-send'); box.hidden = false; box.textContent = '';
    box.appendChild(el('div', 'sm-lbl', 'Send from the Safe'));
    var row = el('div', 'sm-row');
    var sel = el('select', 'sm-in');
    var opts = [{ k: c.sym, dec: 18, bal: d.native, a: null }].concat(TOK.map(function (t, i) { return { k: t.k, dec: t.dec, bal: d.tok[i], a: t.a }; }));
    opts.forEach(function (o, i) { var op = el('option', null, o.k + ' \u2014 ' + fmt(o.bal, o.dec)); op.value = i; sel.appendChild(op); });
    var to = el('input', 'sm-in'); to.placeholder = 'Recipient 0x\u2026'; to.spellcheck = false; if (st.acc) to.value = st.acc;
    var amt = el('input', 'sm-in sm-sm'); amt.placeholder = 'Amount'; amt.inputMode = 'decimal';
    var max = gumb('Max', null, function () { var o = opts[sel.value]; amt.value = (Number(o.bal) / Math.pow(10, o.dec)).toString(); });
    var send = gumb('Send', 'sm-btn-p', function () {
      var o = opts[sel.value];
      if (!jeNaslov(to.value.trim())) { stat('Recipient is not a valid address.', true); return; }
      var v = vNajmanjse(amt.value, o.dec); if (v == null || v <= 0n) { stat('Enter an amount.', true); return; }
      if (v > o.bal) { stat('Amount is larger than the Safe balance.', true); return; }
      var rcp = to.value.trim();
      if (o.a) izvedi(o.a, 0n, S.transfer + pa(rcp) + p64(v), 'Send ' + amt.value + ' ' + o.k + ' to ' + kratko(rcp));
      else izvedi(rcp, v, '0x', 'Send ' + amt.value + ' ' + o.k + ' to ' + kratko(rcp));
    }, !(jazLastnik() && d.threshold === 1));
    row.appendChild(sel); row.appendChild(to); row.appendChild(amt); row.appendChild(max); row.appendChild(send);
    box.appendChild(row);
    box.appendChild(el('div', 'sm-stat', 'The recipient defaults to your connected wallet. Double-check it: a transfer cannot be undone.'));
  }
  function vNajmanjse(s, dec) {
    s = String(s || '').trim().replace(',', '.'); if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    var p = s.split('.'), f = (p[1] || '').slice(0, dec).padEnd(dec, '0');
    return BigInt(p[0] || '0') * (10n ** BigInt(dec)) + BigInt(f || '0');
  }

  function risi() { risiInfo(); risiStake(); risiSend(); }

  function nalozi() {
    var a = $('sm-addr').value.trim();
    if (!jeNaslov(a)) { stat('Enter a Safe address (0x\u2026, 40 hex characters).', true); return; }
    st.safe = a; try { history.replaceState(null, '', '#' + a + (st.ch === 'eth' ? '&eth' : '')); } catch (e) {}
    stat('Reading the Safe on ' + CH[st.ch].name + '\u2026');
    ['sm-info', 'sm-stakes', 'sm-send'].forEach(function (id) { $(id).hidden = true; });
    preberi().then(function (d) { st.d = d; stat(''); risi(); }, function (e) { st.d = null; stat(e.message || String(e), true); });
  }

  /* ---------- wallet ---------- */
  function eth() { return window.ethereum; }
  function povezi() {
    if (!eth()) { stat('No wallet found in this browser. Install or unlock MetaMask, Rabby or OKX Wallet.', true); return; }
    eth().request({ method: 'eth_requestAccounts' }).then(function (acc) {
      st.acc = acc && acc[0] || null;
      return eth().request({ method: 'eth_chainId' });
    }).then(function (cid) { st.walletCh = String(cid).toLowerCase(); osveziAcc(); if (st.d) risi(); })
      .catch(function (e) { stat('Wallet: ' + (e && e.message || e), true); });
  }
  function osveziAcc() {
    $('sm-acc').textContent = st.acc ? kratko(st.acc) + ' \u00b7 ' + (st.walletCh === '0x171' ? 'PulseChain' : st.walletCh === '0x1' ? 'Ethereum' : 'chain ' + parseInt(st.walletCh, 16)) : '';
    $('sm-connect').textContent = st.acc ? 'Connected' : 'Connect wallet';
  }
  function zamenjajVerigo() {
    var c = CH[st.ch];
    if (st.walletCh === c.hex) return Promise.resolve();
    return eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: c.hex }] })
      .then(function () { st.walletCh = c.hex; osveziAcc(); });
  }

  function izvedi(to, value, data, opis) {
    if (st.busy) return;
    if (!st.acc) { povezi(); return; }
    if (!jazLastnik()) { stat('The connected wallet is not an owner of this Safe on ' + CH[st.ch].name + '.', true); return; }
    if (st.d.threshold !== 1) { stat('This Safe needs more than one signature.', true); return; }
    st.busy = true;
    var c = CH[st.ch], ex = execData(to, value, data, st.acc);
    log(opis + ': simulating\u2026');
    rpc(st.ch, [klic(0, st.safe, ex, st.acc), klic(1, to, data, st.safe)]).then(function (r) {
      var napE = napaka(r[0]), ok = res(r[0]) && w(res(r[0]), 0) === 1n;
      if (napE || !ok) {
        var inner = napaka(r[1]);
        throw new Error('simulation failed \u2014 nothing was sent (' + (inner || napE || 'execTransaction returned false') + ')');
      }
      log(opis + ': simulation OK, confirm in your wallet', 'ok');
      return zamenjajVerigo();
    }).then(function () {
      return eth().request({ method: 'eth_sendTransaction', params: [{ from: st.acc, to: st.safe, data: ex, value: '0x0' }] });
    }).then(function (hash) {
      log(opis + ': sent ' + kratko(hash), 'ok', c.tx + hash);
      return cakaj(hash).then(function (ok) {
        log(opis + (ok ? ': confirmed' : ': FAILED on chain'), ok ? 'ok' : 'err', c.tx + hash);
        nalozi();
      });
    }).catch(function (e) {
      log(opis + ': ' + (e && (e.message || e.code) || e), 'err');
    }).then(function () { st.busy = false; });
  }
  function cakaj(hash) {
    return new Promise(function (ok) {
      var n = 0;
      (function poll() {
        rpc(st.ch, [{ jsonrpc: '2.0', id: 0, method: 'eth_getTransactionReceipt', params: [hash] }]).then(function (r) {
          var rc = res(r[0]);
          if (rc) { ok(rc.status === '0x1'); return; }
          if (++n < 90) setTimeout(poll, 4000); else ok(false);
        }, function () { if (++n < 90) setTimeout(poll, 4000); else ok(false); });
      })();
    });
  }

  /* ---------- start ---------- */
  function zacni() {
    [].slice.call(document.querySelectorAll('.sm-ch')).forEach(function (b) {
      b.addEventListener('click', function () {
        st.ch = b.getAttribute('data-ch');
        [].slice.call(document.querySelectorAll('.sm-ch')).forEach(function (x) { x.classList.toggle('on', x === b); });
        if (jeNaslov($('sm-addr').value.trim())) nalozi();
      });
    });
    $('sm-load').addEventListener('click', nalozi);
    $('sm-addr').addEventListener('keydown', function (e) { if (e.key === 'Enter') nalozi(); });
    $('sm-connect').addEventListener('click', povezi);
    if (eth() && eth().on) {
      eth().on('accountsChanged', function (a) { st.acc = a && a[0] || null; osveziAcc(); if (st.d) risi(); });
      eth().on('chainChanged', function (c) { st.walletCh = String(c).toLowerCase(); osveziAcc(); if (st.d) risi(); });
    }
    var h = (location.hash || '').slice(1).split('&');
    if (jeNaslov(h[0])) {
      $('sm-addr').value = h[0];
      if (h.indexOf('eth') > 0) { st.ch = 'eth'; [].slice.call(document.querySelectorAll('.sm-ch')).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-ch') === 'eth'); }); }
      nalozi();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni); else zacni();
})();
