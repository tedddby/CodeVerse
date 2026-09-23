# Media for the README

The project README references the files below. They must be real captures of a running CodeVerse build, never
mock-ups. Capture them after UI changes that make the current ones inaccurate.

| File                          | Shows                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `demo.gif`                    | The core journey in 20–30 s (see the storyboard below)                            |
| `screenshot-architecture.png` | Architecture mode on a well-known repository, a district focused, labels readable |
| `screenshot-dependencies.png` | Dependencies mode with a selected file and its import arcs                        |
| `screenshot-source.png`       | The source viewer open on a selected file, a symbol highlighted                   |

## Capture setup

- Production build: `pnpm build && pnpm start`, with a `GITHUB_TOKEN` so history is complete.
- Browser window at **1440 × 900**, device pixel ratio 2 for screenshots; no extensions or bookmarks bar visible.
- Use a real, well-known public repository (for example `vercel/next.js` or `facebook/react`) and mention it in
  the image's alt text. Do not edit, composite or retouch the UI.

## `demo.gif` storyboard

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

The Playwright suite can capture the explorer on the bundled demo repository, which is handy for reviewing UI
changes (not for the README, which should show a real repository):

```bash
SCREENSHOTS=1 pnpm test:e2e screenshots
# → test-results/screenshots/landing-*.png and explorer-*.png
```

## Brand assets

Logos live in `public/brand/` (`logo-dark.svg`, `logo-light.svg`, `logo-mark.svg`). `public/brand/social-preview.png`
is the site's Open Graph card exported at 1200 × 630; use it as the GitHub repository's social preview
(Settings → General → Social preview).
