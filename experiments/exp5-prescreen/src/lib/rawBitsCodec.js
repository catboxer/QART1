// Pack an array-of-arrays of 0|1 bits into a base64 string.
// bits[blockIdx][trialIdx] → sequentially packed, MSB first.
export function packBitsToBase64(bitsPerBlock) {
  const totalBits = bitsPerBlock.reduce((s, b) => s + b.length, 0);
  const nBytes = Math.ceil(totalBits / 8);
  const bytes = new Uint8Array(nBytes);
  let globalBit = 0;
  for (const block of bitsPerBlock) {
    for (const bit of block) {
      bytes[Math.floor(globalBit / 8)] |=
        bit << (7 - (globalBit % 8));
      globalBit++;
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Unpack a base64 string into blockCount arrays of bitsPerBlock bits each.
export function unpackBitsFromBase64(b64, blockCount, bitsPerBlock) {
  if (!b64 || blockCount === 0) return [];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  const result = [];
  let globalBit = 0;
  for (let s = 0; s < blockCount; s++) {
    const block = [];
    for (let b = 0; b < bitsPerBlock; b++) {
      block.push(
        (bytes[Math.floor(globalBit / 8)] >> (7 - (globalBit % 8))) &
          1,
      );
      globalBit++;
    }
    result.push(block);
  }
  return result;
}
