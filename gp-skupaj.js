/* gp-skupaj.js — kartica "Total HEX" nad karticami povzetka (StakeScreener, 31. 10. 2026)
 *
 * app.js (izvorni HEX Stake Analyzer, GPL-3.0) ostane nespremenjen. Ta skripta ovije
 * globalno funkcijo renderAll(stakes, liquidByChain): po vsakem izrisu iz istih podatkov
 * sesteje glavnico, nabrani donos (z Big Pay Day, kot stolpec Yield) in HEX v denarnici,
 * LOCENO po verigah (pHEX in eHEX sta razlicni sredstvi). Upostevata se izbran pogled
 * (denarnica, veriga) in Moon Math, ker so to ze argumenti renderAll oz. priceFor().
 * Vrnitev: odstrani <script src="./gp-skupaj.js"> iz index.html.
 */
(function () {
  if (typeof renderAll !== 'function') return;
  var izvirnik = renderAll;

  function hex(h) { return (Number(h) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function usd(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function izracun(stakes, liq) {
    var v = {
      pls: { gl: 0n, don: 0n, den: 0n },
      eth: { gl: 0n, don: 0n, den: 0n }
    };
    (stakes || []).forEach(function (s) {
      var st = sst(s);
      if (st === 'ended') return;
      var ch = s.chain === 'eth' ? 'eth' : 'pls';
      v[ch].gl += s.stakedHearts || 0n;
      if (st !== 'pending') v[ch].don += yhDisplay(s) || 0n;
    });
    liq = liq || {};
    v.pls.den = liq.pls || 0n;
    v.eth.den = liq.eth || 0n;
    v.most = liq.bridgedEhex || 0n;   // eHEX, premosten na PulseChain
    return v;
  }

  function stolpec(ime, cls, d, cena, dodatek) {
    var skupaj = d.gl + d.don + d.den + (dodatek || 0n);
    if (skupaj === 0n) return '';
    var u = cena > 0 ? Number(skupaj) / 1e8 * cena : 0;
    return '<div class="gp-sk-ver ' + cls + '">' +
      '<div class="gp-sk-ime">' + ime + '</div>' +
      '<div class="gp-sk-val">' + hex(skupaj) + ' <span>HEX</span></div>' +
      (u > 0 ? '<div class="gp-sk-usd">' + usd(u) + '</div>' : '') +
      '<div class="gp-sk-vrst"><span>Staked principal</span><b>' + hex(d.gl) + '</b></div>' +
      '<div class="gp-sk-vrst"><span>Accrued yield</span><b>' + hex(d.don) + '</b></div>' +
      '<div class="gp-sk-vrst"><span>In wallet</span><b>' + hex(d.den) + '</b></div>' +
      (dodatek ? '<div class="gp-sk-vrst"><span>eHEX on PulseChain</span><b>' + hex(dodatek) + '</b></div>' : '') +
      '</div>';
  }

  function izrisi(stakes, liq) {
    var okvir = document.getElementById('cards-frame');
    var kartice = document.getElementById('cards');
    if (!okvir || !kartice) return;
    var el = document.getElementById('gp-skupaj');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gp-skupaj';
      okvir.insertBefore(el, kartice);
    }
    var v = izracun(stakes, liq);
    var p = stolpec('pHEX', 'pls', v.pls, priceFor('pls'));
    var e = stolpec('eHEX', 'eth', v.eth, priceFor('eth'), v.most);
    if (!p && !e) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="gp-sk-lbl">Total HEX</div><div class="gp-sk-mreza">' + p + e + '</div>' +
      '<div class="gp-sk-opomba">Principal and yield of active and pending stakes plus HEX in the wallet, per chain. ' +
      'Accrued yield is paid out when a stake ends; ending a stake early carries a penalty.</div>';
  }

  /* --- stolpec Total HEX v tabelah stakov (glavnica + donos, enako kot osnova za Value) --- */
  function polno(h) { return (Number(h) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  if (typeof buildTableHeader === 'function') {
    var izvGlava = buildTableHeader;
    buildTableHeader = function () {
      var r = izvGlava.apply(this, arguments);
      try {
        return r.replace(/<th class="[^"]*" onclick="setSort(?:Active|Ended)\('apy'\)"/,
          '<th class="gp-tot-th" title="Principal + yield (incl. Big Pay Day) of this stake, in HEX">Total HEX</th>$&');
      } catch (n) { return r; }
    };
  }
  if (typeof mkRow === 'function') {
    var izvVrsta = mkRow;
    mkRow = function (st) {
      var r = izvVrsta.apply(this, arguments);
      try {
        var t = (st.stakedHearts || 0n) + (yhDisplay(st) || 0n);
        return r.replace('<td class="r-apy">', '<td class="r-tot" title="' + polno(t) + ' HEX">' + fh(t) + '</td><td class="r-apy">');
      } catch (n) { return r; }
    };
  }
  if (typeof buildStakeTable === 'function') {
    var izvTabela = buildStakeTable;
    buildStakeTable = function (stakes) {
      var r = izvTabela.apply(this, arguments);
      try {
        var t = 0n;
        (stakes || []).forEach(function (st) { t += (st.stakedHearts || 0n) + (yhDisplay(st) || 0n); });
        var apy = '<td class="tf-val"><span class="tf-sub">Avg APY</span>';
        return r.replace(apy, '<td class="tf-tot" title="' + polno(t) + ' HEX"><span class="tf-sub">Total HEX</span>' + fh(t) + '</td>' + apy);
      } catch (n) { return r; }
    };
  }

  renderAll = function (stakes, liquidByChain) {
    var r = izvirnik.apply(this, arguments);
    try { izrisi(stakes, liquidByChain); } catch (napaka) { /* prikaz ostane kot v izvirniku */ }
    return r;
  };
})();
