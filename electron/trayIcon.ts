import { deflateSync } from "node:zlib";
import { nativeImage, type NativeImage } from "electron";
import type { Direction } from "./core/ticker";

/** sRGB pastels from the Swift app (TokenPulse), and the saturated system pair. */
export const COLORS = {
  pastel: { up: "#c7f5c7", down: "#ffc2bf", flat: "#d0d6e2" },
  saturated: { up: "#34c759", down: "#ff3b30", flat: "#d0d6e2" },
} as const;

const cache = new Map<string, NativeImage>();

/** Colored dot for a symbol with no logo, and for the Windows tray in scroll mode. */
export function dotImage(direction: Direction, pastel: boolean): NativeImage {
  const hex = COLORS[pastel ? "pastel" : "saturated"][direction];
  const cached = cache.get(hex);
  if (cached) return cached;
  const h = hex.replace("#", "");
  const rgb: [number, number, number] = [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
  const img = nativeImage.createFromBuffer(encodeDotPng(32, rgb), { scaleFactor: 2 });
  cache.set(hex, img);
  return img;
}

function encodeDotPng(size: number, rgb: [number, number, number]): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const c = (size - 1) / 2;
  const r = size * 0.34;
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.max(0, Math.min(1, r + 0.5 - d));
      if (alpha <= 0) continue;
      const i = y * stride + 1 + x * 4;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
      raw[i + 3] = Math.round(alpha * 255);
    }
  }

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let k = 0; k < 8; k++) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
