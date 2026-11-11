```json
{
  "schemaVersion": 1,
  "name": "Pelagic midnight",
  "description": "Deep teal panels with soft cyan light, coral highlights and readable code.",
  "inspiredBy": "Deep-sea bioluminescence",
  "tags": ["dark", "deep-sea", "cyan", "coral", "calm"],
  "base": "dark",
  "colors": {
    "background": "#061a20",
    "text": "#d9eff0",
    "accent": "#79dcd4",
    "contribution": "#75dbed"
  },
  "backgrounds": {
    "page": {
      "color": "#061a20",
      "layers": [
        {
          "gradient": {
            "type": "radial",
            "position": "top-right",
            "stops": [
              {"color": "#75dbed", "position": 0},
              {"color": "#103a46", "position": 38},
              {"color": "#061a20", "position": 78}
            ],
            "opacity": 0.12
          }
        },
        {
          "gradient": {
            "type": "radial",
            "position": "bottom-left",
            "stops": [
              {"color": "#ffa99d", "position": 0},
              {"color": "#061a20", "position": 65}
            ],
            "opacity": 0.05
          }
        }
      ]
    },
    "profileBanner": {
      "color": "#09252e",
      "layers": [
        {
          "gradient": {
            "type": "radial",
            "position": "right",
            "stops": [
              {"color": "#75dbed", "position": 0},
              {"color": "#174956", "position": 42},
              {"color": "#09252e", "position": 100}
            ],
            "opacity": 0.18
          }
        }
      ]
    },
    "header": {
      "color": "#081e26"
    }
  },
  "shape": {
    "corners": {"style": "rounded", "radius": 10},
    "borders": {"width": 1, "style": "solid", "color": "#355963"},
    "shadows": {"style": "soft", "color": "#020c10", "opacity": 0.22, "blur": 12, "offset": 2},
    "buttons": {"style": "filled", "radius": 7},
    "avatar": {
      "shape": "circle",
      "frame": {"style": "solid", "width": 2, "color": "#79dcd4"}
    }
  },
  "fonts": {
    "heading": "space-grotesk",
    "body": "source-sans-3"
  },
  "typography": {
    "uppercaseHeadings": false,
    "headingLetterSpacing": 0.015,
    "bodyLetterSpacing": 0
  },
  "overrides": {
    "surface": "#0d2730",
    "inset": "#06171d",
    "raised": "#15333d",
    "hover": "#1b404a",
    "mutedText": "#a1bdc3",
    "link": "#8ee4f2",
    "border": "#355963",
    "controlBorder": "#61858e",
    "accentMuted": "#163c45",
    "accentEmphasis": "#79dcd4",
    "primaryBackground": "#79dcd4",
    "primaryText": "#061a20",
    "focus": "#a3f2f5",
    "selectionBackground": "#285d69",
    "selectionText": "#e8fbfa",
    "success": "#92deb4",
    "danger": "#ff9b9d",
    "warning": "#edcc87",
    "done": "#c3b3ee"
  },
  "code": {
    "background": "#071c23",
    "text": "#d9eff0",
    "syntax": {
      "comment": "#97b4bc",
      "keyword": "#ffa99d",
      "string": "#9de1bf",
      "function": "#8ee4f2",
      "number": "#edcc87",
      "variable": "#d9eff0",
      "type": "#c3b3ee",
      "operator": "#79dcd4",
      "punctuation": "#b3cdd1",
      "constant": "#edcc87",
      "tag": "#ffa99d",
      "attribute": "#8ee4f2",
      "regex": "#a7e4ce",
      "escape": "#f3d8a0",
      "invalid": "#ff9b9d",
      "inserted": "#a4e7bd",
      "deleted": "#ffb6b7",
      "markupHeading": "#8ee4f2",
      "markupEmphasis": "#f1e3cc",
      "markupLink": "#8ee4f2",
      "markupQuote": "#b3cdd1",
      "markupList": "#ffa99d"
    },
    "ansi": {
      "black": "#102c35",
      "red": "#ff9b9d",
      "green": "#92deb4",
      "yellow": "#edcc87",
      "blue": "#a3c8fa",
      "magenta": "#c3b3ee",
      "cyan": "#79dcd4",
      "white": "#d9eff0",
      "brightBlack": "#97b4bc",
      "brightRed": "#ffc0b6",
      "brightGreen": "#b8f0cf",
      "brightYellow": "#f5dfae",
      "brightBlue": "#c1dcff",
      "brightMagenta": "#ddcfff",
      "brightCyan": "#aff4ee",
      "brightWhite": "#effbfa"
    },
    "diff": {
      "addedBackground": "#10352d",
      "addedText": "#a4e7bd",
      "removedBackground": "#3a242c",
      "removedText": "#ffb6b7",
      "wordAddedBackground": "#1a5140",
      "wordAddedText": "#d0f8dd",
      "wordRemovedBackground": "#603340",
      "wordRemovedText": "#ffe0dc"
    }
  },
  "contributions": {
    "levels": ["#102b33", "#1a5262", "#267c90", "#3cabc0", "#75dbed"],
    "cellStyle": "round",
    "cellRadius": 2,
    "cellBoundary": "#52747c"
  },
  "details": {
    "headerText": "#d9eff0",
    "selection": {"background": "#285d69", "text": "#e8fbfa"},
    "scrollbar": {"thumb": "#61858e", "track": "#06171d", "width": "auto"},
    "labels": {
      "style": "rounded",
      "fill": "outline",
      "background": "#30292f",
      "text": "#ffc0b6",
      "border": "#b08481"
    },
    "topics": {
      "style": "pill",
      "fill": "tinted",
      "background": "#163c45",
      "text": "#aff4ee",
      "border": "#61858e"
    }
  },
  "css": ".AppHeader { box-shadow: 0 1px 0 var(--reskin-accent); }"
}
```
