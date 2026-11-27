# StakeScreener

**[stakescreener.com](https://stakescreener.com)** — a free, read-only dashboard for PulseChain and Ethereum:
wallets, HEX stakes, validators, Communis (COM), Hedron (HDRN), Icosa (ICSA) and WAATSA.

- **Read-only.** It never connects to a wallet and never asks you to sign anything.
  (The separate Safe Manager below is the only part that can, on its own address.)
- **No accounts, no tracking.** Addresses you add are kept in your own browser (localStorage).
  Only if you press *Save as code* is the list stored on the server under a random code (deleted after 180 days).
- Prices and balances come from public sources (block explorers, public RPC and beacon nodes, DexScreener,
  CoinGecko, PulseX subgraph). Informational only, not financial advice.

## This repository = the live site

This repository contains **exactly the files that stakescreener.com serves**, plus their SHA-256 fingerprints:

- `SHA256SUMS.txt` — one line per file: `sha256  path`
- `sums.json` — the same, used by the **Verify now** button on <https://stakescreener.com/info.html#verify>

The fingerprints are updated every time the site is published. Because this record does not live on the
site's server, it lets anyone check that the site has not been altered — for example that the support
address is the published one.

### Verify it yourself

```sh
curl -s https://stakescreener.com/info.html | sha256sum
grep ' info.html$' SHA256SUMS.txt
```

The two fingerprints must be identical. The same works for any file listed in `SHA256SUMS.txt`
(server-side files `.htaccess` and `code.php` are published for transparency but cannot be downloaded from the site).

## Safe Manager — safe.stakescreener.com

**[safe.stakescreener.com](https://safe.stakescreener.com)** manages HEX stakes held in a Safe contract
(Staker app smart accounts and any Safe with a threshold of 1): end stakes, mint HDRN and COM, send funds out.

- It has **its own origin**, so a wallet connected there is never connected to stakescreener.com.
- It uses only the wallet injected in your browser, and only after you click *Connect wallet*.
- Every action is wrapped in the Safe's `execTransaction`, simulated with `eth_call` first and sent only
  after you confirm it in your own wallet.
- Strict CSP: no third-party scripts; network access only to four public RPC endpoints.
- Its files are in the folder `safe.stakescreener.com/` of this repository and are listed in `SHA256SUMS.txt`
  (`sums.json`: `safe_served`). Check them the same way:

```sh
curl -s https://safe.stakescreener.com/safe.js | sha256sum
grep ' safe.stakescreener.com/safe.js$' SHA256SUMS.txt
```

Not affiliated with Staker app or Safe.

## Support

StakeScreener is free. Voluntary contributions (PulseChain / Ethereum):

`0x0D6A5f27CBb65f5452676e94c92E3823BBDb6338`

Check it here and on <https://stakescreener.com/info.html#support> — they must match.
A contribution is not an investment and gives no rights or benefits.

Some links on the site are referral links (Allnodes, Vouch); see the Disclaimer on the site.

## License and credits

StakeScreener is based on **[HEX Stake Analyzer](https://github.com/hexstakeanalyzer/Hex-Stake-Analyzer)**
© 2026 HexStakeAnalyzer, licensed under **GPL-3.0** (see `LICENSE`). `app.js` is the original analyzer, unchanged;
all additions are separate files and every change is listed in `MODIFICATIONS.txt`. Third-party notices:
`THIRD-PARTY-NOTICES.txt`, `vendor/CHARTJS-LICENSE.md`, `fonts/*-OFL.txt`.

Contact: info@stakescreener.com
