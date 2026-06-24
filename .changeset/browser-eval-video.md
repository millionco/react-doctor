---
"react-doctor": patch
---

Add `--video [path]` to `browser eval` (and `video: "<path>.webm"` to the `browser_eval` MCP tool): record a `.webm` screen recording of the page while the expression runs, for playback. It works in any mode — plain `eval`, `--profile`, and `--codegen` — so a profiled run or a generated regression test can ship with a video you watch to verify what happened, and the saved path is reported in the summary (returned as `video` from the MCP tool). Uses Playwright's imperative screencast (1.59+), the only video API that records a CDP-attached page; encoding needs Playwright's bundled ffmpeg, so a missing one surfaces an actionable `npx playwright install ffmpeg` hint. Bumps the `playwright-core` floor to `^1.59.0` for the screencast API.
