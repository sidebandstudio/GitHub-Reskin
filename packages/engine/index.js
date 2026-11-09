// GitHub Reskin color engine, renderer 1, with the Revision 4 appearance record. Resolves portable
// source against one immutable GitHub mode seed into readable tokens, repairs portable source and
// audits pair-matrix version 2. Pure and deterministic: no DOM, storage, network, randomness or
// browser globals. This full entry also installs the CSS sanitizer, so themes with advanced CSS
// resolve; viewer.js is the same engine without it.
import "../format/authoring.js";

export * from "./viewer.js";
