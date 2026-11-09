// Stands in for C3's extension/content/github when it is not in the checkout. The real-adapter
// tests skip while it is bundled.
export const available = false;
export const locateSlots = () => [];
export const classifyRoute = () => "other";
export const dormantSlots = () => ["empty.issues.caption"];
