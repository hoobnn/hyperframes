import { readFileSync } from "node:fs";

export function pngDimensions(path: string): { width?: number; height?: number } {
  const png = readFileSync(path);
  if (png.length < 24) return {};
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
