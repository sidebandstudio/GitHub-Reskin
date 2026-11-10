// Copies text, resolving true only when the clipboard accepted it. In-app browsers often refuse;
// callers then show the text for manual selection instead of claiming success.
export async function copyText(text) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
