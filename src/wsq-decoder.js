/**
 * Pure JavaScript WSQ (Wavelet Scalar Quantization) Decoder
 *
 * Ported from JNBIS (Java NIST Biometric Image Software)
 * Original: https://github.com/mhshams/jnbis (Apache 2.0 License)
 *
 * WSQ is a lossy compression algorithm for grayscale fingerprint images,
 * standardized by the FBI (IAFIS-IC-0110). It uses a CDF 9/7 biorthogonal
 * wavelet with 3 levels of decomposition (64 subbands), scalar quantization,
 * and Huffman coding.
 */

import { WsqDecodeError } from './errors.js';

// ---- Constants ----

const BITMASK = [0x00, 0x01, 0x03, 0x07, 0x0f, 0x1f, 0x3f, 0x7f, 0xff];

const MAX_DHT_TABLES = 8;
const MAX_HUFFBITS = 16;
const MAX_HUFFCOUNTS_WSQ = 256;

const W_TREELEN = 20;
const Q_TREELEN = 64;

const SOI_WSQ = 0xffa0;
const EOI_WSQ = 0xffa1;
const SOF_WSQ = 0xffa2;
const SOB_WSQ = 0xffa3;
const DTT_WSQ = 0xffa4;
const DQT_WSQ = 0xffa5;
const DHT_WSQ = 0xffa6;
const COM_WSQ = 0xffa8;

const MAX_SUBBANDS = 64;
const NUM_SUBBANDS = 60;

const TBLS_N_SOF = 2;
const TBLS_N_SOB = TBLS_N_SOF + 2;

// ---- Token (state) class ----

/** Stateful reader for WSQ binary data with decode tables. */
class Token {
  constructor(buffer) {
    this.buffer = buffer;
    this.pointer = 0;
    this.tableDTT = null;
    this.tableDQT = null;
    this.tableDHT = null;
    this.wtree = null;
    this.qtree = null;
  }

  initialize() {
    this.tableDTT = { lofilt: null, hifilt: null, losz: 0, hisz: 0, lodef: 0, hidef: 0 };
    this.tableDQT = { binCenter: 0, qBin: new Float32Array(MAX_SUBBANDS), zBin: new Float32Array(MAX_SUBBANDS), dqtDef: 0 };
    this.tableDHT = [];
    for (let i = 0; i < MAX_DHT_TABLES; i++) {
      this.tableDHT.push({
        tabdef: 0,
        huffbits: new Int32Array(MAX_HUFFBITS),
        huffvalues: new Int32Array(MAX_HUFFCOUNTS_WSQ + 1),
      });
    }
  }

  readInt() {
    if (this.pointer + 4 > this.buffer.length) {
      throw new WsqDecodeError('WSQ: Unexpected end of data', { offset: this.pointer });
    }
    const b0 = this.buffer[this.pointer++];
    const b1 = this.buffer[this.pointer++];
    const b2 = this.buffer[this.pointer++];
    const b3 = this.buffer[this.pointer++];
    // Must return unsigned (Java uses long). >>> 0 converts to uint32.
    return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
  }

  readShort() {
    if (this.pointer + 2 > this.buffer.length) {
      throw new WsqDecodeError('WSQ: Unexpected end of data', { offset: this.pointer });
    }
    const b0 = this.buffer[this.pointer++];
    const b1 = this.buffer[this.pointer++];
    return (b0 << 8) | b1;
  }

  readByte() {
    if (this.pointer >= this.buffer.length) {
      throw new WsqDecodeError('WSQ: Unexpected end of data', { offset: this.pointer });
    }
    return this.buffer[this.pointer++];
  }

  readBytes(size) {
    if (this.pointer + size > this.buffer.length) {
      throw new WsqDecodeError('WSQ: Unexpected end of data', { offset: this.pointer });
    }
    const bytes = this.buffer.slice(this.pointer, this.pointer + size);
    this.pointer += size;
    return bytes;
  }
}

// ---- Main decoder ----

/**
 * Decode WSQ compressed image data.
 * @param {Buffer|Uint8Array} data - WSQ compressed data
 * @returns {{ width: number, height: number, pixels: Uint8Array }}
 */
export function decodeWsq(data) {
  const token = new Token(data instanceof Uint8Array ? data : new Uint8Array(data));
  token.initialize();

  // Read SOI marker
  getCMarkerWSQ(token, SOI_WSQ);

  // Read tables until SOF
  let marker = getCMarkerWSQ(token, TBLS_N_SOF);
  while (marker !== SOF_WSQ) {
    getCTableWSQ(token, marker);
    marker = getCMarkerWSQ(token, TBLS_N_SOF);
  }

  // Read frame header
  const header = getCFrameHeaderWSQ(token);
  const width = header.width;
  const height = header.height;

  // Build wavelet and quantization trees
  buildWSQTrees(token, width, height);

  // Huffman decode all subbands
  const qdata = huffmanDecodeDataMem(token, width * height);

  // Unquantize
  const fdata = unquantize(token, qdata, width, height);

  // Wavelet reconstruction
  wsqReconstruct(token, fdata, width, height);

  // Convert float to byte pixels
  const pixels = convertImageToByte(fdata, width, height, header.mShift, header.rScale);

  return { width, height, pixels };
}

// ---- Marker reading ----

function getCMarkerWSQ(token, type) {
  const marker = token.readShort();

  switch (type) {
    case SOI_WSQ:
      if (marker !== SOI_WSQ) {
        throw new WsqDecodeError(`WSQ: No SOI marker: 0x${marker.toString(16)}`, { offset: token.pointer });
      }
      return marker;

    case TBLS_N_SOF:
      if (marker !== DTT_WSQ && marker !== DQT_WSQ && marker !== DHT_WSQ &&
          marker !== SOF_WSQ && marker !== COM_WSQ && marker !== EOI_WSQ) {
        throw new WsqDecodeError(`WSQ: No SOF, Table, or comment marker: 0x${marker.toString(16)}`, { offset: token.pointer });
      }
      return marker;

    case TBLS_N_SOB:
      if (marker !== DTT_WSQ && marker !== DQT_WSQ && marker !== DHT_WSQ &&
          marker !== SOB_WSQ && marker !== COM_WSQ && marker !== EOI_WSQ) {
        throw new WsqDecodeError(`WSQ: No SOB, Table, or comment marker: 0x${marker.toString(16)}`, { offset: token.pointer });
      }
      return marker;

    default:
      return marker;
  }
}

// ---- Table dispatch ----

function getCTableWSQ(token, marker) {
  switch (marker) {
    case DTT_WSQ: getCTransformTable(token); return;
    case DQT_WSQ: getCQuantizationTable(token); return;
    case DHT_WSQ: getCHuffmanTableWSQ(token); return;
    case COM_WSQ: getCComment(token); return;
    default: throw new WsqDecodeError(`WSQ: Invalid table marker: 0x${marker.toString(16)}`, { offset: token.pointer });
  }
}

// ---- Helper: intSign ----

function intSign(power) {
  return (power % 2 === 0) ? 1 : -1;
}

// ---- Transform table (DTT) ----

function getCTransformTable(token) {
  token.readShort(); // header size

  token.tableDTT.hisz = token.readByte();
  token.tableDTT.losz = token.readByte();

  token.tableDTT.hifilt = new Float32Array(token.tableDTT.hisz);
  token.tableDTT.lofilt = new Float32Array(token.tableDTT.losz);

  // Read hi-pass filter unique coefficients and mirror
  let aSize;
  if (token.tableDTT.hisz % 2 !== 0) {
    aSize = ((token.tableDTT.hisz + 1) / 2) | 0;
  } else {
    aSize = (token.tableDTT.hisz / 2) | 0;
  }

  const aLofilt = new Float32Array(aSize);

  aSize--;
  for (let cnt = 0; cnt <= aSize; cnt++) {
    const sign = token.readByte();
    let scale = token.readByte();
    const shrtDat = token.readInt();
    aLofilt[cnt] = shrtDat;

    while (scale > 0) {
      aLofilt[cnt] /= 10.0;
      scale--;
    }

    if (sign !== 0) {
      aLofilt[cnt] *= -1.0;
    }

    if (token.tableDTT.hisz % 2 !== 0) {
      token.tableDTT.hifilt[cnt + aSize] = intSign(cnt) * aLofilt[cnt];
      if (cnt > 0) {
        token.tableDTT.hifilt[aSize - cnt] = token.tableDTT.hifilt[cnt + aSize];
      }
    } else {
      token.tableDTT.hifilt[cnt + aSize + 1] = intSign(cnt) * aLofilt[cnt];
      token.tableDTT.hifilt[aSize - cnt] = -1 * token.tableDTT.hifilt[cnt + aSize + 1];
    }
  }

  // Read lo-pass filter unique coefficients and mirror
  if (token.tableDTT.losz % 2 !== 0) {
    aSize = ((token.tableDTT.losz + 1) / 2) | 0;
  } else {
    aSize = (token.tableDTT.losz / 2) | 0;
  }

  const aHifilt = new Float32Array(aSize);

  aSize--;
  for (let cnt = 0; cnt <= aSize; cnt++) {
    const sign = token.readByte();
    let scale = token.readByte();
    const shrtDat = token.readInt();
    aHifilt[cnt] = shrtDat;

    while (scale > 0) {
      aHifilt[cnt] /= 10.0;
      scale--;
    }

    if (sign !== 0) {
      aHifilt[cnt] *= -1.0;
    }

    if (token.tableDTT.losz % 2 !== 0) {
      token.tableDTT.lofilt[cnt + aSize] = intSign(cnt) * aHifilt[cnt];
      if (cnt > 0) {
        token.tableDTT.lofilt[aSize - cnt] = token.tableDTT.lofilt[cnt + aSize];
      }
    } else {
      token.tableDTT.lofilt[cnt + aSize + 1] = intSign(cnt + 1) * aHifilt[cnt];
      token.tableDTT.lofilt[aSize - cnt] = token.tableDTT.lofilt[cnt + aSize + 1];
    }
  }

  token.tableDTT.lodef = 1;
  token.tableDTT.hidef = 1;
}

// ---- Quantization table (DQT) ----

function getCQuantizationTable(token) {
  token.readShort(); // header size

  let scale = token.readByte();
  let shrtDat = token.readShort();
  token.tableDQT.binCenter = shrtDat;
  while (scale > 0) {
    token.tableDQT.binCenter /= 10.0;
    scale--;
  }

  for (let cnt = 0; cnt < MAX_SUBBANDS; cnt++) {
    scale = token.readByte();
    shrtDat = token.readShort();
    token.tableDQT.qBin[cnt] = shrtDat;
    while (scale > 0) {
      token.tableDQT.qBin[cnt] /= 10.0;
      scale--;
    }

    scale = token.readByte();
    shrtDat = token.readShort();
    token.tableDQT.zBin[cnt] = shrtDat;
    while (scale > 0) {
      token.tableDQT.zBin[cnt] /= 10.0;
      scale--;
    }
  }

  token.tableDQT.dqtDef = 1;
}

// ---- Huffman table (DHT) ----

function getCHuffmanTableWSQ(token) {
  const result = getCHuffmanTable(token, MAX_HUFFCOUNTS_WSQ, 0, true);

  let tableId = result.tableId;
  token.tableDHT[tableId].huffbits = result.huffbits.slice();
  token.tableDHT[tableId].huffvalues = result.huffvalues.slice();
  token.tableDHT[tableId].tabdef = 1;

  let bytesLeft = result.bytesLeft;
  while (bytesLeft !== 0) {
    const next = getCHuffmanTable(token, MAX_HUFFCOUNTS_WSQ, bytesLeft, false);
    tableId = next.tableId;
    token.tableDHT[tableId].huffbits = next.huffbits.slice();
    token.tableDHT[tableId].huffvalues = next.huffvalues.slice();
    token.tableDHT[tableId].tabdef = 1;
    bytesLeft = next.bytesLeft;
  }
}

function getCHuffmanTable(token, maxHuffcounts, bytesLeftIn, readTableLen) {
  const huffbits = new Int32Array(MAX_HUFFBITS);
  const huffvalues = new Int32Array(maxHuffcounts + 1);

  let bytesLeft;
  if (readTableLen) {
    const tableLen = token.readShort();
    bytesLeft = tableLen - 2;
  } else {
    bytesLeft = bytesLeftIn;
  }

  const tableId = token.readByte();
  bytesLeft--;

  let numCodes = 0;
  for (let i = 0; i < MAX_HUFFBITS; i++) {
    huffbits[i] = token.readByte();
    numCodes += huffbits[i];
    bytesLeft--;
  }

  for (let i = 0; i < numCodes; i++) {
    huffvalues[i] = token.readByte();
    bytesLeft--;
  }

  return { tableId, huffbits, huffvalues, bytesLeft };
}

// ---- Comment (COM) ----

function getCComment(token) {
  const size = token.readShort() - 2;
  token.readBytes(size);
}

// ---- Frame header (SOF) ----

function getCFrameHeaderWSQ(token) {
  token.readShort(); // header size

  const black = token.readByte();
  const white = token.readByte();
  const height = token.readShort();
  const width = token.readShort();

  let scale = token.readByte();
  let shrtDat = token.readShort();
  let mShift = shrtDat;
  while (scale > 0) {
    mShift /= 10.0;
    scale--;
  }

  scale = token.readByte();
  shrtDat = token.readShort();
  let rScale = shrtDat;
  while (scale > 0) {
    rScale /= 10.0;
    scale--;
  }

  const wsqEncoder = token.readByte();
  const software = token.readShort();

  return { black, white, width, height, mShift, rScale, wsqEncoder, software };
}

// ---- Tree building ----
// Ported exactly from JNBIS WsqDecoder.java

function buildWSQTrees(token, width, height) {
  buildWTree(token, W_TREELEN, width, height);
  buildQTree(token, Q_TREELEN);
}

function buildWTree(token, wtreelen, width, height) {
  token.wtree = [];
  for (let i = 0; i < wtreelen; i++) {
    token.wtree.push({ x: 0, y: 0, lenx: 0, leny: 0, invrw: 0, invcl: 0 });
  }

  token.wtree[2].invrw = 1;
  token.wtree[4].invrw = 1;
  token.wtree[7].invrw = 1;
  token.wtree[9].invrw = 1;
  token.wtree[11].invrw = 1;
  token.wtree[13].invrw = 1;
  token.wtree[16].invrw = 1;
  token.wtree[18].invrw = 1;
  token.wtree[3].invcl = 1;
  token.wtree[5].invcl = 1;
  token.wtree[8].invcl = 1;
  token.wtree[9].invcl = 1;
  token.wtree[12].invcl = 1;
  token.wtree[13].invcl = 1;
  token.wtree[17].invcl = 1;
  token.wtree[18].invcl = 1;

  wtree4(token, 0, 1, width, height, 0, 0, 1);

  let lenx, lenx2, leny, leny2;

  if ((token.wtree[1].lenx % 2) === 0) {
    lenx = token.wtree[1].lenx / 2;
    lenx2 = lenx;
  } else {
    lenx = ((token.wtree[1].lenx + 1) / 2) | 0;
    lenx2 = lenx - 1;
  }

  if ((token.wtree[1].leny % 2) === 0) {
    leny = token.wtree[1].leny / 2;
    leny2 = leny;
  } else {
    leny = ((token.wtree[1].leny + 1) / 2) | 0;
    leny2 = leny - 1;
  }

  wtree4(token, 4, 6, lenx2, leny, lenx, 0, 0);
  wtree4(token, 5, 10, lenx, leny2, 0, leny, 0);
  wtree4(token, 14, 15, lenx, leny, 0, 0, 0);

  token.wtree[19].x = 0;
  token.wtree[19].y = 0;
  if ((token.wtree[15].lenx % 2) === 0) {
    token.wtree[19].lenx = token.wtree[15].lenx / 2;
  } else {
    token.wtree[19].lenx = ((token.wtree[15].lenx + 1) / 2) | 0;
  }
  if ((token.wtree[15].leny % 2) === 0) {
    token.wtree[19].leny = token.wtree[15].leny / 2;
  } else {
    token.wtree[19].leny = ((token.wtree[15].leny + 1) / 2) | 0;
  }
}

function wtree4(token, start1, start2, lenx, leny, x, y, stop1) {
  const wtree = token.wtree;
  const p1 = start1;
  const p2 = start2;

  const evenx = lenx % 2;
  const eveny = leny % 2;

  wtree[p1].x = x;
  wtree[p1].y = y;
  wtree[p1].lenx = lenx;
  wtree[p1].leny = leny;

  wtree[p2].x = x;
  wtree[p2 + 2].x = x;
  wtree[p2].y = y;
  wtree[p2 + 1].y = y;

  if (evenx === 0) {
    wtree[p2].lenx = (lenx / 2) | 0;
    wtree[p2 + 1].lenx = wtree[p2].lenx;
  } else {
    if (p1 === 4) {
      wtree[p2].lenx = ((lenx - 1) / 2) | 0;
      wtree[p2 + 1].lenx = wtree[p2].lenx + 1;
    } else {
      wtree[p2].lenx = ((lenx + 1) / 2) | 0;
      wtree[p2 + 1].lenx = wtree[p2].lenx - 1;
    }
  }
  wtree[p2 + 1].x = wtree[p2].lenx + x;
  if (stop1 === 0) {
    wtree[p2 + 3].lenx = wtree[p2 + 1].lenx;
    wtree[p2 + 3].x = wtree[p2 + 1].x;
  }
  wtree[p2 + 2].lenx = wtree[p2].lenx;

  if (eveny === 0) {
    wtree[p2].leny = (leny / 2) | 0;
    wtree[p2 + 2].leny = wtree[p2].leny;
  } else {
    if (p1 === 5) {
      wtree[p2].leny = ((leny - 1) / 2) | 0;
      wtree[p2 + 2].leny = wtree[p2].leny + 1;
    } else {
      wtree[p2].leny = ((leny + 1) / 2) | 0;
      wtree[p2 + 2].leny = wtree[p2].leny - 1;
    }
  }
  wtree[p2 + 2].y = wtree[p2].leny + y;
  if (stop1 === 0) {
    wtree[p2 + 3].leny = wtree[p2 + 2].leny;
    wtree[p2 + 3].y = wtree[p2 + 2].y;
  }
  wtree[p2 + 1].leny = wtree[p2].leny;
}

function buildQTree(token, qtreelen) {
  token.qtree = [];
  for (let i = 0; i < qtreelen; i++) {
    token.qtree.push({ x: 0, y: 0, lenx: 0, leny: 0 });
  }

  qtree16(token, 3, token.wtree[14].lenx, token.wtree[14].leny, token.wtree[14].x, token.wtree[14].y, 0, 0);
  qtree16(token, 19, token.wtree[4].lenx, token.wtree[4].leny, token.wtree[4].x, token.wtree[4].y, 0, 1);
  qtree16(token, 48, token.wtree[0].lenx, token.wtree[0].leny, token.wtree[0].x, token.wtree[0].y, 0, 0);
  qtree16(token, 35, token.wtree[5].lenx, token.wtree[5].leny, token.wtree[5].x, token.wtree[5].y, 1, 0);
  qtree4(token, 0, token.wtree[19].lenx, token.wtree[19].leny, token.wtree[19].x, token.wtree[19].y);
}

function qtree16(token, start, lenx, leny, x, y, rw, cl) {
  const qtree = token.qtree;
  const p = start;

  const evenx = lenx % 2;
  const eveny = leny % 2;

  let tempx, temp2x, tempy, temp2y;

  if (evenx === 0) {
    tempx = (lenx / 2) | 0;
    temp2x = tempx;
  } else {
    if (cl !== 0) {
      temp2x = ((lenx + 1) / 2) | 0;
      tempx = temp2x - 1;
    } else {
      tempx = ((lenx + 1) / 2) | 0;
      temp2x = tempx - 1;
    }
  }

  if (eveny === 0) {
    tempy = (leny / 2) | 0;
    temp2y = tempy;
  } else {
    if (rw !== 0) {
      temp2y = ((leny + 1) / 2) | 0;
      tempy = temp2y - 1;
    } else {
      tempy = ((leny + 1) / 2) | 0;
      temp2y = tempy - 1;
    }
  }

  const evenx2 = tempx % 2;
  const eveny2 = tempy % 2;

  qtree[p].x = x;
  qtree[p + 2].x = x;
  qtree[p].y = y;
  qtree[p + 1].y = y;
  if (evenx2 === 0) {
    qtree[p].lenx = (tempx / 2) | 0;
    qtree[p + 1].lenx = qtree[p].lenx;
    qtree[p + 2].lenx = qtree[p].lenx;
    qtree[p + 3].lenx = qtree[p].lenx;
  } else {
    qtree[p].lenx = ((tempx + 1) / 2) | 0;
    qtree[p + 1].lenx = qtree[p].lenx - 1;
    qtree[p + 2].lenx = qtree[p].lenx;
    qtree[p + 3].lenx = qtree[p + 1].lenx;
  }
  qtree[p + 1].x = x + qtree[p].lenx;
  qtree[p + 3].x = qtree[p + 1].x;
  if (eveny2 === 0) {
    qtree[p].leny = (tempy / 2) | 0;
    qtree[p + 1].leny = qtree[p].leny;
    qtree[p + 2].leny = qtree[p].leny;
    qtree[p + 3].leny = qtree[p].leny;
  } else {
    qtree[p].leny = ((tempy + 1) / 2) | 0;
    qtree[p + 1].leny = qtree[p].leny;
    qtree[p + 2].leny = qtree[p].leny - 1;
    qtree[p + 3].leny = qtree[p + 2].leny;
  }
  qtree[p + 2].y = y + qtree[p].leny;
  qtree[p + 3].y = qtree[p + 2].y;

  // Second quadrant (right half of top)
  const evenx3 = temp2x % 2;

  qtree[p + 4].x = x + tempx;
  qtree[p + 6].x = qtree[p + 4].x;
  qtree[p + 4].y = y;
  qtree[p + 5].y = y;
  qtree[p + 6].y = qtree[p + 2].y;
  qtree[p + 7].y = qtree[p + 2].y;
  qtree[p + 4].leny = qtree[p].leny;
  qtree[p + 5].leny = qtree[p].leny;
  qtree[p + 6].leny = qtree[p + 2].leny;
  qtree[p + 7].leny = qtree[p + 2].leny;
  if (evenx3 === 0) {
    qtree[p + 4].lenx = (temp2x / 2) | 0;
    qtree[p + 5].lenx = qtree[p + 4].lenx;
    qtree[p + 6].lenx = qtree[p + 4].lenx;
    qtree[p + 7].lenx = qtree[p + 4].lenx;
  } else {
    qtree[p + 5].lenx = ((temp2x + 1) / 2) | 0;
    qtree[p + 4].lenx = qtree[p + 5].lenx - 1;
    qtree[p + 6].lenx = qtree[p + 4].lenx;
    qtree[p + 7].lenx = qtree[p + 5].lenx;
  }
  qtree[p + 5].x = qtree[p + 4].x + qtree[p + 4].lenx;
  qtree[p + 7].x = qtree[p + 5].x;

  // Third quadrant (bottom-left)
  const eveny3 = temp2y % 2;

  qtree[p + 8].x = x;
  qtree[p + 9].x = qtree[p + 1].x;
  qtree[p + 10].x = x;
  qtree[p + 11].x = qtree[p + 1].x;
  qtree[p + 8].y = y + tempy;
  qtree[p + 9].y = qtree[p + 8].y;
  qtree[p + 8].lenx = qtree[p].lenx;
  qtree[p + 9].lenx = qtree[p + 1].lenx;
  qtree[p + 10].lenx = qtree[p].lenx;
  qtree[p + 11].lenx = qtree[p + 1].lenx;
  if (eveny3 === 0) {
    qtree[p + 8].leny = (temp2y / 2) | 0;
    qtree[p + 9].leny = qtree[p + 8].leny;
    qtree[p + 10].leny = qtree[p + 8].leny;
    qtree[p + 11].leny = qtree[p + 8].leny;
  } else {
    qtree[p + 10].leny = ((temp2y + 1) / 2) | 0;
    qtree[p + 11].leny = qtree[p + 10].leny;
    qtree[p + 8].leny = qtree[p + 10].leny - 1;
    qtree[p + 9].leny = qtree[p + 8].leny;
  }
  qtree[p + 10].y = qtree[p + 8].y + qtree[p + 8].leny;
  qtree[p + 11].y = qtree[p + 10].y;

  // Fourth quadrant (bottom-right)
  qtree[p + 12].x = qtree[p + 4].x;
  qtree[p + 13].x = qtree[p + 5].x;
  qtree[p + 14].x = qtree[p + 4].x;
  qtree[p + 15].x = qtree[p + 5].x;
  qtree[p + 12].y = qtree[p + 8].y;
  qtree[p + 13].y = qtree[p + 8].y;
  qtree[p + 14].y = qtree[p + 10].y;
  qtree[p + 15].y = qtree[p + 10].y;
  qtree[p + 12].lenx = qtree[p + 4].lenx;
  qtree[p + 13].lenx = qtree[p + 5].lenx;
  qtree[p + 14].lenx = qtree[p + 4].lenx;
  qtree[p + 15].lenx = qtree[p + 5].lenx;
  qtree[p + 12].leny = qtree[p + 8].leny;
  qtree[p + 13].leny = qtree[p + 8].leny;
  qtree[p + 14].leny = qtree[p + 10].leny;
  qtree[p + 15].leny = qtree[p + 10].leny;
}

function qtree4(token, start, lenx, leny, x, y) {
  const qtree = token.qtree;
  const p = start;

  const evenx = lenx % 2;
  const eveny = leny % 2;

  qtree[p].x = x;
  qtree[p + 2].x = x;
  qtree[p].y = y;
  qtree[p + 1].y = y;
  if (evenx === 0) {
    qtree[p].lenx = (lenx / 2) | 0;
    qtree[p + 1].lenx = qtree[p].lenx;
    qtree[p + 2].lenx = qtree[p].lenx;
    qtree[p + 3].lenx = qtree[p].lenx;
  } else {
    qtree[p].lenx = ((lenx + 1) / 2) | 0;
    qtree[p + 1].lenx = qtree[p].lenx - 1;
    qtree[p + 2].lenx = qtree[p].lenx;
    qtree[p + 3].lenx = qtree[p + 1].lenx;
  }
  qtree[p + 1].x = x + qtree[p].lenx;
  qtree[p + 3].x = qtree[p + 1].x;
  if (eveny === 0) {
    qtree[p].leny = (leny / 2) | 0;
    qtree[p + 1].leny = qtree[p].leny;
    qtree[p + 2].leny = qtree[p].leny;
    qtree[p + 3].leny = qtree[p].leny;
  } else {
    qtree[p].leny = ((leny + 1) / 2) | 0;
    qtree[p + 1].leny = qtree[p].leny;
    qtree[p + 2].leny = qtree[p].leny - 1;
    qtree[p + 3].leny = qtree[p + 2].leny;
  }
  qtree[p + 2].y = y + qtree[p].leny;
  qtree[p + 3].y = qtree[p + 2].y;
}

// ---- Huffman decoding ----
// Matches JNBIS huffmanDecodeDataMem exactly

function huffmanDecodeDataMem(token, size) {
  const qdata = new Int32Array(size);

  const maxcode = new Int32Array(MAX_HUFFBITS + 1);
  const mincode = new Int32Array(MAX_HUFFBITS + 1);
  const valptr = new Int32Array(MAX_HUFFBITS + 1);

  const marker = { value: getCMarkerWSQ(token, TBLS_N_SOB) };
  const bitCount = { value: 0 };
  const nextByte = { value: 0 };
  let hufftableId = 0;
  let ip = 0;

  while (marker.value !== EOI_WSQ) {
    if (marker.value !== 0) {
      while (marker.value !== SOB_WSQ) {
        getCTableWSQ(token, marker.value);
        marker.value = getCMarkerWSQ(token, TBLS_N_SOB);
        if (marker.value === EOI_WSQ) break;
      }
      if (marker.value === EOI_WSQ) break;

      // Read SOB block header: header size (short) + huffman table id (byte)
      token.readShort(); // block header size
      hufftableId = token.readByte();

      if (token.tableDHT[hufftableId].tabdef !== 1) {
        throw new WsqDecodeError(`WSQ: Huffman table ${hufftableId} undefined`, { offset: token.pointer });
      }

      // Build Huffman decode tables
      const hufftable = buildHuffsizes(token.tableDHT[hufftableId].huffbits, MAX_HUFFCOUNTS_WSQ);
      buildHuffcodes(hufftable);
      genDecodeTable(hufftable, maxcode, mincode, valptr, token.tableDHT[hufftableId].huffbits);

      bitCount.value = 0;
      marker.value = 0;
    }

    // Decode next Huffman symbol
    const nodeptr = decodeDataMem(token, mincode, maxcode, valptr,
      token.tableDHT[hufftableId].huffvalues, bitCount, marker, nextByte);

    if (nodeptr === -1) {
      continue;
    }

    if (nodeptr > 0 && nodeptr <= 100) {
      // Run of zeros
      for (let n = 0; n < nodeptr; n++) {
        qdata[ip++] = 0;
      }
    } else if (nodeptr > 106 && nodeptr < 0xff) {
      // Literal value (offset by 180)
      qdata[ip++] = nodeptr - 180;
    } else if (nodeptr === 101) {
      // Positive 8-bit value
      qdata[ip++] = getCNextbitsWSQ(token, marker, bitCount, 8, nextByte);
    } else if (nodeptr === 102) {
      // Negative 8-bit value
      qdata[ip++] = -getCNextbitsWSQ(token, marker, bitCount, 8, nextByte);
    } else if (nodeptr === 103) {
      // Positive 16-bit value
      qdata[ip++] = getCNextbitsWSQ(token, marker, bitCount, 16, nextByte);
    } else if (nodeptr === 104) {
      // Negative 16-bit value
      qdata[ip++] = -getCNextbitsWSQ(token, marker, bitCount, 16, nextByte);
    } else if (nodeptr === 105) {
      // Run of zeros (8-bit count)
      let n = getCNextbitsWSQ(token, marker, bitCount, 8, nextByte);
      while (n-- > 0) {
        qdata[ip++] = 0;
      }
    } else if (nodeptr === 106) {
      // Run of zeros (16-bit count)
      let n = getCNextbitsWSQ(token, marker, bitCount, 16, nextByte);
      while (n-- > 0) {
        qdata[ip++] = 0;
      }
    } else {
      throw new WsqDecodeError(`WSQ: Invalid Huffman code: ${nodeptr}`, { offset: token.pointer });
    }
  }

  return qdata;
}

function buildHuffsizes(huffbits, _maxHuffcounts) {
  let totalCodes = 0;
  for (let i = 0; i < MAX_HUFFBITS; i++) {
    totalCodes += huffbits[i];
  }

  const huffcodeTable = [];
  for (let i = 0; i <= totalCodes; i++) {
    huffcodeTable.push({ size: 0, code: 0 });
  }

  let k = 0;
  for (let i = 1; i <= MAX_HUFFBITS; i++) {
    for (let j = 0; j < huffbits[i - 1]; j++) {
      huffcodeTable[k].size = i;
      k++;
    }
  }
  huffcodeTable[k].size = 0;

  return huffcodeTable;
}

function buildHuffcodes(huffcodeTable) {
  let tempCode = 0;
  let pointer = 0;

  let tempSize = huffcodeTable[0].size;
  if (huffcodeTable[pointer].size === 0) return;

  do {
    do {
      huffcodeTable[pointer].code = tempCode;
      tempCode++;
      pointer++;
    } while (huffcodeTable[pointer].size === tempSize);

    if (huffcodeTable[pointer].size === 0) return;

    do {
      tempCode <<= 1;
      tempSize++;
    } while (huffcodeTable[pointer].size !== tempSize);
  } while (huffcodeTable[pointer].size === tempSize);
}

function genDecodeTable(huffcodeTable, maxcode, mincode, valptr, huffbits) {
  for (let i = 0; i <= MAX_HUFFBITS; i++) {
    maxcode[i] = 0;
    mincode[i] = 0;
    valptr[i] = 0;
  }

  let i2 = 0;
  for (let i = 1; i <= MAX_HUFFBITS; i++) {
    if (huffbits[i - 1] === 0) {
      maxcode[i] = -1;
      continue;
    }
    valptr[i] = i2;
    mincode[i] = huffcodeTable[i2].code;
    i2 = i2 + huffbits[i - 1] - 1;
    maxcode[i] = huffcodeTable[i2].code;
    i2++;
  }
}

function decodeDataMem(token, mincode, maxcode, valptr, huffvalues, bitCount, marker, nextByte) {
  let code = getCNextbitsWSQ(token, marker, bitCount, 1, nextByte);
  if (marker.value !== 0) return -1;

  let inx;
  for (inx = 1; code > maxcode[inx]; inx++) {
    const tbits = getCNextbitsWSQ(token, marker, bitCount, 1, nextByte);
    code = (code << 1) + tbits;
    if (marker.value !== 0) return -1;
  }

  const inx2 = valptr[inx] + code - mincode[inx];
  return huffvalues[inx2];
}

function getCNextbitsWSQ(token, marker, bitCount, bitsReq, nextByte) {
  if (bitCount.value === 0) {
    nextByte.value = token.readByte();
    bitCount.value = 8;
    if (nextByte.value === 0xff) {
      const code2 = token.readByte();
      if (code2 !== 0x00 && bitsReq === 1) {
        marker.value = (nextByte.value << 8) | code2;
        return 1;
      }
      if (code2 !== 0x00) {
        throw new WsqDecodeError('WSQ: getCNextbitsWSQ: No stuffed zeros', { offset: token.pointer });
      }
    }
  }

  let bits;
  if (bitsReq <= bitCount.value) {
    bits = (nextByte.value >> (bitCount.value - bitsReq)) & BITMASK[bitsReq];
    bitCount.value -= bitsReq;
    nextByte.value &= BITMASK[bitCount.value];
  } else {
    const bitsNeeded = bitsReq - bitCount.value;
    bits = nextByte.value << bitsNeeded;
    bitCount.value = 0;
    const tbits = getCNextbitsWSQ(token, marker, bitCount, bitsNeeded, nextByte);
    bits |= tbits;
  }

  return bits;
}

// ---- Unquantization ----

function unquantize(token, sip, width, height) {
  const fip = new Float32Array(width * height);

  if (token.tableDQT.dqtDef !== 1) {
    throw new WsqDecodeError('WSQ: Quantization table not defined', { offset: token.pointer });
  }

  const binCenter = token.tableDQT.binCenter;

  let sptr = 0;
  for (let cnt = 0; cnt < NUM_SUBBANDS; cnt++) {
    if (token.tableDQT.qBin[cnt] === 0.0) {
      continue;
    }

    let fptr = (token.qtree[cnt].y * width) + token.qtree[cnt].x;

    for (let row = 0; row < token.qtree[cnt].leny; row++, fptr += width - token.qtree[cnt].lenx) {
      for (let col = 0; col < token.qtree[cnt].lenx; col++) {
        if (sip[sptr] === 0) {
          fip[fptr] = 0.0;
        } else if (sip[sptr] > 0) {
          fip[fptr] = (token.tableDQT.qBin[cnt] * (sip[sptr] - binCenter)) + (token.tableDQT.zBin[cnt] / 2.0);
        } else {
          fip[fptr] = (token.tableDQT.qBin[cnt] * (sip[sptr] + binCenter)) - (token.tableDQT.zBin[cnt] / 2.0);
        }
        fptr++;
        sptr++;
      }
    }
  }

  return fip;
}

// ---- Wavelet reconstruction ----

function wsqReconstruct(token, fdata, width, height) {
  if (token.tableDTT.lodef !== 1) {
    throw new WsqDecodeError('WSQ: Lopass filter coefficients not defined', { offset: token.pointer });
  }
  if (token.tableDTT.hidef !== 1) {
    throw new WsqDecodeError('WSQ: Hipass filter coefficients not defined', { offset: token.pointer });
  }

  const numPix = width * height;
  const fdataTemp = new Float32Array(numPix);

  for (let node = W_TREELEN - 1; node >= 0; node--) {
    const fdataBse = (token.wtree[node].y * width) + token.wtree[node].x;

    joinLets(fdataTemp, fdata, 0, fdataBse,
      token.wtree[node].lenx, token.wtree[node].leny,
      1, width,
      token.tableDTT.hifilt, token.tableDTT.hisz,
      token.tableDTT.lofilt, token.tableDTT.losz,
      token.wtree[node].invcl);

    joinLets(fdata, fdataTemp, fdataBse, 0,
      token.wtree[node].leny, token.wtree[node].lenx,
      width, 1,
      token.tableDTT.hifilt, token.tableDTT.hisz,
      token.tableDTT.lofilt, token.tableDTT.losz,
      token.wtree[node].invrw);
  }
}

function joinLets(newdata, olddata, newIndex, oldIndex,
  len1, len2, pitch, stride,
  hi, hsz, lo, lsz, inv) {

  let lp0, lp1;
  let lopass, hipass;
  let limg, himg;
  let pix, cl_rw;
  let i;
  let loc, hoc;
  let hlen, llen;
  let tap;
  let olle, ohle, olre, ohre;
  let lle, lle2, lre, lre2;
  let hle, hle2, hre, hre2;
  let lpx, lspx;
  let lpxstr, lspxstr;
  let lstap, lotap;
  let hpx, hspx;
  let hpxstr, hspxstr;
  let hstap, hotap;
  let asym, fhre = 0, ofhre;
  let ssfac, osfac, sfac;

  const da_ev = len2 % 2;
  const fi_ev = lsz % 2;
  const pstr = stride;
  const nstr = -pstr;

  if (da_ev !== 0) {
    llen = ((len2 + 1) / 2) | 0;
    hlen = llen - 1;
  } else {
    llen = (len2 / 2) | 0;
    hlen = llen;
  }

  if (fi_ev !== 0) {
    asym = 0;
    ssfac = 1.0;
    ofhre = 0;
    loc = ((lsz - 1) / 4) | 0;
    hoc = (((hsz + 1) / 4) | 0) - 1;
    lotap = (((lsz - 1) / 2) | 0) % 2;
    hotap = (((hsz + 1) / 2) | 0) % 2;
    if (da_ev !== 0) {
      olle = 0; olre = 0; ohle = 1; ohre = 1;
    } else {
      olle = 0; olre = 1; ohle = 1; ohre = 0;
    }
  } else {
    asym = 1;
    ssfac = -1.0;
    ofhre = 2;
    loc = ((lsz / 4) | 0) - 1;
    hoc = ((hsz / 4) | 0) - 1;
    lotap = ((lsz / 2) | 0) % 2;
    hotap = ((hsz / 2) | 0) % 2;
    if (da_ev !== 0) {
      olle = 1; olre = 0; ohle = 1; ohre = 1;
    } else {
      olle = 1; olre = 1; ohle = 1; ohre = 1;
    }

    if (loc === -1) { loc = 0; olle = 0; }
    if (hoc === -1) { hoc = 0; ohle = 0; }

    for (i = 0; i < hsz; i++) {
      hi[i] *= -1.0;
    }
  }

  for (cl_rw = 0; cl_rw < len1; cl_rw++) {
    limg = newIndex + cl_rw * pitch;
    himg = limg;
    newdata[himg] = 0.0;
    newdata[himg + stride] = 0.0;

    if (inv !== 0) {
      hipass = oldIndex + cl_rw * pitch;
      lopass = hipass + stride * hlen;
    } else {
      lopass = oldIndex + cl_rw * pitch;
      hipass = lopass + stride * llen;
    }

    lp0 = lopass;
    lp1 = lp0 + (llen - 1) * stride;
    lspx = lp0 + (loc * stride);
    lspxstr = nstr;
    lstap = lotap;
    lle2 = olle;
    lre2 = olre;

    const hp0 = hipass;
    const hp1 = hp0 + (hlen - 1) * stride;
    hspx = hp0 + (hoc * stride);
    hspxstr = nstr;
    hstap = hotap;
    hle2 = ohle;
    hre2 = ohre;
    osfac = ssfac;

    for (pix = 0; pix < hlen; pix++) {
      for (tap = lstap; tap >= 0; tap--) {
        lle = lle2;
        lre = lre2;
        lpx = lspx;
        lpxstr = lspxstr;

        newdata[limg] = olddata[lpx] * lo[tap];
        for (i = tap + 2; i < lsz; i += 2) {
          if (lpx === lp0) {
            if (lle !== 0) { lpxstr = 0; lle = 0; }
            else lpxstr = pstr;
          }
          if (lpx === lp1) {
            if (lre !== 0) { lpxstr = 0; lre = 0; }
            else lpxstr = nstr;
          }
          lpx += lpxstr;
          newdata[limg] += olddata[lpx] * lo[i];
        }
        limg += stride;
      }
      if (lspx === lp0) {
        if (lle2 !== 0) { lspxstr = 0; lle2 = 0; }
        else lspxstr = pstr;
      }
      lspx += lspxstr;
      lstap = 1;

      for (tap = hstap; tap >= 0; tap--) {
        hle = hle2;
        hre = hre2;
        hpx = hspx;
        hpxstr = hspxstr;
        fhre = ofhre;
        sfac = osfac;

        for (i = tap; i < hsz; i += 2) {
          if (hpx === hp0) {
            if (hle !== 0) { hpxstr = 0; hle = 0; }
            else { hpxstr = pstr; sfac = 1.0; }
          }
          if (hpx === hp1) {
            if (hre !== 0) {
              hpxstr = 0;
              hre = 0;
              if (asym !== 0 && da_ev !== 0) {
                hre = 1;
                fhre--;
                sfac = fhre;
                if (sfac === 0.0) hre = 0;
              }
            } else {
              hpxstr = nstr;
              if (asym !== 0) sfac = -1.0;
            }
          }
          newdata[himg] += olddata[hpx] * hi[i] * sfac;
          hpx += hpxstr;
        }
        himg += stride;
      }
      if (hspx === hp0) {
        if (hle2 !== 0) { hspxstr = 0; hle2 = 0; }
        else { hspxstr = pstr; osfac = 1.0; }
      }
      hspx += hspxstr;
      hstap = 1;
    }

    // Last low-pass taps
    if (da_ev !== 0) {
      if (lotap !== 0) lstap = 1;
      else lstap = 0;
    } else {
      if (lotap !== 0) lstap = 2;
      else lstap = 1;
    }

    for (tap = 1; tap >= lstap; tap--) {
      lle = lle2;
      lre = lre2;
      lpx = lspx;
      lpxstr = lspxstr;

      newdata[limg] = olddata[lpx] * lo[tap];
      for (i = tap + 2; i < lsz; i += 2) {
        if (lpx === lp0) {
          if (lle !== 0) { lpxstr = 0; lle = 0; }
          else lpxstr = pstr;
        }
        if (lpx === lp1) {
          if (lre !== 0) { lpxstr = 0; lre = 0; }
          else lpxstr = nstr;
        }
        lpx += lpxstr;
        newdata[limg] += olddata[lpx] * lo[i];
      }
      limg += stride;
    }

    // Last high-pass taps
    if (da_ev !== 0) {
      if (hotap !== 0) hstap = 1;
      else hstap = 0;
      if (hsz === 2) {
        hspx -= hspxstr;
        fhre = 1;
      }
    } else {
      if (hotap !== 0) hstap = 2;
      else hstap = 1;
    }

    for (tap = 1; tap >= hstap; tap--) {
      hle = hle2;
      hre = hre2;
      hpx = hspx;
      hpxstr = hspxstr;
      sfac = osfac;
      if (hsz !== 2) fhre = ofhre;

      for (i = tap; i < hsz; i += 2) {
        if (hpx === hp0) {
          if (hle !== 0) { hpxstr = 0; hle = 0; }
          else { hpxstr = pstr; sfac = 1.0; }
        }
        if (hpx === hp1) {
          if (hre !== 0) {
            hpxstr = 0;
            hre = 0;
            if (asym !== 0 && da_ev !== 0) {
              hre = 1;
              fhre--;
              sfac = fhre;
              if (sfac === 0.0) hre = 0;
            }
          } else {
            hpxstr = nstr;
            if (asym !== 0) sfac = -1.0;
          }
        }
        newdata[himg] += olddata[hpx] * hi[i] * sfac;
        hpx += hpxstr;
      }
      himg += stride;
    }
  }

  // Undo hi-filter sign flip for even-length filters
  if (fi_ev === 0) {
    for (i = 0; i < hsz; i++) {
      hi[i] *= -1.0;
    }
  }
}

// ---- Float to byte conversion ----

function convertImageToByte(img, width, height, mShift, rScale) {
  const data = new Uint8Array(width * height);

  let idx = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let pixel = (img[idx] * rScale) + mShift;
      pixel += 0.5;

      if (pixel < 0.0) {
        data[idx] = 0;
      } else if (pixel > 255.0) {
        data[idx] = 255;
      } else {
        data[idx] = pixel | 0;
      }
      idx++;
    }
  }

  return data;
}
