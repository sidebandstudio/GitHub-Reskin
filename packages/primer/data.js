// The frozen production ModeIndex from vendor/primer/modes.json, deep-frozen once. Hosts pass it
// to selectMode and look up ModePlan.seedMode in it for ResolveContext.seed; the engine never
// imports it.
import MODES from "../../vendor/primer/modes.json" with { type: "json" };

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

export const MODE_INDEX = freeze(MODES);
