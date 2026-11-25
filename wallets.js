/* wallets.js — read-only wallet balance overview.
 *
 * Addition to HEX Stake Analyzer for StakeScreener, written as a separate
 * file so that app.js stays byte-identical to the upstream export and can be
 * replaced on the next update without merging.
 *
 * Data sources (all already allowed by the Content-Security-Policy):
 *   token list + balances   Blockscout  /api/v2/addresses/{a}/token-balances
 *   native PLS / ETH        JSON-RPC    eth_getBalance
 *   prices                  DexScreener /latest/dex/tokens/{a,a,…}
 *
 * Nothing is written anywhere. No wallet is connected, no key is touched;
 * an address is only ever read.
 */
(function () {
  'use strict';

  /* ---------- Ethereum RPC: Tenderly before publicnode ----------
   * On 9 Sep 2026 publicnode stopped serving ARCHIVE queries for free:
   *     eth_getLogs over old blocks -> 403
   *     {"error":{"message":"Archive requests require a personal token"}}
   * app.js does not notice, because its checkEthRpcHealth() checks
   * eth_blockNumber (which still returns 200) and therefore never even
   * looks for the fallback addresses - the Ethereum history scan stalls at ~20 %,
   * every chunk five times in a row, minutes of waiting without explanation.
   *
   * ETH_RPCS is a const ARRAY, but its contents are mutable, so app.js
   * stays byte-for-byte identical to the original (same rule as for go()).
   * Tenderly goes first, publicnode stays behind it as a fallback -
   * if Tenderly ever fails, we are where we were before, not worse.
   * Measured on 9 Sep 2026 from a browser: Tenderly 200, 12,155 logs, 0.6 s.
   */
  (function tenderlyPredPublicnode() {
    var NOV = 'https://gateway.tenderly.co/public/mainnet';
    try {
      if (typeof ETH_RPCS === 'undefined' || !Array.isArray(ETH_RPCS)) {
        console.warn('[wallets] ETH_RPCS is not reachable — Ethereum history will '
          + 'go on to publicnode and will most likely fail with 403.');
        return;
      }
      if (ETH_RPCS.indexOf(NOV) === -1) ETH_RPCS.unshift(NOV);
      console.log('[wallets] Ethereum RPC order:', ETH_RPCS.join(', '));
    } catch (e) {
      console.warn('[wallets] could not reorder ETH_RPCS:', e && e.message);
    }
  })();

  var BS = {
    pls: 'https://api.scan.pulsechain.com/api/v2',
    eth: 'https://eth.blockscout.com/api/v2'
  };
  var DS = 'https://api.dexscreener.com/latest/dex/tokens/';
  var DS_CHAIN = { pls: 'pulsechain', eth: 'ethereum' };
  // Wrapped natives — used to price the chain's own coin.
  var WRAPPED = {
    pls: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
    eth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  };
  var FALLBACK_RPC = {
    pls: ['https://rpc.pulsechain.com', 'https://pulsechain-rpc.publicnode.com'],
    eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  };

  // Every token that DexScreener prices at all is valued. Pool depth is shown
  // as its own column instead of being used as a filter, so a price coming
  // from a shallow pool is visible rather than hidden — judge it yourself.
  var MIN_LIQ_USD = 0;
  var DUST_USD = 0;      // show everything; only unpriced tokens are collapsed
  var MAX_TOKENS_PRICED = 250;   // 25 per request, so this is 10 requests per chain

  var busy = false;
  var vsotaDenarnic = null;   // last calculated wallet total (USD)
  var denarniceNepopolne = 0; // how many wallets returned an incomplete token list
                              // (the total is then a LOWER bound, not the final number)
  var cenaPls = null;         // PLS price from the ecosystem strip

  // Validators: the count is entered by the user; 32 M PLS per validator is a constant
  // of PulseChain. This cannot be read from the chain - validators run at a
  // provider and are not tied to a wallet address. The watchdog does the same
  // (VALIDATOR_COUNT in .env), so both sides are consistent.
  var VAL_KEY = 'gopulse_validators';
  var PLS_NA_VALIDATOR = 32000000;
  function validatorjev() {
    var n = parseInt(localStorage.getItem(VAL_KEY) || '0', 10);
    return isFinite(n) && n > 0 ? Math.min(n, 9999) : 0;
  }
  function setValidatorjev(n) {
    try { localStorage.setItem(VAL_KEY, String(Math.max(0, n | 0))); } catch (e) {}
  }

  /* ---------- cards mirrored from the analyzer ---------- */
  // Stake Value and Wallet Balance are DELIBERATELY not calculated here but
  // mirrored from the analyzer's cards. I take prices from a different source than
  // it does, so my own calculation would give a different number for the same thing on the same
  // screen - and nobody would know which one is right.
  // If the analysis has not run yet, the cards honestly show "-", not 0.
  // In some cards the analyzer already has a split by chain
  // (.wb-breakdown). Where it exists, I MIRROR it - I do not recalculate it, because
  // otherwise two numbers for the same thing would appear on the same screen.
  function bes(n) { return n && n.textContent ? n.textContent.trim() : ''; }
  function vrsticeIz(kartica) {
    return [].slice.call(kartica.querySelectorAll('.wb-breakdown .wb-row'))
      .map(function (r) {
        var tag = r.querySelector('.wb-tag');
        var chip = tag ? tag.querySelector('.wb-chain-tag') : null;
        // textContent glues the chain badge onto the name ("\u25c7 eHEXPLS"), so I remove it
        // and print it separately.
        var ime = bes(tag);
        if (chip) ime = ime.replace(bes(chip), '').trim();
        return {
          ime: ime,
          chip: bes(chip),
          barva: tag ? (tag.style.color || '') : '',
          kol: bes(r.querySelector('.wb-amt')),
          usd: bes(r.querySelector('.wb-usd'))
        };
      });
  }

  function dodajVrstice(kartica, vrstice) {
    if (!vrstice || !vrstice.length) return;
    var b = el('div', 'pov-brk');
    vrstice.forEach(function (v) {
      var r = el('div', 'pov-row');
      var t = el('span', 'pov-tag', v.ime);
      if (v.barva) t.style.color = v.barva;
      if (v.chip) t.appendChild(el('span', 'pov-chip', v.chip));
      r.appendChild(t);
      r.appendChild(el('span', 'pov-amt', v.kol));
      if (v.usd) r.appendChild(el('span', 'pov-usd', v.usd));
      b.appendChild(r);
    });
    kartica.appendChild(b);
  }

  // The analyzer does NOT draw the Stake Value split. I calculate it with ITS
  // functions and ITS prices (lastStakes, sst, yhDisplay, priceFor),
  // not with my own price source - the same expression as aNow in app.js:
  //     \u03a3 (stakedHearts + yhDisplay(s)) / 1e8 * priceFor(chain)
  // If the sum of my two numbers does not match its total, the split is NOT
  // shown. Better nothing than two numbers that do not add up to the third.
  function stakeiPoVerigi(skupajUsd) {
    try {
      if (typeof lastStakes === 'undefined' || !lastStakes || !lastStakes.length) return null;
      if (typeof sst !== 'function' || typeof yhDisplay !== 'function' ||
          typeof priceFor !== 'function') return null;
      var vs = { pls: { usd: 0, hearts: 0n }, eth: { usd: 0, hearts: 0n } };
      for (var i = 0; i < lastStakes.length; i++) {
        var s = lastStakes[i];
        var st = sst(s);
        if (st !== 'active' && st !== 'overdue') continue;
        var ch = s.chain || 'pls';
        if (!vs[ch]) continue;
        var lp = priceFor(ch);
        vs[ch].hearts += s.stakedHearts;
        if (lp > 0) vs[ch].usd += Number(s.stakedHearts + yhDisplay(s)) / 1e8 * lp;
      }
      var vsota = vs.pls.usd + vs.eth.usd;
      if (!(vsota > 0)) return null;
      // check against the displayed total (that one is rounded, hence 1 %)
      if (skupajUsd != null && Math.abs(vsota - skupajUsd) / skupajUsd > 0.01) return null;
      // No " HEX" suffix: the cards are narrow and "466.51K HEX" wrapped onto two
      // lines. The unit is already in the line above the split ("874.28K HEX · total
      // staked"), and Wallet Balance does not print it either.
      var hex = function (h) {
        return typeof fh === 'function' ? fh(h)
          : (Number(h) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 2 });
      };
      var out = [];
      if (vs.pls.hearts > 0n) out.push({ ime: '\u2b21 pHEX', chip: '', barva: '#FF00CC',
        kol: hex(vs.pls.hearts), usd: usd(vs.pls.usd) });
      if (vs.eth.hearts > 0n) out.push({ ime: '\u25c6 eHEX', chip: '', barva: '#00CFFF',
        kol: hex(vs.eth.hearts), usd: usd(vs.eth.usd) });
      return out.length ? out : null;
    } catch (e) { return null; }
  }

  function zrcaliKartico(naslov) {
    var kart = [].slice.call(document.querySelectorAll('#dash .card, #cards .card'));
    for (var i = 0; i < kart.length; i++) {
      var l = kart[i].querySelector('.clbl');
      if (!l || l.textContent.trim().toLowerCase() !== naslov.toLowerCase()) continue;
      var v = kart[i].querySelector('.cval');
      // Wallet Balance has no .csub but .ts-sub (that is where the $ value is).
      // Without this fallback the card showed HEX without dollars for months.
      var sub = kart[i].querySelector('.csub') || kart[i].querySelector('.ts-sub');
      var dru = kart[i].querySelector('.card-2nd');
      return {
        val: v ? v.textContent.trim() : null,
        sub: sub ? sub.textContent.trim() : '',
        vrstice: vrsticeIz(kart[i]),
        // textContent glues the children together without a space ("0 HEXtotal staked"),
        // so we collect them one by one and separate them with a dot.
        dru: dru ? [].slice.call(dru.children)
              .map(function (x) { return x.textContent.trim(); })
              .filter(Boolean).join(' · ') || dru.textContent.trim() : ''
      };
    }
    return null;
  }

  // "$10.30K" -> 10300 · "$1.2M" -> 1200000 · "$760.67" -> 760.67
  // The analyzer shortens the value, so for the sum it has to go back to a number.
  function razberi(t) {
    if (!t) return null;
    var m = /\$?\s*([\d.,]+)\s*([KMB])?/i.exec(t.replace(/\s/g, ''));
    if (!m) return null;
    var n = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(n)) return null;
    var f = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
    return n * f;
  }

  function renderPovzetek(box) {
    box.textContent = '';
    // 22 Nov 2026 (owner): with no wallet added, a visitor does not know what to do -
    // "available after you run Analyze" did not point them anywhere.
    var brezDenarnic = !myList().length;
    [['Stake Value', 'staked value'], ['Wallet Balance', 'liquid balance']].forEach(function (par) {
      var d = zrcaliKartico(par[0]);
      var c = el('div', 'pov-card' + (d ? '' : ' prazna'));
      c.appendChild(el('div', 'pov-lbl', par[0]));
      c.appendChild(el('div', 'pov-val', d && d.val ? d.val : '—'));
      c.appendChild(el('div', 'pov-sub', d ? (d.sub || par[1]) :
        (brezDenarnic ? 'add a wallet below' : 'available after you run Analyze')));
      if (d && d.dru) c.appendChild(el('div', 'pov-dru', d.dru));
      // pHEX / eHEX split: mirrored for Wallet Balance, for Stake
      // Value calculated with the analyzer's functions (see stakeiPoVerigi).
      if (d) dodajVrstice(c, par[0] === 'Stake Value'
        ? stakeiPoVerigi(razberi(d.val))
        : d.vrstice);
      box.appendChild(c);
    });
    // Validators - a separate card, because this is LOCKED capital
    var vN = validatorjev();
    var vPls = vN * PLS_NA_VALIDATOR;
    var vUsd = (vN && cenaPls) ? vPls * cenaPls : null;
    var vc = el('div', 'pov-card' + (vN ? '' : ' prazna'));
    vc.appendChild(el('div', 'pov-lbl', 'VALIDATORS'));
    vc.appendChild(el('div', 'pov-val', vUsd != null ? usd(vUsd) : (vN ? '—' : '0')));
    vc.appendChild(el('div', 'pov-sub', vN
      ? vN + ' × 32M PLS = ' + (vPls / 1e6).toLocaleString('sl-SI') + 'M PLS · locked'
      : 'found automatically from your wallets, or enter a count'));
    var vrow = el('div', 'pov-dru');
    var vinp = document.createElement('input');
    vinp.type = 'number'; vinp.min = '0'; vinp.max = '9999';
    vinp.className = 'wbal-input pov-input';
    vinp.value = vN || '';
    vinp.placeholder = '0';
    var vbtn = el('button', 'wbal-btn', 'Save');
    vbtn.type = 'button';
    var shrani = function () {
      setValidatorjev(parseInt(vinp.value || '0', 10));
      renderPovzetek(box);
    };
    vbtn.addEventListener('click', shrani);
    vinp.addEventListener('keydown', function (e) { if (e.key === 'Enter') shrani(); });
    vrow.appendChild(vinp); vrow.appendChild(vbtn);
    vc.appendChild(vrow);
    box.appendChild(vc);

    // Total = wallets + stakes. The two items are SEPARATE (in the wallet vs.
    // locked in stakes), so the sum does not double count. But the price sources are
    // different - mine is DexScreener, the analyzer has its own - so this is an approximation and
    // says so.
    var st = razberi((zrcaliKartico('Stake Value') || {}).val);
    var celo = (st != null && vsotaDenarnic != null);
    var vsota = celo ? st + vsotaDenarnic + (vUsd || 0) : null;
    var skupaj = el('div', 'pov-card pov-skupaj' + (celo ? '' : ' prazna'));
    skupaj.appendChild(el('div', 'pov-lbl', 'TOTAL'));
    if (brezDenarnic && !celo) {
      var zac = el('div', 'pov-zacni');
      zac.appendChild(el('div', 'pov-zacni-h', 'Add a wallet address to get started'));
      zac.appendChild(el('div', 'pov-zacni-p',
        'Paste any PulseChain or Ethereum address \u2014 read-only, no wallet connection.'));
      var gumb = el('button', 'pov-zacni-btn', 'Add wallet \u2193');
      gumb.type = 'button';
      gumb.addEventListener('click', function () {
        var inp = document.querySelector('#wbal-sec .wbal-add .wbal-input');
        if (!inp) return;
        inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }, 450);
      });
      zac.appendChild(gumb);
      skupaj.appendChild(zac);
      box.appendChild(skupaj);
      box.appendChild(el('div', 'pov-vir', 'mirrored from HEX Stake Analyzer below'));
      return;
    }
    // If any wallet returned an incomplete token list, this is a LOWER bound.
    // Without a sign, a total that is too low would look final.
    skupaj.appendChild(el('div', 'pov-val',
      celo ? (denarniceNepopolne ? '\u2265' : '') + usd(vsota) : '—'));
    skupaj.appendChild(el('div', 'pov-sub', celo
      ? 'wallets ' + usd(vsotaDenarnic) + ' + stakes ' + usd(st) +
        (vUsd ? ' + validators ' + usd(vUsd) : '')
      : 'available after you run Analyze'));
    if (celo)
      skupaj.appendChild(el('div', 'pov-dru',
        'approximate — the two price sources are not the same' + (vUsd ? (localStorage.getItem('gopulse_val_auto') === String(vN) ? ', validator count found by Validator Screener (32M PLS each)' : ', validator count entered by hand') : '') +
        (denarniceNepopolne ? ' · at least: ' + denarniceNepopolne + ' wallet(s) had an incomplete token list' : '')));
    box.appendChild(skupaj);

    box.appendChild(el('div', 'pov-vir', 'mirrored from HEX Stake Analyzer below'));
  }

  /* ---------- network status (volume / gas / block) ---------- */
  // Three facts about the CHAIN, not about a wallet - hence its own strip above WALLETS.
  //
  // STANDING RULE 3 (PULSECHAIN-NATIVE.md): whatever can be read from the chain is
  // read from the chain. Gas and block are native (eth_gasPrice, eth_blockNumber).
  // The 24-hour volume of the whole chain does NOT exist on chain - it could only be
  // obtained by counting all Swap events on all DEXes, which is not feasible in a
  // browser. So it is the only part that comes from an intermediary, and the card
  // SAYS so - the source is printed on it, not hidden.
  var GAS_RPC = ['https://rpc.pulsechain.com', 'https://pulsechain-rpc.publicnode.com', 'https://rpc.libertyswap.finance'];  // g4mm4 ugasnil 21. 11. 2026
  /* ---- 24-hour volume of the whole chain: two sources, each for its own part ------------
     Goal (owner, 23 Aug 2026): "roughly as accurate as DexScreener's and changing
     the same way as on DexScreener; it does not need to be accurate to the $".

     PulseX is roughly 80 % of volume and has its OWN indexers without limits -
     from there we take a complete, rolling 24-hour figure. The other DEXes have no
     such indexers, so DexScreener is used for them.

       part A   PulseX v1 + v2 + StableSwap   graph.pulsechain.com  (complete)
       part B   ALL OTHER DEXes               DexScreener /token-pairs

     DOUBLE COUNTING IS PREVENTED STRUCTURALLY, not by hope: from part B
     all pairs with dexId === 'pulsex' are left out. PulseX comes only from
     the subgraphs, the others only from DexScreener. Nothing can be counted twice.

     Measured on 23 Aug 2026 at 20:30 UTC:
       PulseX (subgraph)    $4.47M
       others (DexScreener) $1.00M   9mm 478K, switchx 247K, liberty 185K,
                                     uniswap 74K, 9inch 13K, the rest small change
       total                $5.47M   vs ~$5.7M on dexscreener.com  = ~96 %

     Part B is still capped at 30 pairs per token, but those DEXes are small and
     their pairs hang on WPLS and stablecoins, which are in the list.
     So the loss there is much smaller than it would be for PulseX.                */
  var PULSEX_SUBGRAPHS = [
    ['PulseX v1',  'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex'],
    ['PulseX v2',  'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2'],
    ['StableSwap', 'https://graph.pulsechain.com/subgraphs/name/pulsechain/stableswap']
  ];
  var STRANI = 2;
  var NA_STRAN = 1000;
  var DS_PAIRS = 'https://api.dexscreener.com/token-pairs/v1/pulsechain/';
  // Most pairs on the smaller DEXes go through these.
  var PROMET_TOKENI = [
    '0xA1077a294dDE1B09bB078844df40758a5D0f9a27', // WPLS
    '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39', // pHEX
    '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab', // PLSX
    '0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d', // INC
    '0xefD766cCb38EaF1dfd701853BFCe31359239F305', // DAI
    '0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07', // USDC
    '0x0Cb6F5a34ad42ec934882A05265A7d5F59b51A2f', // USDT
    '0xF6f8Db0aBa00007681F8fAF16A0FDa1c9B030b11', // PRVX
    '0x57fde0a71132198BBeC939B98976993d8D89D225', // eHEX
    '0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C'  // WETH
  ];

  var GAS_SEND = 21000;
  var GAS_MENJAVA = 150000;
  var UTRIP_MS = 10000;      // how often gas and block are refreshed
  var PROMET_VSAKIH = 30;    // volume only every 30th tick (~5 min) - see below

  function rpcKlic(url, metoda) {
    return timeoutFetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metoda, params: [] })
    }, 8000)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) { if (!j || !j.result) throw new Error('no result'); return BigInt(j.result); });
  }

  // Same rule as in GAS-FEE.md and oracle-commit.js: ask TWO RPCs and
  // take the LOWER. On 9 Aug 2026 one RPC reported 117,549,435 Gwei while the other
  // two reported 1 - and the oracle believed it and paid ~29,000 PLS per commit.
  // Nothing is paid here, but the same lie would mean a wrong number on screen.
  function gasInBlok() {
    var gasi = GAS_RPC.map(function (u) { return rpcKlic(u, 'eth_gasPrice').catch(function () { return null; }); });
    var blok = GAS_RPC.reduce(function (p, u) {
      return p.then(function (v) { return v != null ? v : rpcKlic(u, 'eth_blockNumber').catch(function () { return null; }); });
    }, Promise.resolve(null));
    return Promise.all([Promise.all(gasi), blok]).then(function (r) {
      var veljavni = r[0].filter(function (x) { return x != null && x > 0n; });
      return {
        gas: veljavni.length ? veljavni.reduce(function (a, b) { return a < b ? a : b; }) : null,
        gasVirov: veljavni.length,
        blok: r[1]
      };
    });
  }

  function prometPodatki() {
    var od = Math.floor(Date.now() / 1000) - 86400;

    // -- part A: PulseX from its own indexers ----------------------------------
    function stran(url, skip) {
      var q = '{pairHourDatas(first:' + NA_STRAN + ', skip:' + skip +
              ', orderBy:hourlyVolumeUSD, orderDirection:desc' +
              ', where:{hourStartUnix_gte:' + od + '}){hourlyVolumeUSD}}';
      return timeoutFetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      }, 20000)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          // GraphQL reports an error with HTTP 200 and {"errors":[...]} without `data`.
          // If we counted that as an empty result, the error would look like
          // "this exchange had no volume today" - on 23 Aug 2026 the whole StableSwap
          // ($326K) silently disappeared this way and there was no warning.
          if (!j || j.errors || !j.data || !Array.isArray(j.data.pairHourDatas)) {
            throw new Error('subgraph returned no data');
          }
          var a = j.data.pairHourDatas, s = 0;
          for (var i = 0; i < a.length; i++) s += Number(a[i].hourlyVolumeUSD) || 0;
          return s;
        })
        .catch(function () { return null; });
    }
    var naloge = [];
    PULSEX_SUBGRAPHS.forEach(function (sg) {
      for (var s = 0; s < STRANI; s++) naloge.push(stran(sg[1], s * NA_STRAN));
    });
    var delA = Promise.all(naloge).then(function (r) {
      var v = 0, ok = 0;
      r.forEach(function (x) { if (x != null) { v += x; ok++; } });
      return { vol: v, ok: ok, vseh: r.length };
    });

    // -- part B: all OTHER DEXes from DexScreener ------------------------------
    var pari = {};
    var okB = 0;
    var delB = Promise.all(PROMET_TOKENI.map(function (a) {
      return timeoutFetch(DS_PAIRS + a, null, 10000)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (arr) {
          if (!Array.isArray(arr)) throw new Error('unexpected format');
          okB++;
          arr.forEach(function (p) {
            if (!p || p.chainId !== 'pulsechain' || !p.pairAddress) return;
            // PulseX comes from the subgraphs - we SKIP it here, otherwise it would count twice.
            if (p.dexId === 'pulsex') return;
            if (pari[p.pairAddress]) return;
            pari[p.pairAddress] = Number((p.volume || {}).h24) || 0;
          });
        })
        .catch(function () {});
    })).then(function () {
      var kljuci = Object.keys(pari), v = 0;
      kljuci.forEach(function (k) { v += pari[k]; });
      return { vol: v, ok: okB, vseh: PROMET_TOKENI.length, parov: kljuci.length };
    });

    return Promise.all([delA, delB]).then(function (r) {
      var a = r[0], b = r[1];
      if (!a.ok && !b.ok) return null;             // complete outage, not "volume is 0"
      return {
        vol: a.vol + b.vol,
        pulsex: a.vol,
        ostali: b.vol,
        parovB: b.parov,
        manjka: (a.vseh - a.ok) + (b.vseh - b.ok)  // how many queries failed
      };
    });
  }

  function fmtVelika(n) {
    if (!isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }

  function plsInUsd(gwei, enot) {
    var pls = gwei * 1e9 / 1e18 * enot;
    var s = '≈ ' + pls.toFixed(pls < 10 ? 1 : 0) + ' PLS';
    if (cenaPls) {
      var u = pls * cenaPls;
      s += ' ($' + (u < 0.0001 ? u.toFixed(6) : u.toFixed(4)) + ')';
    }
    return s;
  }

  /* ---- the strip is built ONCE, after that only the values are updated ----------
     Redrawing the whole strip every 10 s would mean that every 10 s it disappears
     and comes back - every tick would be visible as a jump. So the nodes are
     kept and only the text inside them changes.

     On failure the old value is KEPT and the card dims, instead of
     showing "-". The difference between "the chain reports 0" and "I could not
     ask it right now" matters - the first would be news, the second is not.                */
  var netUI = null;      // strip contents. Do NOT confuse with the local `net` element
                       // in header(): that one is the box, this is what is inside it.
  var netTimer = null; // tick timer
  var netTick = 0;
  var netZadnji = null; // time of the last successful read

  // Otherwise the value changes silently and "refreshing" cannot be told from "stuck".
  // The class is added only on an ACTUAL change - a tick every 10 s with the same
  // number would be fake liveliness.
  function nastavi(node, txt) {
    if (node.textContent === txt) return;
    node.textContent = txt;
    node.classList.remove('utrip');
    void node.offsetWidth;          // force the animation to restart
    node.classList.add('utrip');
  }

  function netKartica(box, oznaka) {
    var c = el('div', 'net-card');
    c.appendChild(el('div', 'net-lbl', oznaka));
    var v = el('div', 'net-val', '—');
    var s1 = el('div', 'net-spr', '');
    var s2 = el('div', 'net-spr net-spr2', '');
    var vir = el('div', 'net-vir', '');
    c.appendChild(v); c.appendChild(s1); c.appendChild(s2); c.appendChild(vir);
    box.appendChild(c);
    return { c: c, v: v, s1: s1, s2: s2, vir: vir };
  }

  function zgradiOmrezje(box) {
    box.textContent = '';
    netUI = {
      promet: netKartica(box, 'PULSECHAIN 24H VOLUME'),
      gas: netKartica(box, 'PULSECHAIN GAS'),
      blok: netKartica(box, 'PULSECHAIN BLOCK')
    };
    netUI.promet.c.classList.add('prazna');
    netUI.gas.c.classList.add('prazna');
    netUI.blok.c.classList.add('prazna');
    netUI.gas.vir.textContent = 'reading…';
    netUI.blok.s1.textContent = 'chain ID 369';
    return netUI;
  }

  function osveziGasBlok() {
    if (!netUI) return Promise.resolve();
    return gasInBlok().then(function (d) {
      var g = netUI.gas, b = netUI.blok;
      if (d.gas) {
        var gwei = Number(d.gas) / 1e9;
        nastavi(g.v, Math.round(gwei).toLocaleString('en-US') + ' Gwei');
        // Send is what people actually do most often, so it goes first.
        g.s1.textContent = plsInUsd(gwei, GAS_SEND) + ' · send PLS';
        g.s2.textContent = plsInUsd(gwei, GAS_MENJAVA) + ' · swap';
        // WHY THIS NUMBER IS LOWER THAN THE ONE IN A WALLET - measured 24 Aug 2026:
        //     baseFeePerGas   804.674 Gwei  (same on both RPCs = the chain's value)
        //     eth_gasPrice    805.159 / 835.478 Gwei  (base + suggested tip)
        //     our number      21,000 x 805.159 = 16.91 PLS
        //     ZKX shows       20.59 PLS  = base x ~1.22
        //     OKX shows       22.46 PLS  = base x ~1.33
        // Wallets do not show the cost but an UPPER LIMIT (maxFeePerGas x limit),
        // because the base fee may rise up to 12.5 % per block and the tx must still go
        // through. What you actually pay is (base + tip) x gas used - so roughly
        // our 17 PLS. Neither number is wrong; they answer a different
        // question. The source now says so, so this is not researched again in half a year.
        g.vir.textContent = 'base fee + tip · what you pay, not the wallet ceiling';
        g.c.classList.remove('prazna', 'zastarelo');
        netZadnji = Date.now();
      } else {
        g.c.classList.add('zastarelo');
        g.vir.textContent = zastarelaOpomba('no RPC answered');
      }
      if (d.blok != null) {
        nastavi(b.v, Number(d.blok).toLocaleString('en-US'));
        b.vir.textContent = 'from chain · live';
        b.c.classList.remove('prazna', 'zastarelo');
      } else {
        b.c.classList.add('zastarelo');
        b.vir.textContent = zastarelaOpomba('no RPC answered');
      }
    }).catch(function () {});
  }

  function zastarelaOpomba(razlog) {
    if (!netZadnji) return razlog;
    var s = Math.round((Date.now() - netZadnji) / 1000);
    return razlog + ' · last good read ' + (s < 90 ? s + ' s ago' : Math.round(s / 60) + ' min ago');
  }

  function osveziPromet() {
    if (!netUI) return Promise.resolve();
    return prometPodatki().then(function (p) {
      var c = netUI.promet;
      if (!p || !isFinite(p.vol)) {
        c.c.classList.add('zastarelo');
        c.vir.textContent = 'source unreachable right now';
        return;
      }
      nastavi(c.v, fmtVelika(p.vol));
      c.s1.textContent = 'rolling 24h';
      c.s1.className = 'net-spr';
      c.s2.textContent = 'PulseX ' + fmtVelika(p.pulsex) +
                         '  ·  other DEXes ' + fmtVelika(p.ostali);
      c.s2.className = 'net-spr net-spr2' + (p.manjka ? ' dol' : '');
      c.vir.textContent = p.manjka
        ? 'INCOMPLETE — ' + p.manjka + ' queries failed, figure is too low'
        : 'PulseX subgraph + DexScreener · approximate';
      c.c.classList.remove('prazna', 'zastarelo');
    }).catch(function () {});
  }

  function ustaviOmrezje() {
    if (netTimer) { clearInterval(netTimer); netTimer = null; }
  }

  /* The tick STOPS when the tab is not visible. Without that, an open background tab
     would send ~26,000 requests to third-party RPC nodes by the end of the day - for data
     nobody is looking at. On return it refreshes at once, so the number is not stale. */
  function zazeniOmrezje() {
    ustaviOmrezje();
    if (document.hidden) return;
    netTimer = setInterval(function () {
      netTick++;
      osveziGasBlok();
      if (netTick % PROMET_VSAKIH === 0) osveziPromet();
    }, UTRIP_MS);
  }

  var netVidnostVezana = false;
  function renderOmrezje(box) {
    zgradiOmrezje(box);
    osveziGasBlok();
    osveziPromet();
    zazeniOmrezje();
    if (!netVidnostVezana) {
      netVidnostVezana = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { ustaviOmrezje(); }
        else { osveziGasBlok(); zazeniOmrezje(); }
      });
    }
  }

  /* ---------- ecosystem strip ---------- */
  // Addresses verified on 22 Aug 2026 via DexScreener /tokens/v1 - not guessed.
  // The icons are LOCAL: the CSP allows img-src 'self' data:, external images would be
  // blocked. Downloaded from DexScreener on 22 Aug 2026 and scaled down to 96 px.
  var EKO = [
    { sym: 'pHEX', ime: 'PulseChain HEX', chain: 'pls', ikona: 'phex', addr: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39' },
    { sym: 'eHEX', ime: 'Ethereum HEX',   chain: 'eth', ikona: 'ehex', cg: 'hex', addr: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39' },
    { sym: 'PLS',  ime: 'PulseChain',     chain: 'pls', ikona: 'pls',  addr: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27' },
    { sym: 'PLSX', ime: 'PulseX',         chain: 'pls', ikona: 'plsx', addr: '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab' },
    { sym: 'INC',  ime: 'Incentive',      chain: 'pls', ikona: 'inc',  addr: '0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d' },
    { sym: 'PRVX', ime: 'ProveX',         chain: 'pls', ikona: 'prvx', addr: '0xF6f8Db0aBa00007681F8fAF16A0FDa1c9B030b11' },
    // BTC and ETH via the wrapped versions on Ethereum - so both stay
    // on-chain data and follow the same rule (deepest pool) as everything else.
    // The names are honest: these are WBTC and WETH, not the coins themselves.
    { sym: 'BTC',  ime: 'Wrapped Bitcoin', chain: 'eth', ikona: 'btc',  pripona: 'svg', cg: 'bitcoin',
      addr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
    { sym: 'ETH',  ime: 'Wrapped Ether',   chain: 'eth', ikona: 'eth', cg: 'ethereum',
      addr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }
  ];

  /* ---- FALLBACK FOR THE ETHEREUM SIDE: CoinGecko ---------------------------
     On the afternoon of 24 Aug 2026 the picture reversed: DexScreener's routes for
     `pulsechain` recovered and the routes for `ethereum` failed. eHEX,
     BTC and ETH showed "no data", while the PulseChain side worked
     via the PulseX subgraph. A fallback existed for only one side.

     PulseX does not index Ethereum, so another source is needed there.

     WHY ONLY HERE AND NOT EVERYWHERE: on 17 Aug 2026 CoinGecko priced PLS **40 %
     too low** and with the day's sign reversed, because it read from an exchange with $2,713
     of daily volume (PULSECHAIN-NATIVE.md). So it is useless for PulseChain
     tokens. For HEX, BTC and ETH on Ethereum, however, these are deep, well
     covered markets - checked the same day: CoinGecko $0.001538 vs
     DexScreener's $0.001532 for HEX, a 0.4 % difference.
     So: CoinGecko ONLY for entries with a `cg` tag, and those are Ethereum only.

     TRIED AND REJECTED: Blockscout returns `exchange_rate` in the same call
     we already make, so for free. But for eHEX it reported $0.0004338 instead of
     $0.001538 - 3.5 times too low. A price that is free and wrong is worse
     than no price, because it cannot be told apart from the right one.

     One single query for all missing ones at once (ids=...).                   */
  /* CoinGecko's free plan rejects the SIXTH fast call already - measured
     24 Aug 2026: 5x HTTP 200, then 429, 429, 429. Exactly during a DexScreener outage
     the page gets refreshed several times, so the fallback fails exactly when you need it.
     That makes no sense: a fallback source that falls over under the load of an outage is not a fallback.

     So the answer is SAVED. It is fresh for 5 minutes; if CoinGecko refuses, the
     saved one is used, regardless of age. A BTC or ETH price from a few minutes ago is
     far better than "no data" - for these two nothing happens in five minutes
     that would change the meaning of the number.                                   */
  var CG_KEY = 'gopulse_cg_cache';
  var CG_SVEZ_MS = 5 * 60 * 1000;

  function cgShranjeno() {
    try {
      var o = JSON.parse(localStorage.getItem(CG_KEY) || 'null');
      return (o && o.ts && o.data) ? o : null;
    } catch (e) { return null; }
  }
  function cgShrani(data) {
    try { localStorage.setItem(CG_KEY, JSON.stringify({ ts: Date.now(), data: data })); }
    catch (e) {}
  }

  function coingeckoCene(idji) {
    if (!idji.length) return Promise.resolve({});
    var c = cgShranjeno();
    if (c && Date.now() - c.ts < CG_SVEZ_MS) return Promise.resolve(c.data);
    return timeoutFetch('https://api.coingecko.com/api/v3/simple/price?ids=' +
      idji.join(',') + '&vs_currencies=usd&include_24hr_change=true', null, 10000)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) {
        if (!j || typeof j !== 'object' || j.status) throw new Error('no data');
        cgShrani(j);
        return j;
      })
      .catch(function () { return c ? c.data : {}; });
  }

  function ekoFetch(chain, addrs) {
    return ekoDexScreener(chain, addrs).then(function (m) {
      if (chain !== 'pls') return m;
      var manjka = addrs.filter(function (a) { return !m[a.toLowerCase()]; });
      if (!manjka.length) return m;
      // 24 Aug 2026: without this the strip showed "no data" for pHEX, PLS, PLSX, INC
      // and PRVX, while BTC, ETH and eHEX (all from Ethereum) worked.
      return subgraphCene(manjka).then(function (sg) {
        // the source is passed on, so the card can say where the price comes from
        for (var k in sg) if (!m[k]) m[k] = { px: sg[k].px, liq: sg[k].liq, h24: NaN, vir: 'pulsex' };
        return m;
      });
    });
  }

  function ekoDexScreener(chain, addrs) {
    return timeoutFetch(DS_V1 + DS_CHAIN[chain] + '/' + addrs.join(','), null, 10000)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (arr) {
        var out = {};
        (Array.isArray(arr) ? arr : []).forEach(function (p) {
          if (p.chainId !== DS_CHAIN[chain]) return;
          var a = ((p.baseToken || {}).address || '').toLowerCase();
          var liq = (p.liquidity || {}).usd || 0;
          var px = parseFloat(p.priceUsd);
          if (!a || !isFinite(px)) return;
          // deepest pool - a shallow pair is not a price but a coincidence
          if (!out[a] || liq > out[a].liq)
            out[a] = { px: px, liq: liq, h24: parseFloat((p.priceChange || {}).h24) };
        });
        return out;
      })
      .catch(function () { return {}; });
  }

  // Like HEXO: enough decimals that tiny prices are really visible.
  function cena(n) {
    if (!isFinite(n)) return '—';
    // en-US on purpose: elsewhere on the card the dot is the DECIMAL separator
    // ($0.00396200), so a Slovenian thousands dot ($77.163)
    // would mean something other than it looks like. A comma is unambiguous.
    if (n >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
    if (n >= 1) return '$' + n.toFixed(4);
    if (n >= 0.01) return '$' + n.toFixed(6);
    return '$' + n.toFixed(8);
  }

  function renderEko(box) {
    var pls = EKO.filter(function (t) { return t.chain === 'pls'; }).map(function (t) { return t.addr; });
    var eth = EKO.filter(function (t) { return t.chain === 'eth'; }).map(function (t) { return t.addr; });
    return Promise.all([ekoFetch('pls', pls), ekoFetch('eth', eth)]).then(function (r) {
      var m = { pls: r[0], eth: r[1] };
      // whatever is left without a price AND has a CoinGecko tag -> last fallback
      var manjka = EKO.filter(function (x) {
        return x.cg && !m[x.chain][x.addr.toLowerCase()];
      });
      if (!manjka.length) return nadaljuj(m);
      return coingeckoCene(manjka.map(function (x) { return x.cg; })).then(function (cg) {
        manjka.forEach(function (x) {
          var d = cg[x.cg];
          if (!d || !isFinite(d.usd)) return;
          m[x.chain][x.addr.toLowerCase()] =
            { px: d.usd, liq: 0, h24: Number(d.usd_24h_change), vir: 'coingecko' };
        });
        return nadaljuj(m);
      });
    });

    function nadaljuj(m) {
      var wp = m.pls['0xa1077a294dde1b09bb078844df40758a5d0f9a27'];
      if (wp) cenaPls = wp.px;
      box.textContent = '';
      EKO.forEach(function (t) {
        var d = m[t.chain][t.addr.toLowerCase()];
        var c = el('div', 'eko-card');
        var hdr = el('div', 'eko-hdr');
        var ik = document.createElement('img');
        ik.className = 'eko-ikona';
        ik.src = './img/tokens/' + t.ikona + '.' + (t.pripona || 'png');
        ik.alt = '';
        ik.width = 34; ik.height = 34; ik.loading = 'lazy';
        hdr.appendChild(ik);
        var txt = el('span', 'eko-txt');
        txt.appendChild(el('span', 'eko-sym', t.sym));
        txt.appendChild(el('span', 'eko-ime', t.ime));
        hdr.appendChild(txt);
        c.appendChild(hdr);
        c.appendChild(el('div', 'eko-cena', d ? cena(d.px) : '—'));
        // Under a WORKING price it used to say "no data", because the fallback sources
        // have no 24-hour change. Now the SOURCE is printed whenever the price does not come from
        // the main source - and the source matters more than the change, because on 17 Aug 2026
        // exactly a wrong source gave a 40 % wrong price without anyone noticing.
        var sp;
        if (d && d.vir) {
          sp = el('div', 'eko-spr', 'via ' + (d.vir === 'pulsex' ? 'PulseX' : 'CoinGecko'));
        } else if (d && isFinite(d.h24)) {
          sp = el('div', 'eko-spr', (d.h24 >= 0 ? '+' : '') + d.h24.toFixed(2) + '%');
          sp.className += d.h24 >= 0 ? ' gor' : ' dol';
        } else if (d) {
          sp = el('div', 'eko-spr', '24h n/a');
        } else {
          sp = el('div', 'eko-spr', 'no data');
        }
        c.appendChild(sp);
        var lnk = document.createElement('a');
        lnk.className = 'eko-lnk';
        lnk.href = 'https://dexscreener.com/' + DS_CHAIN[t.chain] + '/' + t.addr;
        lnk.target = '_blank';
        lnk.rel = 'noopener noreferrer';
        lnk.textContent = 'OPEN MARKET →';
        c.appendChild(lnk);
        box.appendChild(c);
      });
      return m;
    }
  }

  /* ---------- custom tokens (added by contract address) ---------- */
  // Why: automatic discovery via Blockscout does not see everything - a new token,
  // a token without an index, or one the explorer leaves out. Adding by hand
  // closes that gap. Stored only in this browser.
  var TOK_KEY = 'gopulse_custom_tokens';
  function customTokens() {
    try { var a = JSON.parse(localStorage.getItem(TOK_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function addCustomToken(addr, chain) {
    var a = customTokens();
    var k = addr.toLowerCase();
    if (a.some(function (x) { return x.addr === k && x.chain === chain; })) return false;
    a.push({ addr: k, chain: chain });
    try { localStorage.setItem(TOK_KEY, JSON.stringify(a.slice(0, 40))); } catch (e) {}
    return true;
  }
  function removeCustomToken(addr, chain) {
    var a = customTokens().filter(function (x) { return !(x.addr === addr.toLowerCase() && x.chain === chain); });
    try { localStorage.setItem(TOK_KEY, JSON.stringify(a)); } catch (e) {}
  }

  // symbol() 0x95d89b41 · decimals() 0x313ce567 · balanceOf(addr) 0x70a08231
  function ethCall(chain, to, data) {
    var urls = rpcList(chain), i = 0;
    function attempt() {
      if (i >= urls.length) return Promise.resolve(null);
      var u = urls[i++];
      return timeoutFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }) }, 12000)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) { if (!j || !j.result) return Promise.reject(); return j.result; })
        .catch(attempt);
    }
    return attempt();
  }
  function dekodirajNiz(hex) {
    try {
      if (!hex || hex.length < 130) return null;
      var dolzina = parseInt(hex.slice(66, 130), 16);
      var b = hex.slice(130, 130 + dolzina * 2);
      return decodeURIComponent(b.replace(/(..)/g, '%$1')).replace(/\0/g, '').trim();
    } catch (e) { return null; }
  }
  function beriCustom(walletAddr, t) {
    var pad = walletAddr.slice(2).toLowerCase().padStart(64, '0');
    return Promise.all([
      ethCall(t.chain, t.addr, '0x95d89b41'),
      ethCall(t.chain, t.addr, '0x313ce567'),
      ethCall(t.chain, t.addr, '0x70a08231' + pad)
    ]).then(function (r) {
      if (!r[2]) return null;
      var raw = BigInt(r[2]);
      if (raw === 0n) return null;
      return { addr: t.addr, sym: dekodirajNiz(r[0]) || '?', name: 'added manually',
               dec: r[1] ? parseInt(r[1], 16) : 18, raw: raw.toString(), chain: t.chain, rocno: true };
    }).catch(function () { return null; });
  }


  // Which build is actually running, printed on the page. Twice today a fix
  // "did not work" purely because the browser was serving an older cached
  // index.html; there is no way to tell that by looking at the screen, so now
  // there is.
  var WBAL_VER = (function () {
    try {
      var me = document.currentScript || [].slice.call(document.scripts)
        .filter(function (x) { return (x.src || '').indexOf('wallets.js') > -1; })[0];
      var m = /[?&]v=([0-9]+)/.exec((me && me.src) || '');
      return m ? m[1] : 'unknown';
    } catch (e) { return 'unknown'; }
  })();

  /* ---------- names ---------- */
  // Kept on this device (localStorage) and also carried inside a saved code,
  // so a set imported in another browser arrives already labelled.
  var LBL_KEY = 'gopulse_labels';

  function labels() {
    try { var o = JSON.parse(localStorage.getItem(LBL_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function setLabel(addr, name) {
    var o = labels();
    if (name) o[addr.toLowerCase()] = name.slice(0, 40);
    else delete o[addr.toLowerCase()];
    try { localStorage.setItem(LBL_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function labelFor(addr) { return labels()[addr.toLowerCase()] || ''; }

  // Which cards are collapsed, remembered per address so the choice survives
  // a reload. Kept separate from the names so clearing one does not lose the other.
  // Own address list, independent of the analyzer's.
  // app.js caps itself at 10 wallets per session because a stake scan is
  // expensive; reading balances is not, so this section keeps its own list and
  // leaves app.js untouched. The first 10 are mirrored into the analyzer so
  // stake analysis still works on them.
  var WAL_KEY = 'gopulse_wallets';
  var MAX_WALLETS = 30;
  var MIRROR = 10;

  function myList() {
    try {
      var a = JSON.parse(localStorage.getItem(WAL_KEY) || '[]');
      if (!Array.isArray(a)) return [];
      return a.filter(function (x) { return /^0x[0-9a-fA-F]{40}$/.test(x); })
              .map(function (x) { return x.toLowerCase(); })
              .slice(0, MAX_WALLETS);
    } catch (e) { return []; }
  }
  function setMyList(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (a) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return;
      a = a.toLowerCase();
      if (seen[a]) return;
      seen[a] = 1;
      if (out.length < MAX_WALLETS) out.push(a);
    });
    try { localStorage.setItem(WAL_KEY, JSON.stringify(out)); } catch (e) {}
    mirror(out);
    return out;
  }
  // Keep the analyzer usable: hand it the first MIRROR addresses.
  function mirror(list) {
    if (typeof wallets === 'undefined' || !Array.isArray(wallets)) return;
    wallets.length = 0;
    list.slice(0, MIRROR).forEach(function (a) { wallets.push(a); });
    try { if (typeof renderWalletList === 'function') renderWalletList(); } catch (e) {}
  }
  function addAddrs(text) {
    var found = String(text || '').match(/0x[0-9a-fA-F]{40}/g) || [];
    if (!found.length) return 0;
    var before = myList();
    var after = setMyList(before.concat(found));
    return after.length - before.length;
  }
  function removeAddr(addr) {
    setMyList(myList().filter(function (a) { return a !== addr.toLowerCase(); }));
  }

  var COL_KEY = 'gopulse_collapsed';
  function collapsed() {
    try { var a = JSON.parse(localStorage.getItem(COL_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function isCollapsed(addr) { return collapsed().indexOf(addr.toLowerCase()) > -1; }
  function setCollapsed(addr, on) {
    var a = collapsed(), k = addr.toLowerCase(), i = a.indexOf(k);
    if (on && i < 0) a.push(k);
    if (!on && i > -1) a.splice(i, 1);
    try { localStorage.setItem(COL_KEY, JSON.stringify(a)); } catch (e) {}
  }
  function mergeLabels(map) {
    if (!map || typeof map !== 'object') return;
    var o = labels();
    Object.keys(map).forEach(function (k) {
      if (typeof map[k] === 'string' && map[k]) o[k.toLowerCase()] = map[k].slice(0, 40);
    });
    try { localStorage.setItem(LBL_KEY, JSON.stringify(o)); } catch (e) {}
  }

  /* ---------- helpers ---------- */

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function usd(n) {
    if (!isFinite(n)) return '—';
    if (n === 0) return '$0.00';
    if (n < 0.01) return '<$0.01';
    if (n < 1000) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function qty(n) {
    if (!isFinite(n)) return '\u2014';
    if (n === 0) return '0';
    if (n < 1e-6) return n.toExponential(2);
    if (n < 1) return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    if (n < 1e6) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function num(v, dec) { return Number(v) / Math.pow(10, dec || 0); }
  function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }

  function rpcList(chain) {
    try {
      if (chain === 'eth' && typeof ethUrls === 'function') return ethUrls();
      if (chain === 'pls' && typeof rpcsFor === 'function') return rpcsFor('pls');
    } catch (e) { /* fall through */ }
    return FALLBACK_RPC[chain];
  }

  function timeoutFetch(url, opts, ms) {
    var ac = new AbortController();
    var t = setTimeout(function () { ac.abort(); }, ms || 20000);
    opts = opts || {};
    opts.signal = ac.signal;
    return fetch(url, opts).finally(function () { clearTimeout(t); });
  }

  /* ---------- data ---------- */

  function nativeBalance(addr, chain) {
    var urls = rpcList(chain);
    var i = 0;
    function attempt() {
      if (i >= urls.length) return Promise.resolve(0);
      var u = urls[i++];
      return timeoutFetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] })
      }, 15000)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          if (!j || !j.result) return Promise.reject();
          return Number(BigInt(j.result)) / 1e18;
        })
        .catch(attempt);
    }
    return attempt();
  }

  // Blockscout lists every token the address holds, with decimals and symbol.
  // 24 Nov 2026: at most 2 token-list requests per chain at a time, and one more try after 3 s.
  // With 7 wallets requested at once FusionScan answered 503 to some of them, gp-source then moved
  // everything to the official explorer, whose token-balances did not answer at all - so every
  // wallet ended up "incomplete". The timeout is 30 s because gp-source may try FusionScan twice (12 s each).
  var vrstaTok = {};
  function vVrsti(chain, fn) {
    var v = vrstaTok[chain] || (vrstaTok[chain] = { tece: 0, cakajo: [] });
    return new Promise(function (ok, ne) {
      function zazeni() {
        v.tece++;
        fn().then(ok, ne).then(function () { v.tece--; var n = v.cakajo.shift(); if (n) n(); });
      }
      if (v.tece < 2) zazeni(); else v.cakajo.push(zazeni);
    });
  }
  function tokenBalances(addr, chain) {
    return vVrsti(chain, function () { return tokenBalancesEnkrat(addr, chain); })
      .catch(function () {
        return new Promise(function (r) { setTimeout(r, 3000); })
          .then(function () { return vVrsti(chain, function () { return tokenBalancesEnkrat(addr, chain); }); });
      });
  }
  function tokenBalancesEnkrat(addr, chain) {
    // 30 s since 24 Nov 2026 (two FusionScan tries, see above); 15 s until then, 8 s until 22 Nov 2026. Measured 8 Sep 2026: a normal answer takes 0.3-2.3 s, an occasional
    // straggler hung for 19.5 s. Waiting 25 s means waiting for the exception.
    // When the time runs out, this chain is marked as incomplete (the card says so and
    // the total gets a >= sign), which is better than half a minute of empty screen.
    // 25 Nov 2026: /tokens?type=ERC-20 (paged, 50 per page) instead of /token-balances. For wallets with
    // many tokens FusionScan answered /token-balances with 503 "query_budget" (its per-request limit) and the
    // official explorer did not answer it at all, while /tokens came back in 0.1-0.3 s from both.
    var vse = [], strani = 0;
    function stran(param) {
      var u = BS[chain] + '/addresses/' + addr + '/tokens?type=ERC-20' + (param ? '&' + param : '');
      return timeoutFetch(u, null, 30000)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) {
          var it = j && Array.isArray(j.items) ? j.items : (Array.isArray(j) ? j : null);
          if (!it) throw new Error('unexpected answer');
          vse = vse.concat(it);
          var n = j.next_page_params;
          if (n && typeof n === 'object' && ++strani < 20) {
            return stran(Object.keys(n).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(n[k]); }).join('&'));
          }
          return vse;
        });
    }
    return stran('')
      .then(function (arr) {
        return arr.filter(function (t) {
          return t && t.token && (!t.token.type || t.token.type === 'ERC-20') && t.value && t.value !== '0';
        }).filter(function (t) {
          return (t.token.address || t.token.address_hash);
        }).map(function (t) {
          return {
            // The two explorers do NOT use the same field name:
            //   api.scan.pulsechain.com -> token.address
            //   eth.blockscout.com      -> token.address_hash
            // Reading only the first one gave every Ethereum token an empty
            // address, so every price lookup missed and the whole Ethereum
            // side was reported as "no price found". Nothing errored.
            addr: (t.token.address || t.token.address_hash || '').toLowerCase(),
            sym: t.token.symbol || '?',
            name: t.token.name || '',
            dec: parseInt(t.token.decimals || '18', 10) || 0,
            raw: t.value,
            chain: chain
          };
        });
      });
  }

  // Pricing endpoint — the choice matters, so the reasoning is recorded here.
  //
  // /latest/dex/tokens/{addrs} caps the RESPONSE at 30 pairs, not 30 tokens.
  // Measured 16.8.2026:
  //   30 addresses in one request -> 30 pairs covering only 5 distinct tokens
  //   1 address (HEX) in one request -> 30 pairs: 19 pulsechain + 11 ethereum
  // So a token with many pools starves both the other tokens AND the other
  // chain. That is why every Ethereum holding was reported as unpriced while
  // the same token on PulseChain priced fine: PulseChain pools filled the quota.
  //
  // /tokens/v1/{chainId}/{addrs} is scoped to one chain and returns the top
  // pool per token, so 25 addresses come back as 25 usable answers.
  // Verified: HEX -> ethereum $0.001547, pulsechain $0.002978, matching both
  // the wallet and the analyzer's own figures.
  var DS_V1 = 'https://api.dexscreener.com/tokens/v1/';
  var CHUNK = 25;
  var RETRY_MS = 900;

  /* ---- FALLBACK PRICE SOURCE FOR PULSECHAIN: PulseX subgraph -------------------
     WHY IT EXISTS - morning of 24 Aug 2026. DexScreener's routes for `pulsechain`
     stopped answering (HTTP 000, no connection was made), while the
     routes for `ethereum` worked normally. The effect on the page: pHEX, PLS,
     PLSX, INC and PRVX showed "no data", 38 tokens were left without a price,
     Stake Value dropped from $10.36K to $2.79K and the total from $13,105 to $3,184.
     The page looked as if the user had become poor overnight.

     Prices were the only thing on the page with a SINGLE source. That is exactly what
     standing rule 3 warns against (PULSECHAIN-NATIVE.md): an intermediary never
     alone. And exactly what this page was created against - that a dependency on
     a third-party service one day turns the lights off.

     The PulseX subgraph has `derivedUSD` for every token that has a pool on PulseX, and
     at that same moment it worked without problems. Measured while DexScreener
     was not answering:
         HEX  $0.00408187      (DexScreener last $0.004201)
         INC  $0.70773542      (last $0.7147)
         PRVX $0.00008546      (last $0.00008399)
     Differences up to ~2 %: PulseX is ONE DEX, while DexScreener takes the deepest pool
     anywhere. For showing balances this is entirely enough.

     USED ONLY FOR THE MISSING ONES. DexScreener stays the main source, because it also covers
     tokens that have no pool on PulseX (9mm, Liberty ...). The subgraph fills the
     gaps - and when DexScreener is down, the gaps are simply everything.

     One query for ALL addresses at once (id_in), not in chunks.                */
  var PULSEX_CENE = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2';

  function subgraphCene(addrs) {
    if (!addrs || !addrs.length) return Promise.resolve({});
    var ids = addrs.slice(0, 200).map(function (a) { return '"' + a.toLowerCase() + '"'; }).join(',');
    var q = '{tokens(where:{id_in:[' + ids + ']}){id symbol derivedUSD totalLiquidity}}';
    return timeoutFetch(PULSEX_CENE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q })
    }, 20000)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) {
        if (!j || j.errors || !j.data || !Array.isArray(j.data.tokens)) {
          throw new Error('subgraph returned no prices');
        }
        var out = {};
        j.data.tokens.forEach(function (x) {
          var px = parseFloat(x.derivedUSD);
          if (!isFinite(px) || px <= 0) return;
          // totalLiquidity is in TOKEN UNITS, not dollars - for the Pool column
          // it has to be multiplied by the price, otherwise PLSX would show 126 billion.
          var liq = parseFloat(x.totalLiquidity);
          out[x.id.toLowerCase()] = {
            px: px,
            liq: isFinite(liq) ? liq * px : 0,
            vir: 'pulsex'
          };
        });
        return out;
      })
      .catch(function () { return {}; });
  }

  function priceChunk(addrs, chain, retry) {
    return timeoutFetch(DS_V1 + DS_CHAIN[chain] + '/' + addrs.join(','), null, 10000)
      .then(function (r) {
        if (r.status === 429 && !retry) {
          return new Promise(function (res) { setTimeout(res, RETRY_MS); })
            .then(function () { return priceChunk(addrs, chain, true); });
        }
        if (!r.ok) return [];
        return r.json();
      })
      .then(function (arr) {
        if (!Array.isArray(arr)) return arr && arr.__map ? arr : [];
        var out = {};
        arr.forEach(function (p) {
          if (p.chainId !== DS_CHAIN[chain]) return;
          var a = ((p.baseToken || {}).address || '').toLowerCase();
          var px = parseFloat(p.priceUsd);
          var liq = ((p.liquidity || {}).usd) || 0;
          if (!a || !isFinite(px)) return;
          if (!out[a] || liq > out[a].liq) out[a] = { px: px, liq: liq };
        });
        out.__map = true;
        return out;
      })
      .catch(function () { return { __map: true }; });
  }

  function priceMap(addrs, chain) {
    var chunks = [];
    for (var i = 0; i < addrs.length; i += CHUNK) chunks.push(addrs.slice(i, i + CHUNK));
    var out = {};
    // Sequential on purpose: a handful of requests, no rate-limit risk.
    return chunks.reduce(function (chain0, c) {
      return chain0.then(function () {
        return priceChunk(c, chain).then(function (m) {
          for (var k in m) if (k !== '__map') out[k] = m[k];
        });
      });
    }, Promise.resolve()).then(function () { return out; })
      .then(function (m) {
        if (chain !== 'pls') return m;
        var manjka = addrs.filter(function (a) { return !m[a]; });
        if (!manjka.length) return m;
        return subgraphCene(manjka).then(function (sg) {
          for (var k in sg) if (!m[k]) m[k] = sg[k];
          return m;
        });
      });
  }

  function priceOne(addr, chain) {
    return priceChunk([addr], chain).then(function (m) {
      if (m[addr] || chain !== 'pls') return m[addr] || null;
      // Without this, during a DexScreener outage even the NATIVE PLS would be left without a price,
      // i.e. the most important number on the page.
      return subgraphCene([addr]).then(function (sg) { return sg[addr] || null; });
    });
  }

  // 22 Nov 2026 (owner): vPLS (Vouch liquid staking) is not valued by the shallow DEX pool,
  // but by the contract rate getRate() x PLS price - at Vouch, vPLS is exchanged back into PLS.
  // Without this, a larger holding was marked "not counted" (worth more than the pool).
  var VPLS = '0x79bb3a0ee435f957ce4f54ee8c3cfadc7278da0c';
  var vplsObljuba = null;
  function vplsTecaj() {
    if (vplsObljuba) return vplsObljuba;
    var urls = rpcList('pls'), i = 0;
    function poskus() {
      if (i >= urls.length) return Promise.resolve(null);
      return timeoutFetch(urls[i++], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to: VPLS, data: '0x679aefce' }, 'latest'] })   // getRate()
      }, 15000)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) {
          var v = j && j.result ? Number(BigInt(j.result)) / 1e18 : 0;
          if (!(v > 0.5 && v < 100)) return Promise.reject();   // nonsensical answer
          return v;
        })
        .catch(poskus);
    }
    vplsObljuba = poskus().then(function (v) { if (v == null) vplsObljuba = null; return v; });
    return vplsObljuba;
  }

  function loadWallet(addr) {
    var chains = ['pls', 'eth'];
    return Promise.all(chains.map(function (ch) {
      return Promise.all([
        nativeBalance(addr, ch).catch(function () { return 0; }),
        tokenBalances(addr, ch).catch(function () { return null; })
      ]).then(function (res) {
        var nat = res[0], toks = res[1];
        var failed = toks === null;
        toks = toks || [];
        // Cap the priced set so a wallet dusted with 800 spam tokens
        // does not turn into 30 DexScreener requests.
        var byValueGuess = toks.slice(0, MAX_TOKENS_PRICED);
        // tokens added by hand for this chain - read directly from the contract
        var rocni = customTokens().filter(function (x) { return x.chain === ch; });
        return Promise.all(rocni.map(function (t) { return beriCustom(addr, t); }))
          .then(function (dodatki) {
            dodatki.filter(Boolean).forEach(function (d) {
              if (!toks.some(function (t) { return t.addr === d.addr; })) toks.push(d);
            });
            return nadaljuj();
          });

        function nadaljuj() {
        var wrapped = WRAPPED[ch].toLowerCase();
        var want = byValueGuess.map(function (t) { return t.addr; })
          .filter(function (a) { return a !== wrapped; });
        // The chain's own coin is priced first and on its own. Queued behind a
        // few hundred token lookups it was the one getting rate-limited away,
        // which quietly removed a real ETH holding from the total.
        return priceOne(wrapped, ch).then(function (nativePx) {
          return priceMap(want, ch).then(function (pm) {
            if (nativePx) pm[wrapped] = nativePx;
            return pm;
          });
        }).then(function (pm) {
          if (ch !== 'pls' || !toks.some(function (t) { return t.addr === VPLS; })) return pm;
          return vplsTecaj().then(function (rt) { pm.__vtecaj = rt; return pm; });
        }).then(function (pm) {
          var rows = [];
          var wp = pm[WRAPPED[ch].toLowerCase()];
          if (nat > 0) {
            rows.push({
              sym: ch === 'pls' ? 'PLS' : 'ETH',
              name: ch === 'pls' ? 'PulseChain' : 'Ether',
              chain: ch, qty: nat, native: true,
              px: wp ? wp.px : null,
              usd: wp ? nat * wp.px : null,
              liq: wp ? wp.liq : null
            });
          }
          var asked = {};
          want.forEach(function (a) { asked[a] = true; });
          toks.forEach(function (t) {
            var p = pm[t.addr];
            var q = num(t.raw, t.dec);
            var ok = p && p.liq >= MIN_LIQ_USD;
            // 10 Nov 2026 (owner): a holding worth MORE than the whole pool is not counted in the total.
            // Fake (spam) tokens have an invented price in a pool worth a few cents - ePEPE:
            // 20 units x $481 million with a $0.04 pool gave $9.6 billion on the wallet.
            // That cannot be cashed out, so the value is "-". Applies only to DexScreener prices
            // (CoinGecko has no pool data, liq = 0) and only if the pool is known (> 0).
            if (ch === 'pls' && t.addr === VPLS && pm.__vtecaj && wp) {
              rows.push({
                sym: t.sym, name: t.name + ' \u00b7 at Vouch rate', chain: ch, qty: q, native: false,
                chk: true, px: pm.__vtecaj * wp.px, usd: q * pm.__vtecaj * wp.px,
                liq: p ? p.liq : null, plitev: false, vouch: pm.__vtecaj
              });
              return;
            }
            var vred = ok ? q * p.px : null;
            var plitev = !!(ok && p.vir !== 'coingecko' && p.liq > 0 && vred > p.liq);
            rows.push({
              sym: t.sym, name: t.name, chain: ch, qty: q, native: false,
              chk: !!asked[t.addr],
              px: ok ? p.px : null,
              usd: plitev ? null : vred,
              liq: p ? p.liq : null,
              plitev: plitev
            });
          });
          return { chain: ch, rows: rows, failed: failed };
        });
        }
      });
    })).then(function (parts) {
      var rows = [], failed = [];
      parts.forEach(function (p) {
        rows = rows.concat(p.rows);
        if (p.failed) failed.push(p.chain);
      });
      return { addr: addr, rows: rows, failed: failed };
    });
  }

  /* ---------- rendering ---------- */

  function table(rows) {
    var t = el('table', 'wbal-tbl');
    var thead = el('thead');
    var hr = el('tr');
    ['Asset', 'Amount', 'Price', 'Pool', 'Value'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      var td0 = el('td');
      td0.appendChild(el('span', 'wbal-sym', r.sym));
      if (r.name) td0.appendChild(el('span', 'wbal-name', r.name));
      td0.appendChild(el('span', 'wbal-chip ' + r.chain, r.chain === 'pls' ? 'PLS' : 'ETH'));
      tr.appendChild(td0);
      // data-l carries the column name - on a phone CSS prints it before the value,
      // because the five-column table breaks into rows there.
      var tdQ = el('td', null, qty(r.qty)); tdQ.dataset.l = 'Amount'; tr.appendChild(tdQ);
      var tdP = el('td', null, r.px == null ? '—' : (r.px < 0.01 ? '$' + r.px.toPrecision(3) : usd(r.px)));
      tdP.dataset.l = 'Price'; tr.appendChild(tdP);
      var tdL = el('td', null, r.liq == null ? '—' : usd(r.liq));
      tdL.dataset.l = 'Pool';
      if (r.liq != null && r.liq < 2000) tdL.className = 'wbal-thin';
      tr.appendChild(tdL);
      var tdV = el('td', null, r.usd == null ? '—' : usd(r.usd));
      tdV.dataset.l = 'Value'; tdV.className = 'wbal-val';
      if (r.plitev) {
        tdV.className = 'wbal-val wbal-thin';
        tdV.title = 'Worth more than its whole pool (' + usd(r.liq) + ') — cannot be sold at this price, not counted in the total';
        tdV.textContent = '— not counted';
      }
      if (r.vouch) tdV.title = 'Valued at the Vouch contract rate: 1 vPLS = ' + r.vouch.toFixed(4) +
        ' PLS (getRate) \u00d7 PLS price. Redeeming through Vouch may take time.';
      tr.appendChild(tdV);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var wrap = el('div', 'wbal-scroll');
    wrap.appendChild(t);
    return wrap;
  }

  function renderWallet(w) {
    var box = el('div', 'wbal-wallet');
    var hdr = el('div', 'wbal-wallet-hdr');
    var body = el('div', 'wbal-body');
    var togg = el('button', 'wbal-toggle');
    togg.type = 'button';
    hdr.appendChild(togg);
    var name = labelFor(w.addr);
    if (name) hdr.appendChild(el('span', 'wbal-label', name));
    var addrEl = el('span', 'wbal-addr', shortAddr(w.addr));
    addrEl.title = 'Click to name this wallet';
    // Inline field rather than prompt(): browsers increasingly refuse modal
    // dialogs, and a refused prompt() looks exactly like a dead button.
    function openRename() {
      if (hdr.querySelector('.wbal-rename')) return;
      var wrap = el('span', 'wbal-rename');
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'wbal-input';
      inp.placeholder = 'Name for this wallet';
      inp.maxLength = 40;
      inp.value = labelFor(w.addr);
      var ok = el('button', 'wbal-btn', 'Save');
      var no = el('button', 'wbal-btn', 'Cancel');
      var close = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
      var commit = function () { setLabel(w.addr, inp.value.trim()); close(); run(); };
      ok.addEventListener('click', commit);
      no.addEventListener('click', close);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') close();
      });
      wrap.appendChild(inp); wrap.appendChild(ok); wrap.appendChild(no);
      hdr.appendChild(wrap);
      inp.focus(); inp.select();
    }
    addrEl.addEventListener('click', openRename);
    hdr.appendChild(addrEl);
    // Explicit button as well: clicking bare text is not discoverable, and the
    // analyzer shows a near-identical address chip further up the page, so
    // "click the address" was ambiguous in practice.
    var nameBtn = el('button', 'wbal-btn wbal-mini', name ? 'Rename' : 'Name');
    nameBtn.type = 'button';
    // Bound directly rather than forwarding to addrEl.click(): the indirection
    // bought nothing and made the button's behaviour depend on another
    // element's handler still being attached.
    nameBtn.addEventListener('click', openRename);
    hdr.appendChild(nameBtn);
    var known = w.rows.filter(function (r) { return r.usd != null; });
    var total = known.reduce(function (s, r) { return s + r.usd; }, 0);
    hdr.appendChild(el('span', 'wbal-sum', usd(total)));
    var del = el('button', 'wbal-x', '\u00D7');
    del.type = 'button';
    del.title = 'Remove from this list';
    del.addEventListener('click', function () { removeAddr(w.addr); busy = false; run(); });
    hdr.appendChild(del);
    box.appendChild(hdr);

    var main = w.rows.filter(function (r) { return r.usd != null; })
      .sort(function (a, b) { return b.usd - a.usd; });
    var rest = w.rows.filter(function (r) { return r.usd == null; })
      .sort(function (a, b) { return (b.qty || 0) - (a.qty || 0); });

    if (main.length) body.appendChild(table(main));
    else body.appendChild(el('div', 'wbal-empty', 'No priced holdings found for this address.'));

    if (rest.length) {
      var d = el('details', 'wbal-more');
      d.appendChild(el('summary', null,
        (function () {
          var un = rest.filter(function (r) { return r.chk === false; }).length;
          var txt = rest.length + ' more without a price';
          if (un) txt += ' \u2014 ' + un + ' of them were not looked up (only the first ' +
                         MAX_TOKENS_PRICED + ' tokens per chain are checked)';
          return txt;
        })()));
      d.appendChild(table(rest));
      body.appendChild(d);
    }
    if (w.failed.length) {
      body.appendChild(el('div', 'wbal-err',
        'Token list unavailable for ' + w.failed.join(', ').toUpperCase() +
        ' — the block explorer API did not answer. Native balance is still shown.'));
    }
    box.appendChild(body);

    function apply(on) {
      body.style.display = on ? 'none' : '';
      togg.textContent = on ? '\u25B8' : '\u25BE';
      togg.title = on ? 'Expand' : 'Collapse';
      box.className = 'wbal-wallet' + (on ? ' wbal-shut' : '');
    }
    apply(isCollapsed(w.addr));
    togg.addEventListener('click', function () {
      var next = !isCollapsed(w.addr);
      setCollapsed(w.addr, next);
      apply(next);
    });

    return { node: box, total: total };
  }

  function section() {
    var s = document.getElementById('wbal-sec');
    if (s) return s;
    s = el('div', null);
    s.id = 'wbal-sec';
    // Placed above the site title bar, so the wallets are the very first thing
    // on the page. Moving our own node is preferable to reordering theirs:
    // index.html stays as exported. Deliberately NOT inside #dash: it stays hidden
    // until an analysis finishes, and anything placed in it disappears with it.
    var before = document.querySelector('.topbar') ||
                 document.querySelector('.ticker') ||
                 document.getElementById('daybar') ||
                 document.querySelector('.search');
    if (before && before.parentNode) before.parentNode.insertBefore(s, before);
    else document.body.appendChild(s);
    return s;
  }

  // The header is drawn even with no addresses loaded — otherwise "Load code"
  // only appears once you already have wallets, which is exactly backwards for
  // someone arriving in a fresh browser with nothing but a code.
  function header(withTotal) {
    var s = section();
    s.className = 'on';
    s.textContent = '';

    // ecosystem strip - prices of the main tokens, separate from the wallets
    var eko = el('div', 'eko-trak');
    eko.appendChild(el('div', 'eko-nalagam', 'loading ecosystem prices…'));
    s.appendChild(eko);
    var ekoObljuba = renderEko(eko);

    // network status - between prices (ecosystem) and values (wallets)
    // The node goes into the DOM at once (so the order is fixed), but the content only
    // when renderEko has set cenaPls - otherwise the Gas card would sometimes show
    // the swap cost in dollars and sometimes not, depending on which fetch
    // came first. If there is no price, it still renders, just without the dollar line.
    var net = el('div', 'net-trak');
    net.appendChild(el('div', 'eko-nalagam', 'reading network status…'));
    s.appendChild(net);
    // Only ONE render - calling it twice would mean double requests and a visible jump.
    ekoObljuba.then(function () { renderOmrezje(net); },
                    function () { renderOmrezje(net); });

    var pov = el('div', 'pov-trak');
    pov.id = 'wbal-povzetek';
    s.appendChild(pov);
    renderPovzetek(pov);

    var hdr = el('div', 'wbal-hdr');
    // Two-tone like their own "HEX Stake Analyzer": the coloured word carries
    // the gradient, the second word stays quiet. Measured from .topbar —
    // "Stake Analyzer" is Inter 16/400 at rgba(255,255,255,.6).
    hdr.appendChild(el('span', 'wbal-title', 'WALLETS'));
    hdr.appendChild(el('span', 'wbal-title2', 'Screener'));
    hdr.appendChild(el('span', 'wbal-ver', 'build ' + WBAL_VER));
    // Refresh exists because adding a wallet chip does not re-run the
    // analyzer: the chips showed two wallets while this section still showed
    // one card, and the missing card meant no Rename button for wallet #2.
    var refreshBtn = el('button', 'wbal-btn', 'Refresh');
    refreshBtn.type = 'button';
    refreshBtn.addEventListener('click', function () { busy = false; run(); });
    var saveBtn = el('button', 'wbal-btn', 'Save as code');
    var loadBtn = el('button', 'wbal-btn', 'Load code');
    saveBtn.type = 'button';
    loadBtn.type = 'button';
    saveBtn.addEventListener('click', saveCode);
    loadBtn.addEventListener('click', loadCode);
    if (!currentWallets().length) { saveBtn.disabled = true; refreshBtn.disabled = true; }
    hdr.appendChild(refreshBtn);
    hdr.appendChild(saveBtn);
    hdr.appendChild(loadBtn);
    var totalEl = null;
    if (withTotal) { totalEl = el('span', 'wbal-total', 'loading\u2026'); hdr.appendChild(totalEl); }
    s.appendChild(hdr);
    var codeSlot = el('div', 'wbal-code');
    codeSlot.id = 'wbal-code';
    s.appendChild(codeSlot);

    // Own add field: the analyzer's own input stops at 10 wallets, this one
    // does not, because reading balances is cheap compared with a stake scan.
    var addRow = el('div', 'wbal-add');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'wbal-input wbal-input-wide';
    inp.placeholder = 'Add address(es) 0x… — paste several at once, up to ' + MAX_WALLETS;
    inp.spellcheck = false;
    var addBtn = el('button', 'wbal-btn', 'Add');
    addBtn.type = 'button';
    var msg = el('span', 'wbal-addmsg');
    var doAdd = function () {
      var n = addAddrs(inp.value);
      if (!n) { msg.textContent = myList().length >= MAX_WALLETS
        ? 'List is full (' + MAX_WALLETS + ').' : 'No new address found.'; return; }
      inp.value = '';
      msg.textContent = '';
      busy = false;
      run();
    };
    addBtn.addEventListener('click', doAdd);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAdd(); });
    addRow.appendChild(inp);
    addRow.appendChild(addBtn);
    addRow.appendChild(el('span', 'wbal-count', myList().length + ' / ' + MAX_WALLETS));
    addRow.appendChild(msg);
    s.appendChild(addRow);

    // Add a token by contract address - closes the gap in automatic discovery.
    var tokRow = el('div', 'wbal-add');
    var tokInp = document.createElement('input');
    tokInp.type = 'text';
    tokInp.className = 'wbal-input wbal-input-wide';
    tokInp.placeholder = 'Add token by contract 0x… (if not found automatically)';
    tokInp.spellcheck = false;
    var tokSel = document.createElement('select');
    tokSel.className = 'wbal-select';
    [['pls', 'PulseChain'], ['eth', 'Ethereum']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; tokSel.appendChild(op);
    });
    var tokBtn = el('button', 'wbal-btn', 'Add token');
    tokBtn.type = 'button';
    var tokMsg = el('span', 'wbal-addmsg');
    var doTok = function () {
      var m = (tokInp.value || '').match(/0x[0-9a-fA-F]{40}/);
      if (!m) { tokMsg.textContent = 'Not a contract address.'; return; }
      if (!addCustomToken(m[0], tokSel.value)) { tokMsg.textContent = 'Already added.'; return; }
      tokInp.value = ''; tokMsg.textContent = '';
      busy = false; run();
    };
    tokBtn.addEventListener('click', doTok);
    tokInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doTok(); });
    tokRow.appendChild(tokInp); tokRow.appendChild(tokSel); tokRow.appendChild(tokBtn);
    var ct = customTokens();
    if (ct.length) {
      var dd = el('span', 'wbal-count', ct.length + ' manually added \u00D7');
      dd.title = 'Click to remove the last one';
      dd.style.cursor = 'pointer';
      dd.addEventListener('click', function () {
        var z = customTokens().pop();
        if (z) { removeCustomToken(z.addr, z.chain); busy = false; run(); }
      });
      tokRow.appendChild(dd);
    }
    tokRow.appendChild(tokMsg);
    s.appendChild(tokRow);

    return { sec: s, total: totalEl };
  }

  function idleBar() {
    if (busy) return;
    if (currentWallets().length) return;
    var h = header(false);
    h.sec.appendChild(el('div', 'wbal-empty',
      'Add a wallet address below, or press Load code to restore a set saved in another browser.'));
  }

  function run() {
    if (busy) return;
    var list = myList();
    if (!list.length) { idleBar(); return; }
    busy = true;

    var h = header(true);
    var s = h.sec;
    var totalEl = h.total;
    s.appendChild(el('div', 'wbal-note',
      'Read-only. Balances come from the public block explorer, prices from DexScreener \u2014 ' +
      'with the PulseX subgraph as a fallback when it is unreachable \u2014 ' +
      'the deepest pool per token. Pool depth is shown so you can see which prices rest on thin ' +
      'liquidity; a highlighted figure there means the price may not survive an actual sale. ' +
      'Nothing is stored and no wallet is connected. Informational only, not financial advice.'));

    // Data status - which source, when. Like hexologist.com: if
    // data is partial or unavailable, say so, instead of looking fresh.
    var stanje = el('div', 'wbal-stanje');
    stanje.id = 'wbal-stanje';
    s.appendChild(stanje);

    var body = el('div');
    s.appendChild(body);

    // Each wallet is drawn AS SOON AS it is ready. Before, there was a single
    // Promise.all here and drawing only in .then: while one was waiting, none
    // were visible. Measured 8 Sep 2026: one Blockscout straggler (19.5 s) kept
    // all seven wallets empty, although six of them answered in under two
    // seconds. The slots are prepared in advance, so the order stays the order
    // of the list and not the order of the answers.
    var grand = 0, done = 0, nepopolnih = 0;
    var mesta = list.map(function () { var d = el('div'); body.appendChild(d); return d; });

    // A partial total is shown, but NEVER as final: the >= sign says that some
    // wallets are still missing. A number without that sign would be wrong and
    // look right.
    function pisiVsoto(koncano) {
      if (!done) { totalEl.textContent = '—'; totalEl.title = ''; return; }
      totalEl.textContent = (!koncano || nepopolnih ? '\u2265' : '') + usd(grand);
      totalEl.title = !koncano
        ? 'Still loading — ' + done + ' of ' + list.length + ' wallets counted so far.'
        : (nepopolnih
            ? nepopolnih + ' wallet(s) returned an incomplete token list, so the real total is higher.'
            : '');
    }

    function pisiStanje(koncano, all) {
      var stEl = document.getElementById('wbal-stanje');
      if (!stEl) return;
      stEl.textContent = '';
      if (!koncano) {
        // Neutral dot: while it runs, we do not know whether it will be good or bad.
        stEl.appendChild(el('span', 'st-pika', '●'));
        stEl.appendChild(el('span', null,
          'Loading wallets — ' + done + ' of ' + list.length + ' done'));
        return;
      }
      var ura = new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
      var brez = 0, spx = 0;
      all.forEach(function (w) { w.rows.forEach(function (r) { r.usd == null ? brez++ : spx++; }); });
      stEl.appendChild(el('span', 'st-pika' + (nepopolnih ? ' slabo' : ' dobro'), '●'));
      stEl.appendChild(el('span', null,
        'Balances: Blockscout · Prices: DexScreener, PulseX subgraph as fallback · Updated ' + ura +
        ' · ' + spx + ' priced, ' + brez + ' without price' +
        (nepopolnih ? ' · ' + nepopolnih + ' wallet(s) with an incomplete token list' : '')));
    }

    pisiStanje(false, null);

    Promise.all(list.map(function (a, i) {
      return loadWallet(a).catch(function (e) {
        return { addr: a, rows: [], failed: ['pls', 'eth'], err: String(e && e.message || e) };
      }).then(function (w) {
        var r = renderWallet(w);
        grand += r.total;
        done++;
        if (w.failed && w.failed.length) nepopolnih++;
        mesta[i].appendChild(r.node);
        pisiVsoto(false);
        pisiStanje(false, null);
        return w;
      });
    })).then(function (all) {
      pisiVsoto(true);
      // The total goes into the summary only now: a partial total shown as final is
      // a wrong number that looks right.
      vsotaDenarnic = done ? grand : null;
      denarniceNepopolne = nepopolnih;
      var pb = document.getElementById('wbal-povzetek');
      if (pb) renderPovzetek(pb);
      pisiStanje(true, all);
    }).catch(function (e) {
      totalEl.textContent = '—';
      body.appendChild(el('div', 'wbal-err', 'Could not load balances: ' + (e && e.message || e)));
    }).finally(function () { busy = false; });
  }

  /* ---------- shareable code ---------- */
  // A short code cannot hold the addresses (20 bytes each), so it is only a key
  // and the list lives in code.php on this server, outside public_html.
  // The link form below carries the addresses in the URL fragment, which the
  // browser never sends to any server — no storage involved at all.

  function currentWallets() { return myList(); }

  function showCode(code) {
    var slot = document.getElementById('wbal-code');
    if (!slot) return;
    slot.textContent = '';
    var link = location.origin + location.pathname + '#c=' + code;
    var row = el('div', 'wbal-code-row');
    row.appendChild(el('span', 'wbal-code-lbl', 'Code'));
    var val = el('span', 'wbal-code-val', code);
    row.appendChild(val);
    var copy = el('button', 'wbal-btn', 'Copy link');
    copy.addEventListener('click', function () {
      var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy link'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, function () {});
      else done();
    });
    row.appendChild(copy);
    slot.appendChild(row);
    slot.appendChild(el('div', 'wbal-code-note',
      'Enter this code on any other browser, or open the link. Stored on this site for 180 days, ' +
      'addresses, names and validator numbers only \u2014 no IP address and nothing else is recorded. Anyone holding the code can see the list.'));
  }

  function saveCode() {
    var list = myList();
    var slot = document.getElementById('wbal-code');
    if (!list.length) { if (slot) slot.textContent = 'Add at least one address first.'; return; }
    if (slot) slot.textContent = 'saving\u2026';
    fetch('./code.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addrs: list, val: validatorjev(), names: (function () {
        var m = {}; list.forEach(function (a) { var n = labelFor(a); if (n) m[a.toLowerCase()] = n; }); return m;
      })(), vids: (function () {
        // 22 Nov 2026: validators added by hand (VALIDATOR Screener) travel with the code
        try { var v = JSON.parse(localStorage.getItem('gopulse_val_ids') || '[]'); return Array.isArray(v) ? v : []; }
        catch (e) { return []; }
      })() })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.code) showCode(j.code);
        else if (slot) slot.textContent = 'Could not save: ' + ((j && j.error) || 'unknown error');
      })
      .catch(function (e) { if (slot) slot.textContent = 'Could not save: ' + e.message; });
  }

  function applyAddrs(list, andAnalyze) {
    setMyList(list);
    if (andAnalyze && typeof window.go === 'function') window.go();
    else { busy = false; run(); }
  }

  function fetchCode(code, andAnalyze) {
    var slot = document.getElementById('wbal-code');
    if (slot) slot.textContent = 'loading\u2026';
    return fetch('./code.php?c=' + encodeURIComponent(code))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && Array.isArray(j.addrs) && j.addrs.length) {
          mergeLabels(j.names);
          if (typeof j.val === 'number' && j.val > 0) setValidatorjev(j.val);
          if (Array.isArray(j.vids) && j.vids.length) {
            // merge with the existing ones (nothing is lost); the VALIDATOR Screener picks up the change itself
            try {
              var obst = JSON.parse(localStorage.getItem('gopulse_val_ids') || '[]');
              if (!Array.isArray(obst)) obst = [];
              j.vids.forEach(function (v) { if (typeof v === 'string' && obst.indexOf(v) < 0 && obst.length < 50) obst.push(v); });
              localStorage.setItem('gopulse_val_ids', JSON.stringify(obst));
            } catch (e) {}
          }
          if (slot) slot.textContent = '';
          applyAddrs(j.addrs, andAnalyze);
          return true;
        }
        if (slot) slot.textContent = 'Code not found or expired.';
        return false;
      })
      .catch(function (e) { if (slot) slot.textContent = 'Could not load: ' + e.message; return false; });
  }

  function loadCode() {
    var slot = document.getElementById('wbal-code');
    if (!slot) return;
    if (slot.querySelector('.wbal-input')) { slot.querySelector('.wbal-input').focus(); return; }
    slot.textContent = '';
    var row = el('div', 'wbal-code-row');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'wbal-input';
    inp.placeholder = 'Paste the code, e.g. ABCD234XYZ';
    inp.maxLength = 12;
    inp.autocapitalize = 'characters';
    inp.spellcheck = false;
    var ok = el('button', 'wbal-btn', 'Load');
    var go2 = function () {
      var c = inp.value.trim().toUpperCase();
      if (c) fetchCode(c, true);
    };
    ok.addEventListener('click', go2);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go2(); });
    row.appendChild(inp); row.appendChild(ok);
    slot.appendChild(row);
    inp.focus();
  }

  // On arrival: #c=CODE loads a saved set, #w=addr,addr carries them directly.
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    var m = /(?:^|&)c=([A-Za-z0-9]+)/.exec(h);
    if (m) { section().className = 'on'; fetchCode(m[1].toUpperCase(), true); return; }
    var w = /(?:^|&)w=([0-9a-fA-Fx,]+)/.exec(h);
    if (w) {
      var list = w[1].split(',').filter(function (a) { return /^0x[0-9a-fA-F]{40}$/.test(a); });
      if (list.length) { section().className = 'on'; applyAddrs(list, true); }
    }
  }

  /* ---------- hook ---------- */
  // Wrap the analyzer's go() instead of editing it, so app.js stays untouched.
  function hook() {
    if (typeof window.go !== 'function' || window.go.__wbalWrapped) return false;
    var orig = window.go;
    var wrapped = function () {
      var r;
      try { r = orig.apply(this, arguments); } finally {
        // Anything typed into the analyzer's own field joins our list too,
        // so the two never silently disagree about which wallets exist.
        var after = function () {
          try {
            if (typeof wallets !== 'undefined' && Array.isArray(wallets)) {
              var mine = myList();
              var add = wallets.filter(function (a) { return mine.indexOf(a.toLowerCase()) < 0; });
              if (add.length) setMyList(mine.concat(add));
            }
          } catch (e) {}
          busy = false; run();
          // the analyzer's cards exist only after it has rendered
          setTimeout(function () {
            var b = document.getElementById('wbal-povzetek');
            if (b) renderPovzetek(b);
          }, 1500);
        };
        Promise.resolve(r).then(after, after);
      }
      return r;
    };
    wrapped.__wbalWrapped = true;
    window.go = wrapped;
    return true;
  }

  if (!hook()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (hook() || ++tries > 40) clearInterval(iv);
    }, 250);
  }

  /* ---------- automatic analysis on load ----------
     Why it exists: the cards at the top are NOT their own source - they are mirrored from the
     analyzer's cards (zrcaliKartico reads #dash .card), and those only appear once
     go() runs. So after a reload the wallet list was full, but the top
     said "available after you run Analyze" until someone clicked Analyze.

     go() is not cheap (RPC + price APIs), so it runs ONLY when
        saved addresses already exist - never on an empty page.
     With #c= or #w= in the address we do NOT do this: there readHash() starts the analysis
        via applyAddrs(..., true). Two runs would be double work against the same
        APIs and two renders over the same card.
     We wait for the WRAPPED go() (__wbalWrapped), not the raw one: the wrapper is what
        refreshes the summary at the top after the analysis. Calling the raw one would run the analysis
        but leave the cards at the top empty - exactly the bug being fixed.
     If the wrapper does not arrive, this is NOT kept quiet: the reason goes to the console. A silent nothing
        looks the same as "there simply is no data". */
  function samodejnaAnaliza() {
    var poskusov = 0;
    (function cakaj() {
      if (typeof window.go === 'function' && window.go.__wbalWrapped) {
        // go() is `async`. An exception inside it does NOT reach try/catch but
        //    a rejected promise - the wrapper (`Promise.resolve(r).then(after, after)`)
        //    settles it, so a failure would stay completely silent. So we catch both
        //    paths and print the reason; a silent nothing looks the same as "no data".
        try {
          Promise.resolve(window.go()).catch(function (e) {
            console.warn('StakeScreener: automatic analysis failed —', (e && e.message) || e);
          });
        } catch (e) {
          console.warn('StakeScreener: automatic analysis could not be started —', e && e.message);
        }
        // Refreshing the summary is NOT left to the wrapper around go(). Measured
        //    21 Sep 2026: after the automatic start there were 8 cards with real
        //    values, but the top still said "available after you run
        //    Analyze" - the work in the wrapper (`after`) did not run. So here we wait
        //    ourselves until the value arrives, and then run run(), which
        //    demonstrably fills the summary.
        // Limited to 90 seconds: an endless loop would also run when
        //    the analysis fails, and would redraw the same thing every second for nothing.
        // Do NOT stop at the FIRST value. Measured 21 Sep 2026: the analysis
        //    finishes PulseChain first and only then Ethereum (that one struggles with the
        //    explorer, HTTP 429 seen). The first version rendered right at the
        //    first value and showed **$7,632 instead of ~$10K** - only pHEX,
        //    without eHEX, yet it looked complete. An incomplete total that looks
        //    complete is worse than an empty field.
        // So: redraw on every CHANGE of the value until it settles, and
        //    stop after 90 s - an endless loop would redraw the same even when the analysis has failed.
        (function slediVrednosti() {
          var poskusov = 0, zadnja = null;
          (function tik() {
            var d = zrcaliKartico('Stake Value');
            var v = (d && d.val) || null;
            if (v && v !== zadnja) { zadnja = v; busy = false; run(); }
            if (++poskusov > 30) {                 // 30 x 3 s = 90 s
              if (!zadnja) console.warn('StakeScreener: analysis gave no value within 90 s — the summary stays empty');
              return;
            }
            setTimeout(tik, 3000);
          })();
        })();
        return;
      }
      if (++poskusov > 40) {          // 40 x 250 ms = 10 s, same as the wrapper itself
        console.warn('StakeScreener: automatic analysis could not be started ' +
                     '(go() is not wrapped) — click Analyze');
        return;
      }
      setTimeout(cakaj, 250);
    })();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', function () { setTimeout(readHash, 400); });
  else setTimeout(readHash, 400);

  setTimeout(function () {
    try {
      if (!myList().length && typeof wallets !== 'undefined' && wallets.length) setMyList(wallets);
      // Always hand the analyzer its share on load, otherwise the saved list
      // shows cards here while its own chip row up top stays empty.
      else if (myList().length) mirror(myList());
    } catch (e) {}
    if (!/[#&]c=|[#&]w=/.test(location.hash)) {
      if (myList().length) { run(); samodejnaAnaliza(); }
      else idleBar();
    }
  }, 700);

  window.wbalRun = run;   // manual re-run from the console if ever needed
})();
