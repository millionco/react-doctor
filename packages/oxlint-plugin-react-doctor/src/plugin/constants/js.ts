export const LOOP_TYPES = [
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
];

// Built-in JS globals whose method calls (`Math.floor(x)`,
// `Date.now()`, `JSON.parse(x)`, …) are not reactive reads and don't
// count as "expensive derivations". The chain root is what matters —
// `Math.floor(raw)` should only treat `raw` as a reactive read, and
// the call itself should be classified as trivial regardless of which
// method is invoked.
export const BUILTIN_GLOBAL_NAMESPACE_NAMES = new Set([
  "Math",
  "Date",
  "JSON",
  "Object",
  "Array",
  "Number",
  "String",
  "Boolean",
  "RegExp",
  "Symbol",
  "BigInt",
  "Reflect",
]);

// In-place Array.prototype mutators. These are the canonical "mutating"
// methods used to flag direct mutation of useState values (e.g. an
// `items` from `useState([])` that gets `.push()`ed). The immutable
// counterparts (toSorted/toReversed/toSpliced/with) are intentionally
// excluded; those return a new array.
export const MUTATING_ARRAY_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

export const CHAINABLE_ITERATION_METHODS = new Set(["map", "filter", "forEach", "flatMap"]);

// Method names that, when invoked on a non-`Object` receiver, yield a
// lazy iterator instead of an array. `arr.values()`, `map.entries()`,
// `set.keys()`, `urlSearchParams.values()`, etc. all surface as
// Iterator-helper-bearing iterators (`.filter()`/`.map()`/`.flatMap()`
// on them stay single-pass). The capital-`O` global `Object`'s
// `values`/`keys`/`entries` are eager and array-returning, so the
// detection in `js-combine-iterations` filters that receiver out.
export const ITERATOR_PRODUCING_METHOD_NAMES = new Set(["values", "keys", "entries"]);

// Vitest browser mode / Storybook test-runner / Playwright Component
// Testing conventionally put the React under-test in a `*.browser.tsx`
// (or `*.browser.jsx`) module. These files *render* the component and
// drive ordered interactions exactly like a `.test.tsx`, so
// `async-parallel` would false-positive on the canonical
// render/expect/click/expect rhythm.
export const BROWSER_TEST_FILE_PATTERN = /\.browser\.[cm]?[jt]sx?$/;

// Module identifiers whose presence in a file's imports proves the
// file is a test, story, or interaction-driving harness. Used by
// `async-parallel` to suppress the rule on files that aren't covered
// by the shared `isTestFilePath` path heuristic (e.g. a helper at
// `src/test-utils.ts` that imports `@testing-library/react`, or a
// Vitest browser fixture co-located with production code).
export const TEST_LIBRARY_IMPORT_SOURCES: ReadonlySet<string> = new Set([
  "vitest",
  "jest",
  "mocha",
  "chai",
  "sinon",
  "expect",
  "ava",
  "uvu",
  "node:test",
  "bun:test",
  "@testing-library/react",
  "@testing-library/react-native",
  "@testing-library/react-hooks",
  "@testing-library/dom",
  "@testing-library/user-event",
  "@testing-library/jest-dom",
  "@testing-library/vue",
  "@testing-library/svelte",
  "@testing-library/preact",
  "@testing-library/cypress",
  "playwright",
  "playwright-core",
  "@playwright/test",
  "@playwright/experimental-ct-react",
  "@playwright/experimental-ct-react17",
  "cypress",
  "@cypress/react",
  "@cypress/react18",
  "@storybook/test",
  "@storybook/test-runner",
  "@storybook/testing-library",
  "@storybook/jest",
  "puppeteer",
  "puppeteer-core",
  "webdriverio",
  "@wdio/globals",
  "@nuxt/test-utils",
]);

// Source-prefix matches catch sub-paths and scoped extensions that the
// `TEST_LIBRARY_IMPORT_SOURCES` set can't enumerate exhaustively
// (`vitest/browser`, `@vitest/spy`, `@playwright/test/reporter`, etc.).
// Every entry MUST end in `/` so the prefix can only match a subpath
// — a bare prefix like `@storybook/test` would also subsume
// `@storybook/test-runner` and `@storybook/testing-library`, both of
// which are already enumerated in the exact set above and may diverge
// independently in the future.
export const TEST_LIBRARY_IMPORT_SOURCE_PREFIXES: ReadonlyArray<string> = [
  "vitest/",
  "@vitest/",
  "@jest/",
  "@testing-library/",
  "@playwright/",
  "@storybook/test/",
  "@storybook/test-runner/",
  "@storybook/testing-library/",
  "@cypress/",
  "@nuxt/test-utils/",
];

// Callees that strongly signal an ordered UI-driving sequence —
// render/assert/click/assert flows that intentionally serialize
// each `await` to preserve cause-and-effect, NOT independent async
// I/O that should be parallelized with `Promise.all`. Membership is
// checked against the rightmost identifier in the callee chain so
// both `await render(...)` and `await screen.findByRole(...)` match.
export const ORDERED_UI_FLOW_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "render",
  "rerender",
  "renderHook",
  "renderToString",
  "renderToStaticMarkup",
  "act",
  "click",
  "dblClick",
  "dblclick",
  "tripleClick",
  "tap",
  "press",
  "longPress",
  "type",
  "clear",
  "fill",
  "focus",
  "blur",
  "hover",
  "unhover",
  "check",
  "uncheck",
  "selectOption",
  "selectOptions",
  "setChecked",
  "setInputFiles",
  "scrollIntoViewIfNeeded",
  "dragTo",
  "dragAndDrop",
  "drop",
  "evaluate",
  "evaluateHandle",
  "waitFor",
  "waitForLoadState",
  "waitForSelector",
  "waitForURL",
  "waitForResponse",
  "waitForRequest",
  "waitForEvent",
  "waitForFunction",
  "waitForElementToBeRemoved",
  "goto",
  "goBack",
  "goForward",
  "reload",
  "screenshot",
  "snapshot",
  "toMatchSnapshot",
  "toMatchInlineSnapshot",
  "expect",
  "expectTypeOf",
  "step",
  "describe",
  "test",
  "it",
  "beforeAll",
  "beforeEach",
  "afterAll",
  "afterEach",
  "play",
  "userEvent",
  "screen",
  "within",
]);

// `findBy*` / `findAllBy*` are the Testing Library async query family
// — `findByRole`, `findByText`, etc. Treat any callee whose rightmost
// identifier starts with `findBy` or `findAllBy` as a UI flow call,
// without having to enumerate every suffix.
export const ORDERED_UI_FLOW_CALLEE_PREFIXES: ReadonlyArray<string> = ["findBy", "findAllBy"];

// Callees that signal intentional pacing — animation tweens, demo
// sequencing, polling waits, throttles. Awaits on these are
// inherently serial: parallelizing a `sleep(200)` and a `sleep(400)`
// would defeat the point. Matches the rightmost identifier in the
// callee chain (so `await timer.tick(16)` matches "tick" and
// `await animations.spring(...)` matches "spring"). Kept in sync with
// the sister set in `async-await-in-loop`.
export const INTENTIONAL_SEQUENCING_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "sleep",
  "delay",
  "wait",
  "pause",
  "throttle",
  "debounce",
  "tick",
  "nextTick",
  "advanceTimersByTime",
  "advanceTimersByTimeAsync",
  "runAllTimers",
  "runAllTimersAsync",
  "runOnlyPendingTimers",
  "runOnlyPendingTimersAsync",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
  "animate",
  "transition",
  "spring",
  "tween",
  "stagger",
  "sequence",
  "timeline",
  "scrub",
]);
