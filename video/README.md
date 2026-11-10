# GitHub Reskin films

Two editable [Hyperframes](https://github.com/heygen-com/hyperframes) compositions that show the
real extension on real github.com pages. Each is one deterministic, paused GSAP timeline per scene
over local captures, fonts and audio; nothing is fetched while rendering.

| Cut | Project | Size | Length | Masters |
| --- | --- | --- | --- | --- |
| TikTok/Reels | `tiktok/` | 1080x1920 | 22 s, 660 frames at 30 fps | `-sfx` (effects only, for adding a sound in the app) and `-bed` (effects plus a CC0 bed), identical picture |
| Site | `site/` | 1920x1080 | 30 s, 900 frames at 30 fps | with the optional CC0 bed, a silent copy, and a poster; it plays muted by default and reads without sound |

Both projects use the shared `video/assets/` through an `assets` link in each project folder. The
link is not committed; `npm run check:video` (or any of the commands below) creates it. Each has `captions.vtt` (optional
visual-step captions; there is no speech) and `transcript.txt`.

## Commands

From the repository root, Node 24.22.2, after `npm ci`:

```sh
node --test tests/video/*.test.mjs   # static rules, no browser
npm run check:video                  # static checks, then hyperframes check --json in both projects
npm run render:video                 # renders everything into artifacts/video/
npm run verify:video                 # check again, then ffprobe/FFmpeg on every rendered file
```

The CLI is pinned to `hyperframes@0.9.5` and run through `npx --yes`, so the first run downloads it
and its headless browser. `render:video` writes, in `artifacts/video/` (ignored):

- `github-reskin-tiktok-22s-bed.mp4`, the full vertical composition.
- `github-reskin-tiktok-22s-sfx.mp4`, the same picture stream with the audio of a render without
  the `<audio id="bed">` element; `github-reskin-tiktok-22s.mp4` is a copy for `release.config.json`.
- `github-reskin-tiktok-22s-sfx-stem.wav` and `-music-stem.wav`, the bed exactly as placed (in-point,
  gain, fades), and `-cover.png` (frame 24).
- `github-reskin-site-30s.mp4`, `-silent.mp4` (no audio stream), `-poster.png` and `.jpg` (frame 105).
- `-filmstrip.png` for each cut, one frame per second, and `render-report.json` with hashes.

`verify:video` checks 1080x1920 at 30/1 fps with exactly 660 frames and 1920x1080 with 900, audio
that ends with the picture, identical frames in the two vertical masters, silence in the SFX
master where only the bed plays (2.0 to 7.2 s), sample peaks under -1 dBFS, and the posters.

To edit in the Hyperframes Studio and look from another machine:

```sh
cd video/tiktok   # or video/site
HYPERFRAMES_PREVIEW_HOST=0.0.0.0 npx --yes hyperframes@0.9.5 preview --background --no-open --port 4317 --json
# open http://<this machine's address>:4317/#project/tiktok, then:
npx --yes hyperframes@0.9.5 preview --stop --json
```

## Beats

Frame ranges are end-exclusive at 30 fps.

TikTok/Reels, `tiktok/index.html`:

| Frames | Scene | Picture | On screen |
| --- | --- | --- | --- |
| 0-30 | hook | plain whoisaldo; header-edge wipe at 11, Choom Circuit by 17 (snap) | Cyberpunk: Edgerunners / Choom Circuit |
| 30-105 | hook | real popup over the plain page, Reskin switch tapped at 48 (click), page themed at 50, popup closes at 75 | GitHub Reskin eyebrow, same title |
| 105-165 | worlds | wipe into Violet Synchrony | Neon Genesis Evangelion |
| 165-225 | worlds | wipe into Occult Orbit | Dandadan |
| 225-285 | worlds | hard cut (whoosh) to Longroad Petals with its wallpaper | Frieren: Beyond Journey's End |
| 285-345 | people | Alitleis123 in Choom Circuit | 13 anime-inspired themes eyebrow |
| 345-405 | people | torvalds in Editing Suite, Classics popup inset 345-374 | 12 Classics / Editing Suite |
| 405-465 | details | // CHOOM tag and controls, then the cyan calendar and legend | Full transformation, Contribution graph too |
| 465-585 | more | 30-frame wipes through Wisteria Emberline, Ripcord Bureau, Sunward Voyage, Peanut Dossier | 13 anime-inspired themes: Demon Slayer, Chainsaw Man, One Piece, Spy x Family |
| 585-660 | end | Peel mark, held 75 frames (whoosh at 585) | GitHub Reskin, Free. Link in bio., For your desktop browser., Fan-made. Independent of GitHub. |

Site, `site/index.html`:

| Frames | Scene | Picture | On screen |
| --- | --- | --- | --- |
| 0-30 | hook | plain whoisaldo; wipe at 11 into Choom Circuit (snap) | Cyberpunk: Edgerunners / Choom Circuit |
| 30-120 | hook | popup, Reskin switch tapped at 48 (click), page themed at 50, popup closes at 75 | GitHub Reskin eyebrow |
| 120-195 | worlds | wipe into Violet Synchrony | 13 anime-inspired themes, Neon Genesis Evangelion |
| 195-270 | worlds | hard cut (whoosh) to Longroad Petals, then its plum calendar from 240 | Frieren: Beyond Journey's End |
| 270-330 | people | Alitleis123 in Choom Circuit | Your browser view. |
| 330-390 | people | torvalds in Editing Suite, Classics inset 330-359 | 12 Classics / Editing Suite |
| 390-450 | code | repository file list, then extension/content.js from 414 | Code colors |
| 450-510 | code | the content.js commit diff | Line and word diffs |
| 510-600 | calm | Full, then the popup's Calm tapped at 540 (click), Calm from 542 | Full / Calm, then Calm: extras off, colors stay |
| 600-780 | more | 60-frame holds with wipes: Wisteria Emberline, Ripcord Bureau, Sunward Voyage | 13 anime-inspired themes: Demon Slayer, Chainsaw Man, One Piece |
| 780-900 | end | Peel mark, held 120 frames (whoosh at 780) | GitHub Reskin, Free. Pick a theme., sidebandstudio.github.io/GitHub-Reskin/, Fan-made. Independent of GitHub. |

The storyboard's builder beats (Copy AI prompt, import of an AI-made theme, Preview, Use theme,
Save) hold their frames for more anime themes until the theme builder is on main; then they can be
captured the same way and cut into the `more` slots.

The anime title is always the headline and the original theme name sits beneath it, in Manrope.
There are no franchise logos, art, footage, dialogue or music, and no store-availability claim.

## Captures

`assets/captures/capture.mjs` takes every capture from the built Chrome package:

```sh
npm run build:stores
node video/assets/captures/capture.mjs            # all shots, or --only P02-V,POP-on
node video/assets/backdrops/make.mjs              # the blurred backdrops derived from them
```

It loads `dist/chrome` unpacked in a fresh logged-out Chromium profile and picks every theme and
setting with the popup page's own controls. Presets are V (390x844 CSS px, DPR 3), D
(1440x1000, DPR 2) and the popup (400x600, DPR 3). Each `<id>.png` has `<id>.json` beside it with
the URL, theme and its source hash, Full or Calm, extension commit, viewport, scroll rule and
resolved scroll, date and the PNG's SHA-256. Crops stay above the owner's README image, which is
third-party art.

After recapturing, run `npm run check:video`: it fails if a PNG no longer matches its manifest.

## Rights

`assets/rights.json` covers every file in `assets/`; `check:video` fails on a file without an entry
or an entry that matches nothing.

- Captures and their backdrops: this project's own screenshots of its product. GitHub's interface
  and the public profile and repository content shown belong to their owners and appear unchanged.
- Audio: seven CC0 1.0 files from OpenGameArt and Freesound, copied unmodified with their ledger
  (`audio/rights.json`, `audio/proofs/`, `audio/README.md`). The vertical bed is Experiment G by
  tricksntraps (-4.4 dB) and the site bed Synthwave House Loop by Fupi (-2.5 dB), with fades, for
  mixes near -18 and -16 LUFS; effects are a snap, a glitch, a whoosh and a mouse click. Nobody has listen-checked the mix yet.
- Manrope (OFL-1.1) with its license; the Peel mark from the brand handoff; GSAP 3.15.0 under its
  standard no-charge license.
