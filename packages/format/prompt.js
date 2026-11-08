// The copyable prompt for a chatbot. Reskin never sends it anywhere; the person copies it.
import { IDEA_PLACEHOLDER, PROMPT_TEMPLATE } from "./prompt-template.js";

export const MAX_IDEA_LENGTH = 500;

/**
 * The prompt with the person's idea in place. The idea is plain text: control and text-direction
 * characters are removed, whitespace is collapsed and it is cut to MAX_IDEA_LENGTH characters.
 * @param {string} [idea]
 */
export function makeAiPrompt(idea) {
  const clean = Array.from(String(idea ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, MAX_IDEA_LENGTH)
    .join("")
    .trim();
  return PROMPT_TEMPLATE.replace(IDEA_PLACEHOLDER, () => clean || "(describe your idea here)");
}
