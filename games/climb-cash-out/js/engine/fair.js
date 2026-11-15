// Provably fair dice.
// Roll i of round `nonce` = first usable byte of HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${i}:${j}`),
// reading bytes in order and keeping only bytes < 252 (252 = 42 × 6), so each face is exactly 1/6.
// The server seed's SHA-256 hash is shown before play; the seed itself is revealed when rotated.
//
// NOTE: in this play-money build the "server" seed is generated in the player's browser.
// A real-money build must generate and hold it on the server (GAME_DESIGN.md §9.3).

const enc = new TextEncoder();

export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return toHex(new Uint8Array(buf));
}

async function hmac(key, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

/** Die roll (1–6) number i (0-based) of a round. */
export async function rollAt(serverSeed, clientSeed, nonce, i) {
  for (let j = 0; j < 1000; j++) {
    const bytes = await hmac(serverSeed, `${clientSeed}:${nonce}:${i}:${j}`);
    for (const b of bytes) if (b < 252) return (b % 6) + 1;
  }
  throw new Error('Could not derive a roll');
}

export async function rollsFor(serverSeed, clientSeed, nonce, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(await rollAt(serverSeed, clientSeed, nonce, i));
  return out;
}

export async function newSeedPair(clientSeed) {
  const serverSeed = randomHex(32);
  return { serverSeed, serverHash: await sha256Hex(serverSeed), clientSeed: clientSeed || randomHex(8), nonce: 0 };
}

function toHex(bytes) {
  return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
}
