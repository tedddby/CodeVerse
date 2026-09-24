# Media for the README

The project README embeds the files below. They must be real captures of a running CodeVerse build, never
mock-ups. Capture them again after UI changes that make the current ones inaccurate, and keep every image the
README references in this directory, so no link renders broken.

| File                        | Shows                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `explorer-architecture.png` | Hero: Architecture mode on a well-known repository, the whole city in view, labels readable |
| `explorer-dependencies.png` | Dependencies mode with a selection, its import arcs and the details panel                   |
| `explorer-source.png`       | The source viewer open at a highlighted symbol, the outline beside the code                 |
| `explorer-search.png`       | The search palette (`/`) with results for a common name                                     |
| `explorer-statistics.png`   | The repository statistics panel (`I`) over the city                                         |
| `explorer-complexity.png`   | Complexity mode: hotspots across the whole repository                                       |
| `landing.png`               | The landing page hero at desktop size                                                       |

The current set shows `facebook/react` (served by GitHub as `react/react`) at commit `d083ec1`, analyzed without a
token, in Chromium at 1440 × 900.

## Capture setup

- A production build (`pnpm build && pnpm start`). A `GITHUB_TOKEN` gives complete history, which matters for
  Activity and Contributors shots; the current set avoids those modes because it was captured without one.
- Browser window at **1440 × 900** with device pixel ratio 1 (each PNG stays around 1 MB; GitHub scales them to
  the README's width anyway). No extensions, bookmarks bar or development overlays visible.
- Use a real, well-known public repository (for example `facebook/react` or `vercel/next.js`) and name it in the
  image's alt text. Do not edit, composite or retouch the UI.
- Dismiss the first-visit navigation hint and move the pointer off the canvas so no hover tooltip shows.

Suggested journey for the explorer shots: let the intro camera settle for the hero, press `5` for complexity and
`I` for statistics, then press `/`, search for a symbol, press Enter to fly to it, press `2` for dependencies and
`V` to open the source viewer at that symbol.

## Demo GIF

The README does not embed a GIF yet. A 20–30 s recording of the core journey would sit above the screenshot
table as `demo.gif`; add it to this directory and to the README together. Storyboard:

1. Landing page hero; paste `https://github.com/facebook/react` and press **Explore** (2 s).
2. The loading experience: stages ticking, the preview city forming behind it (4 s).
3. The camera settles over the city; orbit slowly with the mouse (4 s).
4. Press `/`, type a file name, press Enter: the camera flies to the building (5 s).
5. Press `2` for dependencies: arcs appear around the selection (3 s).
6. Press `V`: the source viewer opens at the file (3 s).
7. Press `3` and drag the timeline: recently changed files light up (4 s).

Keep it under 8 MB (GitHub renders README images up to 10 MB). Record a video with any screen recorder, then
convert it with a two-pass palette for clean colors on the dark UI:

```bash
ffmpeg -i capture.mp4 -vf "fps=15,scale=1200:-1:flags=lanczos,palettegen=stats_mode=diff" palette.png
ffmpeg -i capture.mp4 -i palette.png -lavfi "fps=15,scale=1200:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4" demo.gif
```

## Quick captures from the test suite

`e2e/screenshots.spec.ts` captures the landing page and every explorer mode on the bundled demo repository
(the API is mocked, so no GitHub quota is used). It is handy for reviewing UI changes, not for the README, which
should show a real repository:

```bash
SCREENSHOTS=1 pnpm test:e2e screenshots
# → test-results/screenshots/landing-*.png and explorer-*.png

# Against a server that is already running, instead of building one:
E2E_BASE_URL=http://127.0.0.1:3000 SCREENSHOTS=1 pnpm test:e2e screenshots
```

## Brand assets

Logos live in `public/brand/` (`logo-dark.svg`, `logo-light.svg`, `logo-mark.svg`). `public/brand/social-preview.png`
is the site's Open Graph card exported at 1200 × 630; use it as the GitHub repository's social preview
(Settings → General → Social preview).
