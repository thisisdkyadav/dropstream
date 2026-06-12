// Incremental SHA-256 (FIPS 180-4), dependency-free and streaming so we can
// hash multi-GB transfers chunk by chunk without holding them in memory.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export class Sha256 {
  constructor() {
    this.h = new Int32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    this.w = new Uint32Array(64);
    this.block = new Uint8Array(64);
    this.blockLen = 0;
    this.totalBytes = 0;
    this.done = false;
  }

  update(data) {
    if (typeof data === "string") {
      data = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }

    this.totalBytes += data.length;
    let i = 0;
    while (i < data.length) {
      const take = Math.min(64 - this.blockLen, data.length - i);
      this.block.set(data.subarray(i, i + take), this.blockLen);
      this.blockLen += take;
      i += take;
      if (this.blockLen === 64) {
        this._compress(this.block);
        this.blockLen = 0;
      }
    }
    return this;
  }

  _compress(p) {
    const w = this.w;
    for (let t = 0; t < 16; t += 1) {
      w[t] = (p[t * 4] << 24) | (p[t * 4 + 1] << 16) | (p[t * 4 + 2] << 8) | p[t * 4 + 3];
    }
    for (let t = 16; t < 64; t += 1) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    const H = this.h;
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  digestHex() {
    if (this.done) {
      throw new Error("digest already finalized");
    }
    const bits = this.totalBytes * 8;

    this.update(PAD_BYTE);
    const padZeros = (this.blockLen <= 56 ? 56 : 120) - this.blockLen;
    if (padZeros > 0) {
      this.update(new Uint8Array(padZeros));
    }

    const lenBytes = new Uint8Array(8);
    const view = new DataView(lenBytes.buffer);
    view.setUint32(0, Math.floor(bits / 4294967296));
    view.setUint32(4, bits % 4294967296);
    this.update(lenBytes);

    this.done = true;
    let hex = "";
    for (let i = 0; i < 8; i += 1) {
      hex += (this.h[i] >>> 0).toString(16).padStart(8, "0");
    }
    return hex;
  }
}

const PAD_BYTE = new Uint8Array([0x80]);

export function sha256Hex(data) {
  return new Sha256().update(data).digestHex();
}
