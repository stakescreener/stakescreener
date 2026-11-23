<?php
/* code.php — short shareable codes for a set of wallet addresses.
 *
 * A seven-character code cannot contain the data: one address is 20 bytes,
 * so five addresses are 100 bytes. The code can only ever be a KEY, and the
 * data has to live on the server. That is what GoPulse did and it is the only
 * way this feature can work.
 *
 * What is stored: nothing but the addresses themselves. No IP, no user agent,
 * no timestamp beyond what expiry needs. Files live OUTSIDE public_html and
 * are deleted after EXPIRY_DAYS.
 *
 *   POST {"addrs":[…],"names":{"0x…":"S/1 Hex Stakes"},"val":3,"vids":["5099","0x…"]}  ->  {"code":"ABCD234XYZ"}
 *   GET  ?c=ABCD234XYZ    ->  {"addrs":[…],"names":{…}}
 *
 * Names are free text chosen by the user, so they are length-capped and
 * stripped of control characters before being written.
 */

declare(strict_types=1);

const STORE       = __DIR__ . '/../gopulse-kode';
const EXPIRY_DAYS = 180;
const MAX_ADDRS   = 30;   // matches MAX_WALLETS in wallets.js
const MAX_NAME    = 40;
const CODE_LEN    = 10;                            // 32^10 ≈ 1.1e15 combinations
const ALPHABET    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I, O, 0, 1

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function bail(int $status, string $msg): never {
    http_response_code($status);
    echo json_encode(['error' => $msg], JSON_UNESCAPED_SLASHES);
    exit;
}

function store_dir(): string {
    if (!is_dir(STORE)) {
        if (!@mkdir(STORE, 0700, true) && !is_dir(STORE)) bail(500, 'store unavailable');
    }
    return STORE;
}

/* Delete expired files. Runs rarely so it costs nothing on a normal request. */
function sweep(string $dir): void {
    if (random_int(1, 50) !== 1) return;
    $cutoff = time() - EXPIRY_DAYS * 86400;
    foreach (glob($dir . '/*.json') ?: [] as $f) {
        if (@filemtime($f) < $cutoff) @unlink($f);
    }
}

function valid_code(string $c): bool {
    return (bool) preg_match('/^[' . ALPHABET . ']{' . CODE_LEN . '}$/', $c);
}

$dir = store_dir();
sweep($dir);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input', false, null, 0, 16384);   // 22. 11.: tudi javni kljuci validatorjev
    $in  = json_decode((string) $raw, true);
    if (!is_array($in) || !isset($in['addrs']) || !is_array($in['addrs'])) bail(400, 'bad request');

    $addrs = [];
    foreach ($in['addrs'] as $a) {
        if (!is_string($a) || !preg_match('/^0x[0-9a-fA-F]{40}$/', $a)) continue;
        $a = strtolower($a);
        if (!in_array($a, $addrs, true)) $addrs[] = $a;
        if (count($addrs) >= MAX_ADDRS) break;
    }
    if (!$addrs) bail(400, 'no valid addresses');

    $names = [];
    if (isset($in['names']) && is_array($in['names'])) {
        foreach ($in['names'] as $k => $v) {
            if (!is_string($k) || !is_string($v)) continue;
            $k = strtolower($k);
            if (!in_array($k, $addrs, true)) continue;
            $v = preg_replace('/[\x00-\x1F\x7F]/u', '', $v);
            $v = trim(mb_substr($v, 0, MAX_NAME));
            if ($v !== '') $names[$k] = $v;
        }
    }

    /* Same set of addresses -> same code, so repeated saves do not litter. */
    // stevilo validatorjev — potuje s kodo, da je vsota enaka v vseh brskalnikih
    $val = 0;
    if (isset($in['val']) && is_numeric($in['val'])) $val = max(0, min(9999, (int) $in['val']));
    // 22. 11. 2026: rocno dodani validatorji (stevilka ali javni kljuc) iz VALIDATOR Screenerja
    $vids = [];
    if (isset($in['vids']) && is_array($in['vids'])) {
        foreach ($in['vids'] as $v) {
            if (!is_string($v)) continue;
            $v = strtolower(trim($v));
            if (!preg_match('/^(\d{1,8}|0x[0-9a-f]{96})$/', $v)) continue;
            if (!in_array($v, $vids, true)) $vids[] = $v;
            if (count($vids) >= 50) break;
        }
    }

    ksort($names);
    $fingerprint = hash('sha256', implode(',', $addrs) . '|' . json_encode($names) . '|' . $val . ($vids ? '|' . implode(',', $vids) : ''));
    foreach (glob($dir . '/*.json') ?: [] as $f) {
        $d = json_decode((string) @file_get_contents($f), true);
        if (is_array($d) && ($d['fp'] ?? null) === $fingerprint) {
            @touch($f);
            echo json_encode(['code' => basename($f, '.json')]);
            exit;
        }
    }

    $alpha = ALPHABET;
    $n     = strlen($alpha);
    for ($try = 0; $try < 8; $try++) {
        $code = '';
        for ($i = 0; $i < CODE_LEN; $i++) $code .= $alpha[random_int(0, $n - 1)];
        $path = $dir . '/' . $code . '.json';
        if (file_exists($path)) continue;
        $ok = @file_put_contents(
            $path,
            json_encode(['addrs' => $addrs, 'names' => $names, 'val' => $val, 'vids' => $vids, 'fp' => $fingerprint]),
            LOCK_EX
        );
        if ($ok === false) bail(500, 'could not save');
        @chmod($path, 0600);
        echo json_encode(['code' => $code]);
        exit;
    }
    bail(500, 'could not allocate a code');
}

$code = strtoupper(trim((string) ($_GET['c'] ?? '')));
if (!valid_code($code)) bail(400, 'bad code');

$path = $dir . '/' . $code . '.json';
if (!is_file($path)) bail(404, 'unknown code');
if (@filemtime($path) < time() - EXPIRY_DAYS * 86400) { @unlink($path); bail(404, 'expired'); }

$d = json_decode((string) @file_get_contents($path), true);
if (!is_array($d) || !isset($d['addrs'])) bail(500, 'unreadable');

@touch($path);   // used = kept alive
echo json_encode(['addrs' => $d['addrs'], 'names' => $d['names'] ?? new stdClass(), 'val' => $d['val'] ?? 0, 'vids' => $d['vids'] ?? []]);
