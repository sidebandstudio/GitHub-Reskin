// TEMPORARY. Classic theme documents derived from the 1.1.0 palettes in extension/themes.js, so the
// gallery can show all twelve Classics before C2's reviewed themes/classics/*.reskin.json exist.
// Order and slugs follow ARCHITECTURE.md's frozen Classics order. Never ships; see ../README.md.

const LEGACY = [
  ["editing-suite", "Editing Suite", "dark", { bg: "#0a0a0b", text: "#ededea", accent: "#f2a93b", graph: "#f2a93b" }],
  ["dracula", "Dracula", "dark", { bg: "#282a36", text: "#f8f8f2", accent: "#bd93f9", graph: "#ff79c6", surface: "#21222c", border: "#44475a", muted: "#6272a4" }],
  ["nord", "Nord", "dark", { bg: "#2e3440", text: "#eceff4", accent: "#88c0d0", graph: "#88c0d0", surface: "#3b4252", border: "#4c566a", muted: "#616e88" }],
  ["catppuccin-mocha", "Catppuccin Mocha", "dark", { bg: "#1e1e2e", text: "#cdd6f4", accent: "#cba6f7", graph: "#a6e3a1", surface: "#181825", border: "#313244", muted: "#a6adc8" }],
  ["gruvbox", "Gruvbox", "dark", { bg: "#282828", text: "#ebdbb2", accent: "#fabd2f", graph: "#b8bb26", surface: "#32302f", border: "#504945", muted: "#a89984" }],
  ["tokyo-night", "Tokyo Night", "dark", { bg: "#1a1b26", text: "#c0caf5", accent: "#7aa2f7", graph: "#bb9af7", surface: "#16161e", border: "#292e42", muted: "#565f89" }],
  ["rose-pine", "Rosé Pine", "dark", { bg: "#191724", text: "#e0def4", accent: "#c4a7e7", graph: "#ebbcba", surface: "#1f1d2e", border: "#403d52", muted: "#908caa" }],
  ["one-dark", "One Dark", "dark", { bg: "#282c34", text: "#abb2bf", accent: "#61afef", graph: "#98c379", surface: "#21252b", border: "#3e4451", muted: "#5c6370" }],
  ["solarized-dark", "Solarized Dark", "dark", { bg: "#002b36", text: "#93a1a1", accent: "#268bd2", graph: "#2aa198", surface: "#073642", border: "#174652", muted: "#586e75" }],
  ["catppuccin-latte", "Catppuccin Latte", "light", { bg: "#eff1f5", text: "#4c4f69", accent: "#8839ef", graph: "#40a02b", surface: "#e6e9ef", border: "#ccd0da", muted: "#6c6f85" }],
  ["rose-pine-dawn", "Rosé Pine Dawn", "light", { bg: "#faf4ed", text: "#575279", accent: "#907aa9", graph: "#d7827e", surface: "#fffaf3", border: "#dfdad9", muted: "#797593" }],
  ["solarized-light", "Solarized Light", "light", { bg: "#fdf6e3", text: "#073642", accent: "#268bd2", graph: "#2aa198", surface: "#eee8d5", border: "#ddd6c1", muted: "#657b83" }],
];

export const CLASSICS = LEGACY.map(([slug, name, base, p], index) => {
  const overrides = {};
  if (p.surface) overrides.surface = p.surface;
  if (p.border) overrides.border = p.border;
  if (p.muted) overrides.mutedText = p.muted;
  return {
    entry: { id: slug, slug, group: "classics", file: `themes/classics/${slug}.reskin.json`, order: index + 1 },
    doc: {
      schemaVersion: 1,
      name,
      author: "sidebandstudio",
      version: "1.0.0",
      description: `The ${name} palette, carried over from GitHub Reskin 1.1.`,
      tags: ["classic", base],
      base,
      colors: { background: p.bg, text: p.text, accent: p.accent, contribution: p.graph },
      ...(Object.keys(overrides).length ? { overrides } : {}),
    },
  };
});
