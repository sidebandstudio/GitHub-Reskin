// The bundled fonts on github.com. GitHub's CSP allows fonts only from its own asset host, so an
// @font-face with a data: or blob: URL is refused. A FontFace made from the embedded bytes is not
// a URL load: the browser parses the WOFF2 it is handed, with no request, no new grant and no
// change to the page's CSP. Each reviewed weight of a family the theme or a picker card names is
// added to document.fonts once; the theme CSS names the family first in its stack, so text uses
// the face once it is ready and the system fallback until then, or for good when a browser or
// manager refuses it.
import { FONT_BY_ID, UNICODE_RANGE, roleFontIds } from "../packages/appearance/index.js";

const bytes = (base64, view) => {
  const binary = view.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
};

/**
 * @param {{document: Document, view: Window, fonts: Record<string,string>}} options the page, and
 *   the build's base64 WOFF2 keyed by file name without .woff2
 * @returns {{load(id:string, weight?:number): Promise<boolean>, loadFor(resolved:object): void}}
 */
export function createFontLoader({ document, view, fonts }) {
  const faces = new Map();
  function load(id, weight = FONT_BY_ID[id]?.weight) {
    const font = FONT_BY_ID[id];
    const name = font?.files.find((file) => file.weight === weight)?.path.split("/").pop().replace(/\.woff2$/, "");
    if (!name || !Object.hasOwn(fonts, name)) return Promise.resolve(false);
    const key = `${id}:${weight}`;
    if (!faces.has(key)) {
      faces.set(
        key,
        (async () => {
          let face = null;
          try {
            face = new view.FontFace(font.cssFamily, bytes(fonts[name], view), { weight: String(weight), style: "normal", display: "swap", unicodeRange: UNICODE_RANGE });
            document.fonts.add(face);
            await face.loaded;
            return true;
          } catch {
            try {
              if (face) document.fonts.delete(face);
            } catch {
              // Nothing was added.
            }
            return false;
          }
        })(),
      );
    }
    return faces.get(key);
  }
  return {
    load,
    // Every reviewed weight of the families a resolved theme's roles name, as roleFontFaceCss lists them.
    loadFor(resolved) {
      for (const id of roleFontIds(resolved)) for (const weight of FONT_BY_ID[id].weights) load(id, weight);
    },
  };
}
