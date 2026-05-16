---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Suppress `async-parallel` advice in tests, browser fixtures, and
ordered UI flows. The rule previously used a narrow local
`TEST_FILE_PATTERN` that only matched `*.test.*`, `*.spec.*`, and
`*.stories.*` suffixes — so it false-positived on `*.browser.tsx`
Vitest browser fixtures, files under `tests/`, `test/`, `__tests__/`,
`e2e/`, `playwright/`, `cypress/`, fixture, or mock directories,
production-co-located helpers that import a test runner, and the
canonical `render → expect → click → expect` rhythm.

`async-parallel` is now tagged `test-noise`, so the shared
`isTestFilePath()` heuristic in `mergeAndFilterDiagnostics` filters
every path it already understands (`__tests__/`, `tests/`, `test/`,
`__mocks__/`, `cypress/`, `e2e/`, `playwright/`, the full
`*.test/spec/stories/story/fixture/fixtures.*` suffix family, and
Windows-slashed equivalents).

On top of the path filter, the rule itself now:

- Skips `*.browser.[jt]sx?` Vitest browser-mode / Storybook
  test-runner / Playwright Component Testing fixtures.
- Skips any file whose imports include a known test runner,
  assertion library, or interaction driver — `vitest` (including
  `vitest/browser` and `@vitest/*`), `jest` and `@jest/*`, `mocha`,
  `chai`, `sinon`, `ava`, `uvu`, `node:test`, `bun:test`, every
  `@testing-library/*` package, `playwright` / `@playwright/*` /
  `playwright-core`, `cypress` / `@cypress/*`, `@storybook/test*`
  and `@storybook/testing-library`, `puppeteer`, `webdriverio`,
  `@nuxt/test-utils`, and friends.
- Skips a consecutive-await block as soon as one of its awaits is
  an ordered UI-flow call (`render`, `expect`, `click`, `fill`,
  `findByRole`, `findAllByText`, `userEvent.click`, `page.goto`,
  `page.locator(...).click()`, `waitFor`, `step`, …) — collapsing
  such a block into `Promise.all([...])` would change observable
  behavior.
- Skips a block as soon as one of its awaits is an intentional
  sequencing call (`sleep`, `delay`, `wait`, `pause`, `animate`,
  `transition`, `spring`, `tween`, `tick`, `advanceTimersByTime`,
  …), matching the sister set in `async-await-in-loop`.

Authors who want to keep a serial sequence without any of those
signals can still opt out per-block with a documented
`// oxlint-disable-next-line react-doctor/async-parallel -- <reason>`
comment.
