// Themes and the CSS that applies them. Shared by the popup and the content script.
(function () {
  "use strict";

  // Each theme sets four colors you can edit in the popup. Optional surface, border
  // and muted values follow the original palette and drop away once you edit.
  // palette() shifts muted text and links toward the text color when they'd be hard to read.
  // Palettes are from their open source projects, credited in the README.
  // A theme with `effects` also gets the matching extra CSS from EFFECTS below.
  const THEMES = [
    { id: "cyberpunk", name: "Cyberpunk", bg: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a", graph: "#00f0ff", surface: "#11112a", border: "#2d2a52", muted: "#9a9ccc", effects: "cyberpunk" },
    { id: "editing-suite", name: "Editing Suite", bg: "#0a0a0b", text: "#ededea", accent: "#f2a93b", graph: "#f2a93b" },
    { id: "dracula", name: "Dracula", bg: "#282a36", text: "#f8f8f2", accent: "#bd93f9", graph: "#ff79c6", surface: "#21222c", border: "#44475a", muted: "#6272a4" },
    { id: "nord", name: "Nord", bg: "#2e3440", text: "#eceff4", accent: "#88c0d0", graph: "#88c0d0", surface: "#3b4252", border: "#4c566a", muted: "#616e88" },
    { id: "catppuccin-mocha", name: "Catppuccin Mocha", bg: "#1e1e2e", text: "#cdd6f4", accent: "#cba6f7", graph: "#a6e3a1", surface: "#181825", border: "#313244", muted: "#a6adc8" },
    { id: "gruvbox", name: "Gruvbox", bg: "#282828", text: "#ebdbb2", accent: "#fabd2f", graph: "#b8bb26", surface: "#32302f", border: "#504945", muted: "#a89984" },
    { id: "tokyo-night", name: "Tokyo Night", bg: "#1a1b26", text: "#c0caf5", accent: "#7aa2f7", graph: "#bb9af7", surface: "#16161e", border: "#292e42", muted: "#565f89" },
    { id: "rose-pine", name: "Rosé Pine", bg: "#191724", text: "#e0def4", accent: "#c4a7e7", graph: "#ebbcba", surface: "#1f1d2e", border: "#403d52", muted: "#908caa" },
    { id: "one-dark", name: "One Dark", bg: "#282c34", text: "#abb2bf", accent: "#61afef", graph: "#98c379", surface: "#21252b", border: "#3e4451", muted: "#5c6370" },
    { id: "solarized-dark", name: "Solarized Dark", bg: "#002b36", text: "#93a1a1", accent: "#268bd2", graph: "#2aa198", surface: "#073642", border: "#174652", muted: "#586e75" },
    { id: "catppuccin-latte", name: "Catppuccin Latte", bg: "#eff1f5", text: "#4c4f69", accent: "#8839ef", graph: "#40a02b", surface: "#e6e9ef", border: "#ccd0da", muted: "#6c6f85" },
    { id: "rose-pine-dawn", name: "Rosé Pine Dawn", bg: "#faf4ed", text: "#575279", accent: "#907aa9", graph: "#d7827e", surface: "#fffaf3", border: "#dfdad9", muted: "#797593" },
    { id: "solarized-light", name: "Solarized Light", bg: "#fdf6e3", text: "#073642", accent: "#268bd2", graph: "#2aa198", surface: "#eee8d5", border: "#ddd6c1", muted: "#657b83" },
  ];

  const DEFAULTS = { enabled: true, theme: THEMES[0].id, custom: null };
  const EDITABLE = ["bg", "text", "accent", "graph"];

  function rgb(color) {
    const n = parseInt(color.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  // Moves color a toward color b. t = 0 gives a, t = 1 gives b.
  function mix(a, b, t) {
    const [x, y] = [rgb(a), rgb(b)];
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
  }

  function luminance(color) {
    const [r, g, b] = rgb(color).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  }

  // GitHub puts white text on accent buttons. Darken the accent until that text reads.
  function darkenForWhiteText(color) {
    let t = 0;
    while (contrast(mix(color, "#000000", t), "#ffffff") < 4.5 && t < 1) t += 0.05;
    return mix(color, "#000000", Math.min(t, 1));
  }

  // Mixes color toward the text color until it reads on the background.
  function readable(color, bg, text) {
    let t = 0;
    while (contrast(mix(color, text, t), bg) < 4.5 && t < 1) t += 0.05;
    return mix(color, text, Math.min(t, 1));
  }

  function isHex(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  // Settings from storage -> the full set of colors to paint.
  function palette(settings) {
    const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
    const custom = settings.custom && EDITABLE.every((k) => isHex(settings.custom[k])) ? settings.custom : null;
    const { bg, text, accent, graph } = custom || theme;
    const dark = luminance(bg) < 0.18;
    // If the chosen text color doesn't read on the background, derived colors and the
    // popup use black or white instead. One of the two always reaches 4.5:1.
    const ink =
      contrast(text, bg) >= 4.5 ? text : contrast("#000000", bg) > contrast("#ffffff", bg) ? "#000000" : "#ffffff";
    return {
      dark,
      bg,
      text,
      ink,
      accent,
      graph,
      surface: (!custom && theme.surface) || mix(bg, ink, 0.05),
      border: (!custom && theme.border) || mix(bg, ink, 0.18),
      muted: readable((!custom && theme.muted) || mix(bg, ink, 0.65), bg, ink),
      link: readable(accent, bg, ink),
      inset: mix(bg, "#000000", dark ? 0.3 : 0.03),
      raised: mix(bg, ink, 0.08),
      hover: mix(bg, ink, 0.12),
      strong: darkenForWhiteText(accent),
      shades: [mix(bg, ink, 0.09), ...[0.35, 0.55, 0.78, 1].map((t) => mix(bg, graph, t))],
      // Effects stay on when you edit the theme's colors, and use the edited ones.
      effects: theme.effects || null,
    };
  }

  function css(p) {
    const vars = {
      "--bgColor-default": p.bg,
      "--bgColor-muted": p.surface,
      "--bgColor-inset": p.inset,
      "--bgColor-accent-emphasis": p.strong,
      "--bgColor-accent-muted": mix(p.bg, p.accent, 0.16),
      "--bgColor-neutral-muted": mix(p.bg, p.text, 0.12),
      "--fgColor-default": p.text,
      "--fgColor-muted": p.muted,
      "--fgColor-accent": p.link,
      "--fgColor-link": p.link,
      "--borderColor-default": p.border,
      "--borderColor-muted": mix(p.bg, p.border, 0.7),
      "--borderColor-accent-emphasis": p.accent,
      "--borderColor-accent-muted": mix(p.bg, p.accent, 0.4),
      "--header-bgColor": p.inset,
      "--header-fgColor-default": p.muted,
      "--header-fgColor-logo": p.text,
      "--header-borderColor-divider": p.border,
      "--headerSearch-bgColor": p.bg,
      "--headerSearch-borderColor": p.border,
      "--page-header-bgColor": p.bg,
      "--card-bgColor": p.bg,
      "--overlay-bgColor": p.raised,
      "--overlay-borderColor": p.border,
      "--control-bgColor-rest": p.surface,
      "--control-bgColor-hover": p.hover,
      "--control-borderColor-rest": p.border,
      "--control-fgColor-rest": p.text,
      "--button-default-bgColor-rest": p.raised,
      "--button-default-bgColor-hover": p.hover,
      "--button-default-bgColor-active": mix(p.bg, p.text, 0.16),
      "--button-default-borderColor-rest": p.border,
      "--button-default-borderColor-hover": p.border,
      "--button-default-fgColor-rest": p.text,
      "--button-primary-bgColor-rest": p.strong,
      "--button-primary-bgColor-hover": mix(p.strong, "#000000", 0.12),
      "--button-primary-bgColor-active": mix(p.strong, "#000000", 0.2),
      "--button-primary-borderColor-rest": p.strong,
      "--button-primary-fgColor-rest": "#ffffff",
      "--buttonCounter-default-bgColor-rest": mix(p.bg, p.text, 0.14),
      "--underlineNav-borderColor-active": p.accent,
      "--sideNav-bgColor-selected": p.raised,
      "--selection-bgColor": mix(p.bg, p.accent, 0.35),
      "--focus-outlineColor": p.accent,
    };
    // GitHub swaps in holiday palettes (Halloween, winter) for the graph and activity chart.
    for (const season of ["default", "halloween", "winter"]) {
      p.shades.forEach((shade, level) => (vars[`--contribution-${season}-bgColor-${level}`] = shade));
    }
    const declarations = Object.entries(vars).map(([name, value]) => `${name}:${value} !important;`).join("");
    const days = p.shades
      .map(
        (shade, level) =>
          `.ContributionCalendar-day[data-level="${level}"]{fill:${shade} !important;background-color:${shade} !important;border-color:transparent !important}`,
      )
      .join("\n");
    // The activity overview's shape has its holiday color in a fill attribute.
    const blob = `.js-highlight-blob{fill:${p.graph} !important;stroke:${p.graph} !important}`;
    // GitHub's own colors for the matching mode go first, so code, diffs and labels suit the background.
    const mode = (globalThis.GitHubReskinModes || {})[p.dark ? "dark" : "light"] || "";
    const extra = p.effects ? EFFECTS[p.effects](p) : "";
    return `${blob}\n:root,[data-color-mode],[data-light-theme],[data-dark-theme]{${mode}${declarations}color-scheme:${p.dark ? "dark" : "light"} !important}\n${days}\n${extra}`;
  }

  // Of the choices, the color that reads best on color.
  function bestOn(color, choices) {
    return choices.reduce((best, c) => (contrast(c, color) > contrast(best, color) ? c : best));
  }

  // color at the given opacity, in percent.
  const alpha = (color, percent) => `color-mix(in srgb,${color} ${percent}%,transparent)`;

  const FONT_DISPLAY = `"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow",ui-monospace,monospace`;
  const FONT_MONO = `ui-monospace,"SF Mono",SFMono-Regular,"Cascadia Mono","JetBrains Mono",Menlo,Consolas,"Liberation Mono",monospace`;

  // Neon on dark glass: condensed and monospace type, glows, beveled corners, a grid behind
  // the page and glitchy hovers. Code, diffs and body text never glow. Motion only runs
  // inside prefers-reduced-motion: no-preference.
  function cyberpunk(p) {
    const neon = p.accent;
    const neon2 = p.graph;
    const onNeon = bestOn(neon, [p.bg, "#000000", "#ffffff"]);
    // Hover and pressed buttons move away from their text color when a shade would make it hard to read.
    const awayFromText = bestOn(onNeon, ["#000000", "#ffffff"]);
    const buttonHover = readable(mix(neon, "#ffffff", 0.15), onNeon, awayFromText);
    const buttonActive = readable(mix(neon, "#000000", 0.12), onNeon, awayFromText);
    // The neon for links, icons, carets, the scrollbar and selection marks, mixed toward the text color
    // until it reads on every page background, the accent tint GitHub puts branch names and topics
    // on included. Glows and edges keep the raw neon. The scrollbar thumb and focus ring are
    // softened only on dark pages. On a light page they would fade out.
    let [surface, inset, raised, accentMuted] = [p.surface, p.inset, p.raised, mix(p.bg, neon2, 0.12)];
    const worst = (color) => Math.min(...[p.bg, surface, inset, raised, accentMuted].map((bg) => contrast(color, bg)));
    // On a mid-grey background the surfaces and the tint can sit either side of where black and
    // white text cross over, so nothing reads on all of them. Then each one that black or white, on
    // the text's side, can't read on moves to the other side of the background, as far from it as before.
    const straddles = worst("#000000") < 4.5 && worst("#ffffff") < 4.5;
    if (straddles) {
      const [side, away] = luminance(p.ink) > luminance(p.bg) ? ["#ffffff", "#000000"] : ["#000000", "#ffffff"];
      const flip = (color) => {
        if (contrast(side, color) >= 4.5) return color;
        let t = 0;
        while (contrast(mix(p.bg, away, t), p.bg) < contrast(color, p.bg) && t < 1) t += 0.01;
        return mix(p.bg, away, Math.min(t, 1));
      };
      [surface, inset, raised, accentMuted] = [surface, inset, raised, accentMuted].map(flip);
    }
    const surfaces = straddles
      ? `--bgColor-muted:${surface} !important;--control-bgColor-rest:${surface} !important;--bgColor-inset:${inset} !important;--header-bgColor:${inset} !important;--overlay-bgColor:${raised} !important;--button-default-bgColor-rest:${raised} !important;--sideNav-bgColor-selected:${raised} !important;`
      : "";
    // The text color can read on the page background but not quite on a surface. Then black or
    // white, whichever reads on all of them.
    const toward = worst(p.ink) >= 4.5 ? p.ink : worst("#000000") > worst("#ffffff") ? "#000000" : "#ffffff";
    let t = 0;
    while (worst(mix(neon, toward, t)) < 4.5 && t < 1) t += 0.05;
    const neonFg = mix(neon, toward, Math.min(t, 1));
    // Logged-out pages end in GitHub's marketing footer, which takes its colors from Primer Brand's
    // own variables instead. It gets the inset background, the text color where that reads on it,
    // and Cyberpunk's buttons. Its language menu sets its own color mode, so that gets them too.
    // GitHub's Markdown drops class and role, so nobody can write one.
    const footerText = contrast(p.text, inset) >= 4.5 ? p.text : toward;
    // A hovered language in its menu shades toward the text, or away from it where the text only just reads.
    const footerMenuHover = [mix(inset, footerText, 0.08), mix(inset, bestOn(footerText, ["#000000", "#ffffff"]), 0.08)].find((c) => contrast(footerText, c) >= 4.5);
    const footer = `--brand-color-canvas-subtle:${inset} !important;--brand-color-canvas-default:${inset} !important;--brand-color-text-default:${footerText} !important;--brand-color-text-muted:${readable(p.muted, inset, footerText)} !important;--brand-Link-color-default:${footerText} !important;--brand-color-border-muted:${p.border} !important;--brand-color-border-default:${p.border} !important;--brand-color-accent-primary:${neonFg} !important;--brand-color-focus:${neonFg} !important;--brand-button-primary-bgColor-rest:${neon} !important;--brand-button-primary-bgColor-hover:${buttonHover} !important;--brand-button-primary-bgColor-active:${buttonActive} !important;--brand-button-primary-borderColor-rest:${neon} !important;--brand-button-primary-borderColor-hover:${neon} !important;--brand-button-primary-borderColor-active:${neon} !important;--brand-button-primary-fgColor-rest:${onNeon} !important;--brand-button-secondary-bgColor-rest:${inset} !important;--brand-button-secondary-bgColor-hover:${inset} !important;--brand-button-secondary-bgColor-active:${inset} !important;--brand-button-secondary-borderColor-rest:${p.border} !important;--brand-button-secondary-borderColor-hover:${neonFg} !important;--brand-button-secondary-borderColor-active:${neonFg} !important;--brand-button-secondary-fgColor-rest:${footerText} !important;--brand-ActionMenu-color-item-hover:${footerMenuHover} !important`;
    const header = ":is(.AppHeader,.HeaderMktg,.Header,.gist-header-logged-out)";
    const logo = ":is(.AppHeader-logo,.Header-link,header a[aria-label='Homepage'],a[aria-label='Gist Homepage'])";
    const title = ":is([data-testid='repo-name-link'],strong[itemprop='name'] a,#repo-title-component a,.AppHeader-context-item-label,.gist-blob-name)";
    const buttons = ":is(.btn,.Button,[data-component='Button'],[data-component='IconButton'],[data-component='ActionMenu.Button'],.BtnGroup-item)";
    const primary = ":is(.btn-primary,.Button--primary,[data-variant='primary'])";
    const labels = ":is(.Label,.IssueLabel,.Counter,.topic-tag,.State,[data-component='Label'],[data-component='CounterLabel'],[class*='prc-Token-TokenBase'],[class*='prc-StateLabel'])";
    const tabs = ":is(.UnderlineNav-item,[class*='UnderlineItem'],.tabnav-tab,.js-selected-navigation-item)";
    const selectedTab = ":is(.UnderlineNav-item.selected,.UnderlineNav-item[aria-current='page'],[class*='UnderlineItem'][aria-current='page'],.tabnav-tab.selected,.tabnav-tab[aria-current='page'])";
    const boxes = ":is(.Box,.markdown-body pre,.blankslate)";
    // Panels from GitHub's React code have hashed class names, so these keep GitHub's radius.
    const panels = ":is(.rounded-1,.rounded-2,.rounded-3,.rounded-top-2,.rounded-bottom-2,[class*='Box_'],[class*='branchInfoBar'])";
    const overlays = ":is([class*='prc-Overlay-Overlay'],.Overlay,.SelectMenu-modal,.dropdown-menu,.Popover-message)";
    const code = ":is(pre,code,kbd,samp,tt,textarea,.blob-code,.blob-code-inner,.react-code-text,.react-code-lines,.diff-table,[class*='diff-text'],[class*='DiffLines'])";
    const days = p.shades
      .slice(1)
      .map((shade, i) => `.ContributionCalendar-day[data-level="${i + 1}"]{box-shadow:0 0 ${[2, 4, 6, 9][i]}px ${alpha(shade, 85)} !important}`)
      .join("\n");
    // When GitHub's own setting is auto, it colors issue labels by the OS light or dark setting.
    // These are its dark or light label colors, chosen by Cyberpunk's background instead.
    const issueLabels = ":is(.hx_IssueLabel,[class*='prc-Token-IssueLabel'])";
    const [labelColors, labelHover] = p.dark
      ? ["--lightness-threshold:.6 !important;--background-alpha:.18 !important;--border-alpha:.3 !important;--lighten-by:calc((var(--lightness-threshold) - var(--perceived-lightness))*100*var(--lightness-switch)) !important;background:rgb(var(--label-r),var(--label-g),var(--label-b),var(--background-alpha)) !important;border-color:hsl(var(--label-h),calc(var(--label-s)*1%),calc((var(--label-l) + var(--lighten-by))*1%),var(--border-alpha)) !important;color:hsl(var(--label-h),calc(var(--label-s)*1%),calc((var(--label-l) + var(--lighten-by))*1%)) !important", "background:hsl(var(--label-h),calc(var(--label-s)*1%),calc((var(--label-l) + 10)*1%),.3) !important"]
      : ["--lightness-threshold:.453 !important;--border-threshold:.96 !important;--border-alpha:max(0,min(calc((var(--perceived-lightness) - var(--border-threshold))*100),1)) !important;background:rgb(var(--label-r),var(--label-g),var(--label-b)) !important;border-color:hsl(var(--label-h),calc(var(--label-s)*1%),calc((var(--label-l) - 25)*1%),var(--border-alpha)) !important;color:hsl(0deg,0%,calc(var(--lightness-switch)*100%)) !important", "background:linear-gradient(#00000026,#00000026),rgb(var(--label-r),var(--label-g),var(--label-b)) !important"];
    // Primary buttons fill with the neon. Accent tints use the graph color, since a yellow
    // mixed into a dark base turns olive. Bevels use corner-shape, which doesn't clip menus inside.
    // Gecko parses corner-shape but draws round corners, and some engines lack it. There, corners
    // are square, and only labels that aren't links get a clip-path bevel, which would clip focus rings.
    // The top glow covers one screen and scrolls with the page, so it ends where it has faded out.
    return `/* reskin-effects:cyberpunk */
:root,[data-color-mode],[data-light-theme],[data-dark-theme]{${surfaces}--bgColor-accent-muted:${accentMuted} !important;--bgColor-accent-emphasis:${darkenForWhiteText(neon2)} !important;--borderColor-accent-muted:${mix(p.bg, neon2, 0.4)} !important;--button-primary-bgColor-rest:${neon} !important;--button-primary-bgColor-hover:${buttonHover} !important;--button-primary-bgColor-active:${buttonActive} !important;--button-primary-borderColor-rest:${neon} !important;--button-primary-borderColor-hover:${neon} !important;--button-primary-fgColor-rest:${onNeon} !important;--button-primary-iconColor-rest:${onNeon} !important;--underlineNav-borderColor-active:${neonFg} !important;--borderColor-accent-emphasis:${neonFg} !important;--focus-outlineColor:${neonFg} !important;--fgColor-accent:${neonFg} !important;--fgColor-link:${neonFg} !important}
:root{scrollbar-color:${p.dark ? mix(p.bg, neonFg, 0.55) : neonFg} ${inset}}
body{background-image:radial-gradient(ellipse 80% 50% at 50% -10%,${alpha(neon2, 10)},transparent 70%),linear-gradient(${alpha(neon2, 5)} 1px,transparent 1px),linear-gradient(90deg,${alpha(neon2, 5)} 1px,transparent 1px),repeating-linear-gradient(${alpha(p.ink, 2)} 0 1px,transparent 1px 3px) !important;background-size:100% 100vh,48px 48px,48px 48px,auto !important;background-repeat:no-repeat,repeat,repeat,repeat !important}
::selection{background-color:${neon} !important;color:${onNeon} !important}
input,textarea,[contenteditable]{caret-color:${neonFg}}
${header}{box-shadow:0 1px 0 ${neon},0 4px 24px -6px ${alpha(neon, 55)} !important}
${logo}:hover svg{filter:drop-shadow(0 0 6px ${alpha(neon, 80)})}
${title}{text-shadow:0 0 10px ${alpha(neon2, 55)}}
${title}:hover{color:${neonFg} !important;text-shadow:-1px 0 ${alpha(neon, 70)},1px 0 ${alpha(neon2, 70)},0 0 10px ${alpha(neon, 60)}}
:is(h1,h2,h3,[data-component='Heading']){font-family:${FONT_DISPLAY};letter-spacing:.02em}
:is(h1,h2,.markdown-body h3){text-shadow:0 0 12px ${alpha(neon, 35)}}
:is(.markdown-body h1,.markdown-body h2){border-bottom-color:${alpha(neon, 35)} !important}
${header},${header} :is(a,button,summary),${tabs},${buttons}{font-family:${FONT_DISPLAY}}
${labels}{font-family:${FONT_MONO};border-radius:.5em 0 !important;corner-shape:bevel}
${buttons}{border-radius:8px 0 !important;corner-shape:bevel}
${primary}{font-weight:600;box-shadow:0 0 0 1px ${neon},0 0 14px ${alpha(neon, 55)} !important}
${primary}:hover{box-shadow:0 0 0 1px ${neon},0 0 22px ${alpha(neon, 80)} !important}
${boxes}{border-radius:12px 0 !important;corner-shape:bevel}
:is(.Box-header,.Box>:first-child){border-top-left-radius:12px !important;corner-shape:bevel}
.Box>:last-child{border-bottom-right-radius:12px !important;corner-shape:bevel}
${panels}{corner-shape:bevel}
${overlays}{border-radius:12px 0 !important;corner-shape:bevel;box-shadow:0 0 0 1px ${alpha(neon, 55)},0 10px 32px -8px ${alpha(neon, 45)} !important}
@supports (not (corner-shape:bevel)) or (-moz-appearance:none){${labels},${buttons},${boxes},:is(.Box-header,.Box>:first-child),.Box>:last-child,${panels},${overlays}{border-radius:0 !important}${labels}:not(a,button){clip-path:polygon(.4em 0,100% 0,100% calc(100% - .4em),calc(100% - .4em) 100%,0 100%,0 .4em)}}
${issueLabels}{${labelColors}}
${issueLabels}:where([data-cursor-is-interactive='true']:hover){${labelHover}}
${selectedTab}{color:${p.text} !important;text-shadow:0 0 10px ${alpha(neon, 70)}}
${selectedTab}::after{background:${neonFg} !important;box-shadow:0 0 10px ${neon},0 0 3px ${neon} !important}
${selectedTab} svg{color:${neonFg} !important;filter:drop-shadow(0 0 4px ${alpha(neon, 80)})}
a:hover:not(${code} a){text-shadow:0 0 8px ${alpha(p.link, 70)}}
:focus-visible{box-shadow:0 0 0 3px ${p.dark ? alpha(neon, 30) : neonFg},0 0 16px ${alpha(neon, 65)} !important}
${days}
.ContributionCalendar-day{border-radius:1px !important}
${code},${code} *{text-shadow:none !important}
footer[class*='footer__'][role='contentinfo'],footer[class*='footer__'][role='contentinfo'] [data-color-mode]{${footer}}
@media (prefers-reduced-motion:no-preference){
@keyframes reskin-glitch{0%,100%{transform:none;filter:drop-shadow(0 0 6px ${alpha(neon, 80)})}20%{transform:translate(-2px,1px);filter:drop-shadow(-2px 0 ${neon}) drop-shadow(2px 0 ${neon2})}40%{transform:translate(2px,-1px);filter:drop-shadow(2px 0 ${neon}) drop-shadow(-2px 0 ${neon2})}60%{transform:skewX(-8deg);opacity:.7}80%{transform:translate(1px,0);opacity:1}}
@keyframes reskin-flicker{0%,100%{opacity:1}10%{opacity:.55}14%{opacity:1}40%{opacity:.8}44%{opacity:1}70%{opacity:.6}72%{opacity:1}}
${logo}:hover svg{animation:reskin-glitch .5s steps(1,end) 2}
${title}:hover{animation:reskin-flicker .6s linear 1}
}
`;
  }

  // Cyberpunk also swaps some of GitHub's labels for street slang, from slang.js.
  const EFFECTS = { cyberpunk: (p) => cyberpunk(p) + (globalThis.GitHubReskin.slang?.(p) || "") };

  // Reads settings from chrome.storage.local, filling in DEFAULTS. Before 1.1, Editing Suite was
  // the default and editing a color saved only `custom`, so edits with no saved theme were made on
  // Editing Suite, and still load on it. Nothing is written here: the popup saves the theme with
  // every change, so a late read in another tab can't overwrite a theme you just picked.
  async function load(storage) {
    const stored = await storage.get(Object.keys(DEFAULTS));
    if (stored.custom && !stored.theme) stored.theme = "editing-suite";
    return { ...DEFAULTS, ...stored };
  }

  globalThis.GitHubReskin = { THEMES, DEFAULTS, EDITABLE, palette, css, load, mix, contrast, isHex };
})();
