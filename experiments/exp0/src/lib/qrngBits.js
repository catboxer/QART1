// qrngBits.js
import { getQuantumPairOrThrow } from '../qrngClient'; // or export it from MainApp file

let pool = []; // array of 0/1

export async function getBit() {
  if (pool.length === 0) await refill();
  return pool.shift();
}

export async function getBits(n) {
  const out = [];
  while (out.length < n) out.push(await getBit());
  return out;
}
// NEW: cryptographic (non-QRNG) salt — zero cost
export function getSaltHexCrypto(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
}

export async function getSaltHex(bytes = 16) {
  // pull 8*bytes bits
  const need = bytes * 8;
  const bits = await getBits(need);
  // pack 8 bits → 1 byte
  const arr = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    arr.push(b);
  }
  return arr.map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function refill() {
  // Your endpoint returns TWO BYTES per call (primary+ghost)
  const { bytes } = await getQuantumPairOrThrow();
  for (const B of bytes) {
    for (let i = 7; i >= 0; i--) pool.push((B >> i) & 1);
  }
}
