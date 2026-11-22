/*
 * gp-validatorji.js \u2014 StakeScreener: odsek "VALIDATOR Screener" (PulseChain), 22. 11. 2026
 *
 * Samo branje. Viri:
 *  - FusionScan  /api/v2/addresses/{naslov}/withdrawals  -> katere validatorje izplacuje naslov
 *                                                           (stevilka validatorja, znesek, cas)
 *  - PublicNode beacon API /eth/v1/beacon/states/head/validators?id=...  -> status, stanje
 *  - DexScreener (WPLS) -> cena PLS v $
 * Validatorji se najdejo iz denarnic v Wallets Screenerju (gopulse_wallets); dodatno jih lahko
 * uporabnik vpise rocno (stevilka ali javni kljuc, gopulse_val_ids).
 * Kartica "Validators" zgoraj se nastavi samodejno, razen ce je uporabnik stevilo vpisal sam
 * (gopulse_val_auto hrani zadnjo samodejno vrednost).
 * app.js in denarnica.js ostaneta nespremenjena.
 */
(function () {
  'use strict';

  var BEACON = 'https://pulsechain-beacon-api.publicnode.com';
  var SCAN = 'https://scan.pulsefusion.io';
  var DEX = 'https://api.dexscreener.com/latest/dex/tokens/0xa1077a294dde1b09bb078844df40758a5d0f9a27';
  var WPLS = '0xa1077a294dde1b09bb078844df40758a5d0f9a27';
  var K_WAL = 'gopulse_wallets', K_LAB = 'gopulse_labels', K_IDS = 'gopulse_val_ids';
  var K_VAL = 'gopulse_validators', K_AUTO = 'gopulse_val_auto';
  var MAX_VAL = 100;        // najvec prikazanih validatorjev
  var MAX_STRANI = 12;      // najvec strani izplacil (po 50) na naslov
  var MAX_ROCNO = 50;
  var DAN = 86400000;
  var ALLNODES = 'https://www.allnodes.com/invite/4skdii';   // povezava s priporocilom (referral)
  // Vouch referral ID 20 (izplacilo na Stakescreener 07). Pristojbino placa uporabnik ob pologu;
  // ce se nastavitev kode spremeni na app.vouch.run/referral, popravi VOUCH_PRISTOJBINA in info.html.
  var VOUCH = 'https://refwidget.vouch.run/?ref=20';
  var VPLS = '0x79bb3a0ee435f957ce4f54ee8c3cfadc7278da0c';   // Vouch Staked PLS (LsdToken)
  var RPC = ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com'];
  var VOUCH_PRISTOJBINA = '0.3% fee, max 5,000 PLS per deposit, paid to StakeScreener';

  /* ---------- pomozno ---------- */
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function beri(k, privzeto) {
    try { var v = localStorage.getItem(k); return v == null ? privzeto : JSON.parse(v); } catch (e) { return privzeto; }
  }
  function pisi(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function denarnice() {
    var a = beri(K_WAL, []);
    return Array.isArray(a) ? a.filter(function (x) { return /^0x[0-9a-fA-F]{40}$/.test(x); })
      .map(function (x) { return x.toLowerCase(); }) : [];
  }
  function oznaka(a) { var l = beri(K_LAB, {}); return (l && l[a]) || ''; }
  function kratko(a) { return a ? a.slice(0, 6) + '\u2026' + a.slice(-4) : '\u2014'; }
  function rocni() {
    var a = beri(K_IDS, []);
    return Array.isArray(a) ? a.filter(veljavenId).slice(0, MAX_ROCNO) : [];
  }
  function veljavenId(s) { return /^\d{1,8}$/.test(s) || /^0x[0-9a-f]{96}$/.test(s); }
  function zaspi(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pridobi(url, poskus) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (t) clearTimeout(t);
      if (r.status === 429 && !poskus) return zaspi(2500).then(function () { return pridobi(url, 1); });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  // zneski: izplacila v wei (1e18), beacon v gwei (1e9) -> PLS
  function izWei(s) { try { var b = BigInt(s); return Number(b / 1000000000n) / 1e9; } catch (e) { return 0; } }
  function izGwei(s) { return Number(s || 0) / 1e9; }

  function pls(n) {
    if (n >= 1e6) return (n / 1e6).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + 'M';
    return Math.round(n).toLocaleString('en-US');
  }
  function usd(n) {
    if (n == null || !isFinite(n)) return '';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function kdaj(ts) {
    if (!ts) return '\u2014';
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return m + ' min ago';
    if (m < 2880) return Math.round(m / 60) + ' h ago';
    return Math.round(m / 1440) + ' days ago';
  }

  var STATUS = {
    pending_initialized: ['Pending', 'cak'], pending_queued: ['Pending', 'cak'],
    active_ongoing: ['Active', 'akt'], active_exiting: ['Exiting', 'izh'], active_slashed: ['Slashed', 'kaz'],
    exited_unslashed: ['Exited', 'izs'], exited_slashed: ['Slashed', 'kaz'],
    withdrawal_possible: ['Exited', 'izs'], withdrawal_done: ['Withdrawn', 'izs']
  };
  function steje(st) { return /^(active_|pending_)/.test(st || ''); }

  /* ---------- podatki ---------- */
  function cenaPls() {
    return pridobi(DEX).then(function (j) {
      var naj = null;
      (j.pairs || []).forEach(function (p) {
        if (p.chainId !== 'pulsechain' || !p.baseToken || p.baseToken.address.toLowerCase() !== WPLS) return;
        var l = (p.liquidity && p.liquidity.usd) || 0;
        if (!naj || l > naj.l) naj = { l: l, px: Number(p.priceUsd) };
      });
      return naj && isFinite(naj.px) ? naj.px : null;
    }).catch(function () { return null; });
  }

  // Izplacila na naslov (najnovejsa najprej), dokler ne pokrijemo 30 dni ali MAX_STRANI.
  function izplacila(naslov) {
    var meja = Date.now() - 30 * DAN;
    var vse = [], strani = 0;
    function stran(qs) {
      strani++;
      return pridobi(SCAN + '/api/v2/addresses/' + naslov + '/withdrawals' + (qs ? '?' + qs : '')).then(function (j) {
        var it = j.items || [];
        it.forEach(function (w) {
          vse.push({ idx: String(w.validator_index), pls: izWei(w.amount), ts: Date.parse(w.timestamp) });
        });
        var najst = it.length ? Date.parse(it[it.length - 1].timestamp) : 0;
        var naprej = j.next_page_params;
        if (!naprej || !it.length || najst < meja) return { vse: vse, popolno: true, najst: najst };
        if (strani >= MAX_STRANI) return { vse: vse, popolno: false, najst: najst };
        var q = Object.keys(naprej).map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(naprej[k]);
        }).join('&');
        return zaspi(200).then(function () { return stran(q); });
      });
    }
    return stran('');
  }

  function beacon(ids) {
    var kosi = [], out = [];
    for (var i = 0; i < ids.length; i += 40) kosi.push(ids.slice(i, i + 40));
    return kosi.reduce(function (p, kos) {
      return p.then(function () {
        return pridobi(BEACON + '/eth/v1/beacon/states/head/validators?id=' + kos.join(',')).then(function (j) {
          (j.data || []).forEach(function (v) { out.push(v); });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  function naslovIz(cred) {
    return /^0x0[12]/.test(cred || '') ? '0x' + cred.slice(-40).toLowerCase() : null;
  }

  /* ---------- prikaz ---------- */
  var sec, statEl, povEl, tabEl, rocEl, namigEl, vnos, refEl, vouchEl;
  var tece = false, zadnjiWal = null, zadnjiIds = null;
  var slabiVnos = '';   // zadnji neveljavni rocni vnos (sporocilo ostane po nalaganju)

  function zgradi() {
    sec = el('div', null); sec.id = 'gpv-sec';
    var hdr = el('div', 'wbal-hdr gpv-hdr');
    hdr.appendChild(el('span', 'wbal-title', 'VALIDATOR'));
    hdr.appendChild(el('span', 'wbal-title2', 'Screener'));
    hdr.appendChild(el('span', 'gpv-veriga', 'PulseChain'));
    var osv = el('button', 'wbal-btn', 'Refresh'); osv.type = 'button';
    osv.addEventListener('click', function () { nalozi(); });
    hdr.appendChild(osv);
    sec.appendChild(hdr);

    var add = el('div', 'wbal-add gpv-add');
    vnos = el('input', 'wbal-input wbal-input-wide');
    vnos.type = 'text';
    vnos.placeholder = 'Add validator index or public key \u2014 several separated by commas';
    vnos.setAttribute('aria-label', 'Validator index or public key');
    var dodaj = el('button', 'wbal-btn', 'Add'); dodaj.type = 'button';
    function dodajRocno() {
      var nov = (vnos.value || '').split(/[\s,;]+/).map(function (s) { return s.trim().toLowerCase(); })
        .filter(function (s) { return s; });
      var slabi = nov.filter(function (s) { return !veljavenId(s); });
      var r = rocni();
      nov.filter(veljavenId).forEach(function (s) {
        if (/^\d+$/.test(s)) s = String(parseInt(s, 10));
        if (r.indexOf(s) < 0 && r.length < MAX_ROCNO) r.push(s);
      });
      pisi(K_IDS, r);
      vnos.value = slabi.join(', ');
      slabiVnos = slabi.length ? 'Not a validator index or public key: ' + slabi.join(', ') : '';
      risiRocne(); nalozi();
    }
    dodaj.addEventListener('click', dodajRocno);
    vnos.addEventListener('keydown', function (e) { if (e.key === 'Enter') dodajRocno(); });
    add.appendChild(vnos); add.appendChild(dodaj);
    sec.appendChild(add);

    rocEl = el('div', 'gpv-rocni'); sec.appendChild(rocEl);
    statEl = el('div', 'wbal-note gpv-stanje'); sec.appendChild(statEl);
    namigEl = el('div', 'gpv-namig'); sec.appendChild(namigEl);
    povEl = el('div', 'gpv-pov'); sec.appendChild(povEl);
    tabEl = el('div', 'gpv-tab'); sec.appendChild(tabEl);
    vouchEl = el('div', 'gpv-vouch'); sec.appendChild(vouchEl);
    refEl = el('div', 'gpv-ref'); sec.appendChild(refEl);
    sec.appendChild(el('div', 'wbal-note gpv-opomba',
      'Read-only. Validators are found from the payouts (withdrawals) to the wallets above \u2014 FusionScan \u2014 ' +
      'or added by index / public key. Status and balance come from the PulseChain beacon chain (PublicNode). ' +
      'Payouts are what was swept to the withdrawal address; 7-day APR is an estimate from those payouts. ' +
      'Nothing is stored on a server and no wallet is connected. Informational only, not financial advice.'));
    sec.appendChild(el('div', 'gp-loc'));
    risiRocne();
  }

  // Allnodes: vidnejse, ko validatorjev ni; sicer drobna vrstica. Vedno oznaceno kot referral.
  function povezava(txt, url) {
    var a = el('a', null, txt);
    a.href = url; a.target = '_blank'; a.rel = 'sponsored noopener';
    return a;
  }
  function priporocilo(veliko) {
    refEl.textContent = '';
    refEl.className = 'gpv-ref' + (veliko ? ' gpv-ref-vel' : '');
    if (veliko) {
      var v1 = el('div', 'gpv-ref-vr');
      v1.appendChild(el('b', null, 'Don\u2019t run a validator yet? '));
      v1.appendChild(el('span', null, 'Allnodes offers hosted PulseChain validators \u2014 no hardware or setup needed. '));
      v1.appendChild(povezava('Get started with Allnodes \u2192', ALLNODES));
      v1.appendChild(el('span', 'gpv-ref-oz', ' (referral link)'));
      var v2 = el('div', 'gpv-ref-vr');
      v2.appendChild(el('b', null, 'Less than 32M PLS? '));
      v2.appendChild(el('span', null, 'Liquid staking with Vouch \u2014 stake any amount and receive vPLS. '));
      v2.appendChild(povezava('Stake with Vouch \u2192', VOUCH));
      v2.appendChild(el('span', 'gpv-ref-oz', ' (referral link \u2014 ' + VOUCH_PRISTOJBINA + ')'));
      refEl.appendChild(v1); refEl.appendChild(v2);
    } else {
      refEl.appendChild(el('span', null, 'Hosted validators: '));
      refEl.appendChild(povezava('Allnodes', ALLNODES));
      refEl.appendChild(el('span', 'gpv-ref-oz', ' (referral link)'));
      refEl.appendChild(el('span', null, ' \u00b7 Liquid staking: '));
      refEl.appendChild(povezava('Vouch', VOUCH));
      refEl.appendChild(el('span', 'gpv-ref-oz', ' (referral link \u2014 ' + VOUCH_PRISTOJBINA + ')'));
    }
  }

  function risiRocne() {
    rocEl.textContent = '';
    var r = rocni();
    if (!r.length) return;
    rocEl.appendChild(el('span', 'gpv-rocni-lbl', 'Added by you:'));
    r.forEach(function (id) {
      var c = el('span', 'gpv-chip', /^\d+$/.test(id) ? '#' + id : kratko(id));
      c.title = id;
      var x = el('button', 'gpv-chip-x', '\u00d7'); x.type = 'button';
      x.setAttribute('aria-label', 'Remove ' + id);
      x.addEventListener('click', function () {
        pisi(K_IDS, rocni().filter(function (s) { return s !== id; }));
        risiRocne(); nalozi();
      });
      c.appendChild(x);
      rocEl.appendChild(c);
    });
  }

  function vstavi() {
    var w = document.getElementById('wbal-sec');
    if (!w || !w.parentNode) return false;
    w.parentNode.insertBefore(sec, w.nextSibling);
    return true;
  }

  /* ---------- Liquid staking: Vouch (vPLS) ---------- */
  // Samo pregled: vPLS je ze vstet v vsoto denarnic (Wallets Screener ga vrednoti po istem
  // tecaju pogodbe), zato se tu NE pristeje nikamor.
  function rpcKlici(klici) {
    var i = 0;
    function poskus() {
      if (i >= RPC.length) return Promise.reject(new Error('RPC'));
      var u = RPC[i++];
      return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(klici) })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          if (!Array.isArray(j)) return Promise.reject();
          var po = {}; j.forEach(function (x) { po[x.id] = x.result; });
          return klici.map(function (k) { return po[k.id]; });
        })
        .catch(poskus);
    }
    return poskus();
  }
  function naloziVouch(wal) {
    vouchEl.textContent = '';
    if (!wal.length) return;
    var klici = [{ jsonrpc: '2.0', id: 0, method: 'eth_call', params: [{ to: VPLS, data: '0x679aefce' }, 'latest'] }];
    wal.forEach(function (a, i) {
      klici.push({ jsonrpc: '2.0', id: i + 1, method: 'eth_call',
        params: [{ to: VPLS, data: '0x70a08231' + '000000000000000000000000' + a.slice(2) }, 'latest'] });
    });
    Promise.all([rpcKlici(klici), cenaPls()]).then(function (r) {
      var res = r[0], cena = r[1];
      var tecaj = res[0] ? Number(BigInt(res[0])) / 1e18 : 0;
      if (!(tecaj > 0.5 && tecaj < 100)) return;
      var vrst = [];
      wal.forEach(function (a, i) {
        var raw = res[i + 1];
        var v = raw && raw !== '0x' ? izWei(BigInt(raw).toString()) : 0;
        if (v > 0) vrst.push({ a: a, v: v, p: v * tecaj });
      });
      if (!vrst.length) return;
      var skV = 0, skP = 0;
      vrst.forEach(function (x) { skV += x.v; skP += x.p; });
      vouchEl.appendChild(el('div', 'gpv-vouch-h', 'Liquid staking \u00b7 Vouch (vPLS)'));
      var ovoj = el('div', 'wbal-scroll gpv-scroll');
      var t = el('table', 'wbal-tbl gpv-tbl');
      var th = el('thead'), tr = el('tr');
      ['Wallet', 'vPLS', '\u2248 PLS', 'Value'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
      th.appendChild(tr); t.appendChild(th);
      var tb = el('tbody');
      vrst.forEach(function (x) {
        var r2 = el('tr');
        var c0 = el('td', 'gpv-kam', oznaka(x.a) || kratko(x.a)); c0.title = x.a; r2.appendChild(c0);
        r2.appendChild(el('td', null, pls(x.v)));
        r2.appendChild(el('td', null, pls(x.p)));
        r2.appendChild(el('td', null, cena ? usd(x.p * cena) : '\u2014'));
        tb.appendChild(r2);
      });
      if (vrst.length > 1) {
        var rs = el('tr', 'gpv-sk');
        rs.appendChild(el('td', null, 'Total'));
        rs.appendChild(el('td', null, pls(skV)));
        rs.appendChild(el('td', null, pls(skP)));
        rs.appendChild(el('td', null, cena ? usd(skP * cena) : '\u2014'));
        tb.appendChild(rs);
      }
      t.appendChild(tb); ovoj.appendChild(t); vouchEl.appendChild(ovoj);
      vouchEl.appendChild(el('div', 'wbal-note',
        '1 vPLS = ' + tecaj.toLocaleString('en-US', { maximumFractionDigits: 4 }) +
        ' PLS (Vouch contract rate). Already included in the wallet totals above \u2014 shown here for overview, not added again. ' +
        'Redeeming through Vouch may take time; on a DEX vPLS can trade below this rate.'));
    }).catch(function () { /* brez prikaza, ce RPC ne odgovori */ });
  }

  /* ---------- kartica Validators zgoraj ---------- */
  function kartica(n) {
    var cur = parseInt(localStorage.getItem(K_VAL) || '0', 10) || 0;
    var auto = parseInt(localStorage.getItem(K_AUTO) || '-1', 10);
    namigEl.textContent = '';
    if (n === cur) { try { localStorage.setItem(K_AUTO, String(n)); } catch (e) {} return; }
    if (cur === 0 || cur === auto) { nastaviKartico(n); return; }
    // uporabnik je stevilo vpisal sam: ne prepisem, ponudim
    namigEl.appendChild(el('span', null, 'The Validators card shows ' + cur + ' (entered by you); ' + n + ' found here. '));
    var b = el('button', 'wbal-btn', 'Use ' + n); b.type = 'button';
    b.addEventListener('click', function () { nastaviKartico(n); namigEl.textContent = ''; });
    namigEl.appendChild(b);
  }
  function nastaviKartico(n) {
    try { localStorage.setItem(K_AUTO, String(n)); } catch (e) {}
    var karte = document.querySelectorAll('.pov-card');
    for (var i = 0; i < karte.length; i++) {
      var l = karte[i].querySelector('.pov-lbl');
      if (!l || l.textContent.trim().toUpperCase() !== 'VALIDATORS') continue;
      var inp = karte[i].querySelector('input.pov-input'), btn = karte[i].querySelector('button');
      if (inp && btn) { inp.value = String(n); btn.click(); return; }
    }
    try { localStorage.setItem(K_VAL, String(n)); } catch (e) {}
  }

  /* ---------- glavno ---------- */
  function nalozi() {
    if (tece) return;
    var wal = denarnice(), roc = rocni();
    zadnjiWal = localStorage.getItem(K_WAL);
    zadnjiIds = localStorage.getItem(K_IDS);
    povEl.textContent = ''; tabEl.textContent = ''; namigEl.textContent = ''; refEl.textContent = ''; vouchEl.textContent = '';
    if (!wal.length && !roc.length) {
      statEl.textContent = 'Add a wallet above (validators paying out to it are found automatically) or enter a validator index or public key.';
      priporocilo(true);
      return;
    }
    tece = true;
    naloziVouch(wal);
    var napake = [], podatki = {}, pokritost = {}, cena = null;
    statEl.textContent = 'Looking for validators\u2026';

    var pVal = {};       // idx -> zapis
    function zapis(idx) {
      return pVal[idx] || (pVal[idx] = { idx: idx, w1: 0, w7: 0, w30: 0, zadnje: 0, vir: null, rocno: false });
    }

    cenaPls().then(function (c) { cena = c; })
      // 1) rocno vpisani: najprej beacon, da izvemo naslov za izplacila
      .then(function () { return roc.length ? beacon(roc) : []; })
      .then(function (vr) {
        var rocniNaslovi = {};
        vr.forEach(function (v) {
          var z = zapis(String(v.index)); z.rocno = true; z.b = v;
          var a = naslovIz(v.validator.withdrawal_credentials);
          if (a && wal.indexOf(a) < 0) (rocniNaslovi[a] = rocniNaslovi[a] || []).push(String(v.index));
        });
        // 2) izplacila: denarnice (vsi validatorji) + naslovi rocnih (samo ti validatorji)
        var naslovi = wal.map(function (a) { return { a: a, samo: null }; })
          .concat(Object.keys(rocniNaslovi).map(function (a) { return { a: a, samo: rocniNaslovi[a] }; }));
        var i = 0;
        return naslovi.reduce(function (p, n) {
          return p.then(function () {
            i++;
            statEl.textContent = 'Reading payouts \u2014 address ' + i + ' of ' + naslovi.length + '\u2026';
            return izplacila(n.a).then(function (r) {
              var zdaj = Date.now();
              r.vse.forEach(function (w) {
                if (n.samo && n.samo.indexOf(w.idx) < 0) return;
                if (!pVal[w.idx] && Object.keys(pVal).length >= MAX_VAL * 3) return;
                var z = zapis(w.idx);
                if (!z.vir) z.vir = n.a;
                if (w.ts > z.zadnje) z.zadnje = w.ts;
                var st = zdaj - w.ts;
                if (st <= DAN) z.w1 += w.pls;
                if (st <= 7 * DAN) z.w7 += w.pls;
                if (st <= 30 * DAN) z.w30 += w.pls;
              });
              pokritost[n.a] = r.popolno ? Infinity : (Date.now() - r.najst);
            }).catch(function (e) { napake.push(kratko(n.a) + ': ' + (e && e.message || e)); });
          });
        }, Promise.resolve());
      })
      // 3) beacon za vse najdene, ki jih se nimamo
      .then(function () {
        var manjka = Object.keys(pVal).filter(function (k) { return !pVal[k].b; });
        statEl.textContent = 'Reading validator status\u2026';
        return manjka.length ? beacon(manjka).then(function (vr) {
          vr.forEach(function (v) { zapis(String(v.index)).b = v; });
        }) : null;
      })
      .then(function () { podatki = pVal; risi(podatki, pokritost, cena, napake); },
            function (e) { napake.push(String(e && e.message || e)); risi(pVal, pokritost, cena, napake); })
      .then(function () { tece = false; }, function () { tece = false; });
  }

  function risi(pVal, pokritost, cena, napake) {
    var vsi = Object.keys(pVal).map(function (k) { return pVal[k]; }).filter(function (z) { return z.b; });
    var umaknjeni = vsi.filter(function (z) { return z.b.status === 'withdrawal_done' && !z.rocno; });
    var prikaz = vsi.filter(function (z) { return umaknjeni.indexOf(z) < 0; });
    prikaz.sort(function (a, b) {
      var sa = steje(a.b.status) ? 0 : 1, sb = steje(b.b.status) ? 0 : 1;
      return sa - sb || Number(a.idx) - Number(b.idx);
    });
    var vec = prikaz.length > MAX_VAL ? prikaz.length - MAX_VAL : 0;
    prikaz = prikaz.slice(0, MAX_VAL);

    // pokritost oken: ce za kak naslov nismo prebrali dovolj dalec nazaj, je vsota spodnja meja
    function polno(okno) {
      return Object.keys(pokritost).every(function (a) { return pokritost[a] >= okno; });
    }
    var p1 = polno(DAN), p7 = polno(7 * DAN), p30 = polno(30 * DAN);

    var akt = 0, cak = 0, drugo = 0, stanje = 0, efektivno = 0, w1 = 0, w7 = 0, w30 = 0;
    vsi.forEach(function (z) {
      var st = z.b.status;
      if (/^active_/.test(st)) { akt++; efektivno += izGwei(z.b.validator.effective_balance); }
      else if (/^pending_/.test(st)) cak++;
      else if (st !== 'withdrawal_done') drugo++;
      stanje += izGwei(z.b.balance);
      w1 += z.w1; w7 += z.w7; w30 += z.w30;
    });

    var st = [];
    if (!vsi.length) st.push('No validators found for these wallets.' + (denarnice().length ? ' Validators are found from payouts in the last 30 days.' : ''));
    else st.push(vsi.length + ' validator' + (vsi.length === 1 ? '' : 's') + ' found');
    if (umaknjeni.length) st.push(umaknjeni.length + ' fully withdrawn (exited) not shown');
    if (vec) st.push('showing the first ' + MAX_VAL + ', ' + vec + ' more not shown');
    if (!p30) st.push('very many payouts \u2014 totals marked \u2265 are lower bounds');
    if (napake.length) st.push('could not read: ' + napake.join('; '));
    if (slabiVnos) st.unshift(slabiVnos);
    statEl.textContent = st.join(' \u00b7 ');

    priporocilo(!prikaz.length);
    if (!vsi.length) { if (!napake.length) kartica(0); return; }

    // povzetek
    function polje(lbl, val, sub) {
      var d = el('div', 'gpv-k');
      d.appendChild(el('div', 'gpv-k-lbl', lbl));
      d.appendChild(el('div', 'gpv-k-val', val));
      if (sub) d.appendChild(el('div', 'gpv-k-sub', sub));
      povEl.appendChild(d);
    }
    function vUsd(n) { return cena ? usd(n * cena) : ''; }
    polje('Active', String(akt), (cak ? cak + ' pending' : '') + (cak && drugo ? ' \u00b7 ' : '') + (drugo ? drugo + ' exiting / exited' : '') || 'validators');
    polje('Balance', pls(stanje) + ' PLS', vUsd(stanje));
    polje('Payouts 24h', (p1 ? '' : '\u2265') + pls(w1) + ' PLS', vUsd(w1));
    polje('Payouts 7 days', (p7 ? '' : '\u2265') + pls(w7) + ' PLS', vUsd(w7));
    polje('Payouts 30 days', (p30 ? '' : '\u2265') + pls(w30) + ' PLS', vUsd(w30));
    if (p7 && efektivno > 0) {
      var apr = (w7 / 7 * 365) / efektivno * 100;
      polje('APR (7 days)', apr.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%', 'estimate from payouts');
    }

    // tabela
    var ovoj = el('div', 'wbal-scroll gpv-scroll');
    var t = el('table', 'wbal-tbl gpv-tbl');
    var th = el('thead'), tr = el('tr');
    ['Validator', 'Status', 'Balance (PLS)', '24h', '7 days', '30 days', 'Last payout', 'Paid to'].forEach(function (h) {
      tr.appendChild(el('th', null, h));
    });
    th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    prikaz.forEach(function (z) {
      var r = el('tr');
      var s = STATUS[z.b.status] || [z.b.status, 'izs'];
      var c0 = el('td', null, '#' + z.idx);
      c0.title = z.b.validator.pubkey;
      if (z.rocno) c0.appendChild(el('span', 'gpv-mini', 'added'));
      r.appendChild(c0);
      var c1 = el('td'); c1.appendChild(el('span', 'gpv-st gpv-st-' + s[1], s[0])); r.appendChild(c1);
      r.appendChild(el('td', null, pls(izGwei(z.b.balance))));
      r.appendChild(el('td', null, z.w1 ? pls(z.w1) : '\u2014'));
      r.appendChild(el('td', null, z.w7 ? pls(z.w7) : '\u2014'));
      r.appendChild(el('td', null, z.w30 ? pls(z.w30) : '\u2014'));
      r.appendChild(el('td', null, kdaj(z.zadnje)));
      var a = naslovIz(z.b.validator.withdrawal_credentials);
      var c7 = el('td', 'gpv-kam', a ? (oznaka(a) || kratko(a)) : 'no address (0x00)');
      if (a) c7.title = a;
      r.appendChild(c7);
      tb.appendChild(r);
    });
    t.appendChild(tb); ovoj.appendChild(t); tabEl.appendChild(ovoj);

    if (!napake.length) kartica(akt + cak);
  }

  /* ---------- zagon ---------- */
  function zacni() {
    zgradi();
    var poskusi = 0;
    (function cakaj() {
      if (vstavi()) {
        // malo pocakam, da Wallets Screener najprej prebere svoje (ista FusionScan)
        setTimeout(nalozi, 3500);
        setInterval(function () {
          var w = localStorage.getItem(K_WAL), ids = localStorage.getItem(K_IDS);
          if ((w !== zadnjiWal || ids !== zadnjiIds) && !tece) { risiRocne(); nalozi(); }
        }, 4000);
        return;
      }
      if (++poskusi < 480) setTimeout(cakaj, 250);   // do 2 min (pocasno nalaganje)
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zacni);
  else zacni();
})();
