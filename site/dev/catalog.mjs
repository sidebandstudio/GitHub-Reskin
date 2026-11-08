// TEMPORARY development catalog: S1's staged anime documents plus the derived Classics, in the frozen
// catalog order (Anime first, then Classics). Phase 2 reads themes/catalog.json instead. Never ships.
import catalogAnime from "./themes/catalog-anime.json" with { type: "json" };
import choomCircuit from "./themes/anime/choom-circuit.reskin.json" with { type: "json" };
import violetSynchrony from "./themes/anime/violet-synchrony.reskin.json" with { type: "json" };
import occultOrbit from "./themes/anime/occult-orbit.reskin.json" with { type: "json" };
import gatewakeProtocol from "./themes/anime/gatewake-protocol.reskin.json" with { type: "json" };
import wisteriaEmberline from "./themes/anime/wisteria-emberline.reskin.json" with { type: "json" };
import sunwardVoyage from "./themes/anime/sunward-voyage.reskin.json" with { type: "json" };
import fifthLeafForge from "./themes/anime/fifth-leaf-forge.reskin.json" with { type: "json" };
import cursedAperture from "./themes/anime/cursed-aperture.reskin.json" with { type: "json" };
import peanutDossier from "./themes/anime/peanut-dossier.reskin.json" with { type: "json" };
import wallwardScout from "./themes/anime/wallward-scout.reskin.json" with { type: "json" };
import longroadPetals from "./themes/anime/longroad-petals.reskin.json" with { type: "json" };
import ripcordBureau from "./themes/anime/ripcord-bureau.reskin.json" with { type: "json" };
import shinigamiMargins from "./themes/anime/shinigami-margins.reskin.json" with { type: "json" };
import { CLASSICS } from "./themes/classics.mjs";

const ANIME_DOCS = {
  "choom-circuit": choomCircuit,
  "violet-synchrony": violetSynchrony,
  "occult-orbit": occultOrbit,
  "gatewake-protocol": gatewakeProtocol,
  "wisteria-emberline": wisteriaEmberline,
  "sunward-voyage": sunwardVoyage,
  "fifth-leaf-forge": fifthLeafForge,
  "cursed-aperture": cursedAperture,
  "peanut-dossier": peanutDossier,
  "wallward-scout": wallwardScout,
  "longroad-petals": longroadPetals,
  "ripcord-bureau": ripcordBureau,
  "shinigami-margins": shinigamiMargins,
};

// Where the catalog came from. The built page records it so the production check can reject it.
export const CATALOG_SOURCE = "site/dev";

/** Every theme as { id, slug, group, order, doc }, Anime first, then Classics, each by order. */
export const CATALOG = Object.freeze([
  ...[...catalogAnime].sort((a, b) => a.order - b.order).map((entry) => ({ ...entry, doc: ANIME_DOCS[entry.slug] })),
  ...CLASSICS.map(({ entry, doc }) => ({ ...entry, doc })),
]);
