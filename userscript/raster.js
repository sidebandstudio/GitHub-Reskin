// Image conversion for the builder in a Firefox content script. convertRaster (C5's raster.js)
// reads the encoder's Blob back as bytes, and through Firefox's Xrays a view on that Blob's
// ArrayBuffer belongs to the page, which the raster checks do not accept as bytes. Here the bytes
// come back copied into this script's own realm. Everything else is browserRasterEnv on the
// frame's window: the same decoder, canvas and encoder.
import { browserRasterEnv } from "../packages/appearance/raster.js";

/** A Blob's bytes as a Uint8Array of this script's realm. */
export async function ownBytes(blob) {
  const view = new Uint8Array(await blob.arrayBuffer());
  const bytes = new Uint8Array(view.length);
  bytes.set(view);
  return bytes;
}

/** convertRaster's environment over the frame's window `win`, for a script behind Xrays. */
export function xrayRasterEnv(win) {
  const base = browserRasterEnv(win);
  return {
    ...base,
    canvas(width, height) {
      const canvas = base.canvas(width, height);
      return {
        ...canvas,
        async encode(type, quality) {
          const blob = await canvas.encode(type, quality);
          if (!blob) return null;
          const bytes = await ownBytes(blob);
          return { arrayBuffer: async () => bytes.buffer };
        },
      };
    },
  };
}
