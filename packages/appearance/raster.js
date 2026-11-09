// Embedded images for the structured paints: the admitted data URL behind each resolved image
// layer, and the local conversion the theme builder runs on a picked file. The resolver keeps only
// an image's hash; the renderer looks the data up in the same source document by that hash, so a
// layer draws exactly the bytes that were admitted, or nothing.
//
// Conversion (THEME-EXPANSION.md, "Images and storage") reads a file's header first: at most
// 2 MiB, PNG/JPEG/WebP/GIF magic, at most 2048px a side and 2,097,152 pixels, and the document's
// 6,291,456-pixel allowance reserved before any decode. Then it decodes once, keeps the first
// frame of an animated image, crops, scales, and encodes a still PNG or WebP through a canvas,
// which writes no metadata. The output passes the same header admission as an imported image.
// Every bitmap and canvas is released when a job ends, finished or cancelled. Jobs run one at a
// time through a queue that cancels a job its replacement makes obsolete. The functions take
// their browser primitives as an argument, so a worker can run them as well as a page.
import { LIMITS } from "../contracts/index.js";
import { rasterHash, rasterInfo, rasterLayers, rasterSourceInfo, rasterTotals, releaseRasters } from "../format/viewer.js";

// ---- Assets of a source document ----

/**
 * The admitted image data of a source document by the hash the resolver gives each image layer.
 * Images that fail admission are left out, so a layer naming them draws nothing.
 * @returns {Map<string, string>}
 */
export function imageAssets(theme) {
  const out = new Map();
  for (const { image } of rasterLayers(theme)) {
    const hash = rasterHash(image.data);
    if (hash) out.set(hash, image.data);
  }
  return out;
}

// ---- Conversion ----

const TYPES = { png: "image/png", webp: "image/webp" };
// WebP qualities Compress tries in turn until the image fits.
export const COMPRESS_QUALITIES = Object.freeze([0.9, 0.8, 0.7, 0.6, 0.5, 0.4]);

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const cancelled = () => failure("cancelled", "A newer image replaced this one.");

/**
 * The output size for a crop scaled to fit `maxSide` and the pixel cap, keeping its aspect ratio.
 * Pure; the builder's Resize control and the converter share it.
 */
export function fitSize(width, height, maxSide = LIMITS.imageMaxDimension) {
  const side = Math.min(maxSide, LIMITS.imageMaxDimension);
  const scale = Math.min(1, side / width, side / height, Math.sqrt(LIMITS.imageMaxPixels / (width * height)));
  // Flooring keeps each side, and so their product, within the bounds the scale meets exactly.
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

// A crop rectangle within the source, in source pixels; the whole image without one.
function cropRect(crop, width, height) {
  if (!crop) return { x: 0, y: 0, width, height };
  const x = Math.max(0, Math.min(width - 1, Math.floor(crop.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(crop.y)));
  return { x, y, width: Math.max(1, Math.min(width - x, Math.floor(crop.width))), height: Math.max(1, Math.min(height - y, Math.floor(crop.height))) };
}

/** The browser primitives conversion uses, from a page or a worker's global scope. */
export function browserRasterEnv(scope = globalThis) {
  return {
    decode: (blob) => scope.createImageBitmap(blob),
    canvas(width, height) {
      if (typeof scope.OffscreenCanvas === "function") {
        const canvas = new scope.OffscreenCanvas(width, height);
        return { context: canvas.getContext("2d"), encode: (type, quality) => canvas.convertToBlob({ type, quality }), release: () => ((canvas.width = 0), (canvas.height = 0)) };
      }
      const canvas = scope.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return {
        context: canvas.getContext("2d"),
        encode: (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
        release: () => ((canvas.width = 0), (canvas.height = 0)),
      };
    },
    Blob: scope.Blob,
  };
}

// Chunks an encoder may add that are not pixels: Chromium writes an sRGB ICC profile into every
// canvas WebP. They come out of the encoder's own output, so a theme never carries any.
const WEBP_EXTRA = new Set(["ICCP", "EXIF", "XMP "]);
const PNG_EXTRA = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "iCCP"]);
const tag = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** The encoded bytes without metadata chunks, for the WebP and PNG a canvas writes. */
export function stripEncoderMetadata(bytes) {
  const keep = [];
  if (tag(bytes, 0) === "RIFF" && tag(bytes, 8) === "WEBP") {
    for (let i = 12; i + 8 <= bytes.length; ) {
      const length = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
      const end = Math.min(bytes.length, i + 8 + length + (length & 1));
      if (!WEBP_EXTRA.has(tag(bytes, i))) keep.push(bytes.slice(i, end));
      i = end;
    }
    const vp8x = keep.find((c) => tag(c, 0) === "VP8X");
    if (vp8x) vp8x[8] &= ~0x2c;
    const size = keep.reduce((n, c) => n + c.length, 4);
    const out = new Uint8Array(8 + size);
    out.set(bytes.subarray(0, 4));
    out.set([size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255], 4);
    out.set(bytes.subarray(8, 12), 8);
    let o = 12;
    for (const c of keep) (out.set(c, o), (o += c.length));
    return out;
  }
  if (bytes[0] === 0x89 && tag(bytes, 1) === "PNG") {
    keep.push(bytes.slice(0, 8));
    for (let i = 8; i + 12 <= bytes.length; ) {
      const length = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
      const end = i + 12 + length;
      if (!PNG_EXTRA.has(tag(bytes, i + 4))) keep.push(bytes.slice(i, end));
      i = end;
    }
    const out = new Uint8Array(keep.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of keep) (out.set(c, o), (o += c.length));
    return out;
  }
  return bytes;
}

const base64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/**
 * Converts the bytes of a local image file to a still, metadata-free PNG or WebP that a theme can
 * carry. Never writes into a theme: the result is a proposal the builder shows (before and after
 * size, dimensions, a note) and applies with setRasterLayer once the person accepts it.
 *
 * @param {Uint8Array} bytes the file's bytes, at most 2 MiB
 * @param {object} [options]
 * @param {{x:number,y:number,width:number,height:number}} [options.crop] in source pixels
 * @param {number} [options.maxSide] Resize: the longest side of the output, at most 2048
 * @param {"png"|"webp"} [options.format] webp by default
 * @param {number} [options.quality] WebP quality 0..1, 0.9 by default
 * @param {boolean} [options.compress] Compress: try lower WebP qualities until the image fits
 * @param {{bytes:number, pixels:number}} [options.others] the theme's other images, counting
 *   repeats (rasterTotals with this layer left out); the output must fit beside them
 * @param {AbortSignal} [options.signal] cancels the job; it releases what it holds and resolves
 *   with code "cancelled"
 * @param {object} [env] browserRasterEnv() by default
 */
export async function convertRaster(bytes, options = {}, env = browserRasterEnv()) {
  const { crop = null, maxSide = LIMITS.imageMaxDimension, format = "webp", quality = 0.9, compress = false, others = { bytes: 0, pixels: 0 }, signal = null } = options;
  if (!TYPES[format]) return failure("invalid", "Images are saved as PNG or WebP.");
  const source = rasterSourceInfo(bytes);
  if (!source.ok) return source;
  // The decode itself must fit the document's pixel allowance beside the theme's other images.
  if (others.pixels + source.width * source.height > LIMITS.documentImageDecodedPixels) {
    return failure("image-limit", `All images in a theme come to at most ${LIMITS.documentImageDecodedPixels} pixels, counting repeats; this one would pass that.`);
  }
  if (signal?.aborted) return cancelled();
  const rect = cropRect(crop, source.width, source.height);
  const size = fitSize(rect.width, rect.height, maxSide);
  if (others.pixels + size.width * size.height > LIMITS.documentImageDecodedPixels) return failure("image-limit", "This image does not fit beside the theme's other images. Resize it or remove another image.");

  let bitmap = null;
  let canvas = null;
  try {
    bitmap = await env.decode(new env.Blob([bytes], { type: source.mime }));
    if (signal?.aborted) return cancelled();
    // A decoder that disagrees with the header is not trusted with the rest.
    if (bitmap.width !== source.width || bitmap.height !== source.height) return failure("image-data", "This image's pixels do not match its header.");
    canvas = env.canvas(size.width, size.height);
    canvas.context.imageSmoothingEnabled = true;
    canvas.context.imageSmoothingQuality = "high";
    canvas.context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height);
    bitmap.close?.();
    bitmap = null;
    const budget = Math.min(LIMITS.perImageDecodedBytes, LIMITS.documentImageDecodedBytes - others.bytes);
    const qualities = format === "webp" ? (compress ? COMPRESS_QUALITIES.filter((q) => q <= quality) : [quality]) : [undefined];
    let out = null;
    for (const q of qualities.length ? qualities : [quality]) {
      const blob = await canvas.encode(TYPES[format], q);
      if (signal?.aborted) return cancelled();
      if (!blob) return failure("image-data", "This browser could not encode the image.");
      const encoded = stripEncoderMetadata(new Uint8Array(await blob.arrayBuffer()));
      // A browser without the requested encoder writes PNG instead; the bytes say which it is.
      const written = rasterSourceInfo(encoded);
      if (!written.ok) return failure("image-data", "This browser could not encode the image.");
      out = { bytes: encoded, mime: written.mime, quality: written.mime === "image/webp" ? (q ?? null) : null };
      if (out.bytes.length <= budget || out.mime !== "image/webp") break;
    }
    const before = { bytes: bytes.length, width: source.width, height: source.height, mime: source.mime };
    const after = { bytes: out.bytes.length, width: size.width, height: size.height, mime: out.mime, quality: out.quality };
    if (out.bytes.length > budget) {
      const room = budget < LIMITS.perImageDecodedBytes ? ` beside the theme's other images (${Math.max(0, budget)} bytes left)` : "";
      return failure("image-limit", `The converted image is ${out.bytes.length} bytes, over the ${budget} bytes it may use${room}. Compress or resize it.`, { before, after });
    }
    // The output passes the same admission as an imported image, at the size it was drawn.
    const data = `data:${out.mime};base64,${base64(out.bytes)}`;
    const info = rasterInfo(data);
    if (!info.ok) return failure(info.code, `The converted image did not pass admission: ${info.message}`);
    if (info.width !== size.width || info.height !== size.height) return failure("image-data", "The converted image is not the size it was drawn at.");
    const notes = [];
    if (source.animated) notes.push("kept the first frame of the animation");
    if (source.metadata) notes.push("removed metadata");
    if (crop) notes.push(`cropped to ${rect.width}x${rect.height}`);
    if (size.width !== rect.width || size.height !== rect.height) notes.push(`resized to ${size.width}x${size.height}`);
    notes.push(`saved as ${out.mime === "image/webp" ? `WebP at quality ${Math.round(out.quality * 100)}` : "PNG"}`);
    return { ok: true, image: { data, width: info.width, height: info.height }, before, after, note: `Converted locally: ${notes.join(", ")}.` };
  } catch (error) {
    if (signal?.aborted) return cancelled();
    return failure("image-data", `This image could not be decoded: ${error?.message ?? error}.`);
  } finally {
    bitmap?.close?.();
    canvas?.release();
  }
}

/**
 * A serial conversion queue. run(key, job) cancels any pending or running job with the same key
 * (an edit of the same layer, say) and starts the new one when the previous job has released its
 * decode. `job(signal)` must stop when its signal aborts. Returns the job's result, or
 * {ok:false, code:"cancelled"} for a job a newer one replaced. cancelAll() stops everything, for a
 * builder that closes.
 */
export function createRasterQueue() {
  let tail = Promise.resolve();
  const live = new Map();
  let pending = 0;
  return {
    run(key, job) {
      live.get(key)?.abort();
      const controller = new AbortController();
      live.set(key, controller);
      pending++;
      const result = tail.then(() => (controller.signal.aborted ? cancelled() : job(controller.signal))).finally(() => {
        pending--;
        if (live.get(key) === controller) live.delete(key);
      });
      tail = result.catch(() => {});
      return result;
    },
    cancelAll() {
      for (const controller of live.values()) controller.abort();
      live.clear();
    },
    get pending() {
      return pending;
    },
  };
}

// ---- Builder edits ----

const TARGETS = ["page", "profileBanner", "header"];
const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * A new theme with the image at backgrounds[target].layers[index], replacing that layer or adding
 * it at the end, or an error when the theme would exceed a cap. Fit, position and opacity are kept
 * from a replaced image unless given.
 */
export function setRasterLayer(theme, target, index, image, { fit, position, opacity } = {}) {
  if (!TARGETS.includes(target)) return failure("invalid", `${target} is not a background target.`);
  const info = rasterInfo(image?.data);
  if (!info.ok) return info;
  if (info.width !== image.width || info.height !== image.height) return failure("image-data", "The image's size does not match its data.");
  const next = copy(theme);
  next.backgrounds ??= {};
  next.backgrounds[target] ??= {};
  const layers = (next.backgrounds[target].layers ??= []);
  const at = Math.min(index ?? layers.length, layers.length);
  if (at === layers.length && layers.length >= LIMITS.maxBackgroundLayers) return failure("image-limit", `A background has at most ${LIMITS.maxBackgroundLayers} layers.`);
  const previous = layers[at]?.image ?? {};
  const entry = { data: image.data, width: info.width, height: info.height };
  for (const [key, value] of Object.entries({ fit: fit ?? previous.fit, position: position ?? previous.position, opacity: opacity ?? previous.opacity })) if (value !== undefined) entry[key] = value;
  layers[at] = { image: entry };
  const totals = rasterTotals(next);
  if (totals.bytes > LIMITS.documentImageDecodedBytes) return failure("image-limit", `All images in a theme come to at most ${LIMITS.documentImageDecodedBytes / 1024} KiB, counting repeats.`);
  if (totals.pixels > LIMITS.documentImageDecodedPixels) return failure("image-limit", `All images in a theme come to at most ${LIMITS.documentImageDecodedPixels} pixels, counting repeats.`);
  // A replaced image's data goes with it.
  releaseRasters(theme, next);
  return { ok: true, theme: next };
}

/** Remove: a new theme without that layer; a target left with no layers and no color is removed. */
export function removeRasterLayer(theme, target, index) {
  const next = copy(theme);
  const background = next.backgrounds?.[target];
  if (!background?.layers?.[index]?.image) return { ok: false, code: "invalid", message: "There is no image there." };
  background.layers.splice(index, 1);
  if (!background.layers.length) delete background.layers;
  if (!Object.keys(background).length) delete next.backgrounds[target];
  if (!Object.keys(next.backgrounds).length) delete next.backgrounds;
  releaseRasters(theme, next);
  return { ok: true, theme: next };
}
