/**
 * Reads a ZIP's central directory without inflating anything: entry names,
 * uncompressed sizes (ZIP64 included) and whether an entry is a symbolic
 * link (Unix mode bits in the external attributes). fflate's unzip filter
 * doesn't expose the attributes, and the sizes let a ZIP bomb be refused
 * before it is decompressed.
 */
export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  symlink: boolean;
  directory: boolean;
}

export class ZipReadError extends Error {}

const EOCD = 0x06054b50;
const CDH = 0x02014b50;
const EOCD64_LOCATOR = 0x07064b50;

export function zipEntries(b: Uint8Array): ZipEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
    if (v.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new ZipReadError("The file isn't a readable ZIP archive.");
  let count = v.getUint16(eocd + 10, true);
  let offset = v.getUint32(eocd + 16, true);
  if ((count === 0xffff || offset === 0xffffffff) && eocd >= 20 && v.getUint32(eocd - 20, true) === EOCD64_LOCATOR) {
    const rec = Number(v.getBigUint64(eocd - 20 + 8, true));
    if (rec + 56 > b.length) throw new ZipReadError("The ZIP's directory is damaged.");
    count = Number(v.getBigUint64(rec + 32, true));
    offset = Number(v.getBigUint64(rec + 48, true));
  }
  const out: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== CDH) throw new ZipReadError("The ZIP's directory is damaged.");
    const madeBy = v.getUint16(p + 4, true) >> 8;
    let compressedSize = v.getUint32(p + 20, true);
    let size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const attrs = v.getUint32(p + 38, true);
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
    // ZIP64: sizes saturated at 0xffffffff live in extra field 0x0001, uncompressed first.
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; ) {
      const id = v.getUint16(e, true);
      const len = v.getUint16(e + 2, true);
      if (id === 0x0001) {
        let f = e + 4;
        if (size === 0xffffffff) {
          size = Number(v.getBigUint64(f, true));
          f += 8;
        }
        if (compressedSize === 0xffffffff) compressedSize = Number(v.getBigUint64(f, true));
      }
      e += 4 + len;
    }
    const mode = (attrs >>> 16) & 0o170000;
    out.push({ name, size, compressedSize, symlink: madeBy === 3 && mode === 0o120000, directory: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
