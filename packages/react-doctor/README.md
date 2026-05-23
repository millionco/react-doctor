<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

Your agent writes bad React, this catches it.

One command scans your codebase and outputs a **0 to 100 health score** with actionable diagnostics.

Works with Next.js, Vite, and React Native.

### [See it in action →](https://react.doctor)

> **React Doctor vs React Review.** React Doctor is the local-first **CLI and lint plugins** in this repo: offline-friendly, scriptable, runs anywhere. React Review is the hosted product on [react.doctor](https://react.doctor) (GitHub App, dashboard, PR comments, baseline / delta tracking). They share the same rule set; pick the CLI when you want a one-shot scan or self-hosted CI, and add React Review when you also want a hosted dashboard and review team workflow. Already using the CLI? React Review augments it without replacing it.

## Install

Run this at your project root:

```bash
npx react-doctor@latest
```

You'll get a score (75+ Great, 50 to 74 Needs work, under 50 Critical) and a list of issues across state & effects, performance, architecture, security, and accessibility. Rules toggle automatically based on your framework and React version.

> **Migration note:** React Doctor used to bundle [knip](https://knip.dev/) for dead-code detection. That integration was removed in v0.2 — if you want dead-code analysis, run `npx knip` directly as part of your own pre-commit or CI pipeline.

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

## Install for your coding agent

Teach your coding agent React best practices so it stops writing the bad code in the first place.

```bash
npx react-doctor@latest install
```

You'll be prompted to pick which detected agents to install for. Pass `--yes` to skip prompts.

Works with Claude Code, Cursor, Codex, OpenCode, and 50+ other agents.

## GitHub Actions

Two composite actions ship with this repository.

### PR Review (recommended)

The root action mirrors the hosted [react.review](https://react.review) bot's doctor-only flow as a self-hosted action: inline diagnostics on net-new violations, a sticky summary comment, automatic thread resolution when fixes land, and a check run on the PR head SHA. No hosted service required.

```yaml
name: React Doctor Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  checks: write
  issues: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      # The `ref` line is required: `actions/checkout` on `pull_request`
      # defaults to the synthetic merge commit, so HEAD would
      # disagree with `pull_request.head.sha` (the SHA the action
      # annotates) and diagnostic line numbers wouldn't match what
      # GitHub shows in the PR diff.
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: millionco/react-doctor@main
```

**Inputs:** `token` (defaults to `${{ github.token }}`; pass a PAT or App installation token for fork PRs or branded identity), `directory` (project directory, defaults to `.`), `node-version` (defaults to `22`). See [`action.yml`](https://github.com/millionco/react-doctor/blob/main/action.yml) for full descriptions.

The Review action diffs head diagnostics against the merge-base, posts inline comments only on errors that landed on `+` lines in the PR's diff, and resolves threads with `✅ Addressed in <sha>` when the underlying diagnostic disappears.

### Scan + sticky comment (legacy)

The older composite action (a single `npx react-doctor` scan with an optional sticky PR comment) lives at [`actions/inspect/action.yml`](https://github.com/millionco/react-doctor/blob/main/actions/inspect/action.yml):

```yaml
name: React Doctor

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write # required to post PR comments

jobs:
  react-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # required for `diff`
      - uses: millionco/react-doctor/actions/inspect@main
        with:
          diff: main
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

When `github-token` is set on `pull_request` events, findings are posted (and updated) as a sticky PR comment. The action also exposes a `score` output (0–100) you can read in subsequent steps — see [PR blocking and exit codes](#pr-blocking-and-exit-codes) for a score-floor recipe.

**Inputs:** `directory`, `verbose`, `project`, `diff`, `github-token`, `fail-on` (`error` / `warning` / `none`), `offline`, `annotations`, `node-version`. See [`action.yml`](https://github.com/millionco/react-doctor/blob/main/action.yml) for full descriptions.

#### PR feedback modes

Pick one or both; they're independent.

- **Comments only** (default): set `github-token`.
- **Annotations only**: set `annotations: true`.
- **Both**: set `github-token` and `annotations: true`. Annotation lines are stripped from the comment body.

```yaml
- uses: millionco/react-doctor/actions/inspect@main
  with:
    diff: main
    github-token: ${{ secrets.GITHUB_TOKEN }}
    annotations: true
```

Prefer not to add a marketplace action? The bare `npx` form works too:

```yaml
- run: npx react-doctor@latest --fail-on warning
```

## Release versioning

React Doctor ships a few related artifacts. Each one has its own version, and the table below is the mapping you should refer to when pinning.

| Artifact                                                    | Where to find the version                                   | Example pin                              |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `react-doctor` npm package (the CLI and Node API)           | [npm](https://npmjs.com/package/react-doctor)               | `npx react-doctor@0.2.3`                 |
| `oxlint-plugin-react-doctor` / `eslint-plugin-react-doctor` | [npm](https://npmjs.com/package/oxlint-plugin-react-doctor) | `"oxlint-plugin-react-doctor": "^0.2.3"` |
| `millionco/react-doctor` GitHub composite action            | git refs on this repo (`@main` or version tag)              | `uses: millionco/react-doctor@main`      |
| `react.doctor` hosted Review                                | the hosted dashboard auto-updates; no pin is required       | n/a                                      |

The composite action is referenced as `@main` by default, which tracks the latest commit on the canonical branch. If you want a pinned action ref instead, every published `react-doctor@X.Y.Z` release also pushes a matching `vX.Y.Z` tag and moves the floating `vX` / `vX.Y` tags to that commit, so `@v0`, `@v0.2`, and `@v0.2.3` all resolve. Pin tighter when you need reproducible scores across releases (see [Scoring](#scoring)).

> **Pinning the action ref doesn't pin the CLI version.** The composite action invokes `npx react-doctor@latest` internally, so the action ref pins the **workflow shape** (inputs, comment plumbing, score collection), not the **CLI version** running underneath. For genuinely deterministic scores in CI, also pin the CLI side: either run `npx react-doctor@0.2.3 ...` in a bare `- run:` step, or add `"react-doctor": "0.2.3"` to your project's dev deps and invoke it through `pnpm exec` / `npm exec`.

Each release ships with the changeset-generated changelog. Material rule additions, severity changes, or score-formula tweaks are called out there so you can read the expected score impact before bumping a pin.

## PR blocking and exit codes

Two independent gates can block a PR — pick one or both:

- **`--fail-on <level>`** exits non-zero on diagnostics: `error` (default, any error-severity rule fires), `warning` (any diagnostic fires), or `none` (never). Runs against the `ciFailure` surface, so the default `design`-tag exclusion still applies.
- **Score floor** — a follow-up step that reads the action's `score` output and `exit 1`s when it's below your threshold.

Combine `--fail-on` with `--diff <base>` to scope the gate to the PR's changed files only — that's the built-in way to fail on **new** regressions without dragging in baseline backlog. There is no separate `--fail-on-new` flag.

`--annotations` (bare `npx` only) and `github-token` (sticky PR comment) are visualization layers and never change the exit code.

### Examples

**Advisory mode** — never blocks, always comments:

```yaml
- uses: millionco/react-doctor/actions/inspect@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on: none
```

**Regression-only mode** — fail only on new diagnostics introduced by the PR:

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0 # required for `diff`
- uses: millionco/react-doctor/actions/inspect@main
  with:
    diff: main
    fail-on: warning
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

**Strict threshold mode** — fail when the baseline score drops below a floor:

```yaml
- id: doctor
  uses: millionco/react-doctor/actions/inspect@main
  with:
    fail-on: error
    github-token: ${{ secrets.GITHUB_TOKEN }}
- env:
    SCORE: ${{ steps.doctor.outputs.score }}
    FLOOR: "80"
  run: |
    # `score` is best-effort and may be empty (e.g. when offline is on).
    # Skip the floor when it's empty so unrelated PRs aren't blocked.
    if [ -z "$SCORE" ]; then
      echo "::notice::React Doctor score unavailable — skipping floor check"
      exit 0
    fi
    if [ "$SCORE" -lt "$FLOOR" ]; then
      echo "::error::React Doctor score $SCORE is below floor $FLOOR"
      exit 1
    fi
```

Pin a specific `react-doctor` version when using a score floor — new rule releases can lower the score even when your code hasn't changed (see [Scoring](#scoring)).

## Configuration

Create a `react-doctor.config.json` in your project root:

```json
{
  "ignore": {
    "rules": ["react-doctor/no-danger", "react-doctor/no-autofocus"],
    "files": ["src/generated/**"],
    "overrides": [
      {
        "files": ["components/modules/diff/**"],
        "rules": ["react-doctor/no-array-index-as-key", "react-doctor/no-render-in-render"]
      },
      {
        "files": ["components/search/HighlightedSnippet.tsx"],
        "rules": ["react-doctor/no-danger"]
      }
    ]
  }
}
```

Three nested keys, three layers of granularity — pick the narrowest one that fits:

- **`ignore.rules`** silences a rule across the whole codebase.
- **`ignore.files`** silences **every** rule on the matched files (use sparingly — it loses coverage for unrelated rules).
- **`ignore.overrides`** silences only the listed rules on the matched files, leaving every other rule active. This is what you want when a single file (or glob) legitimately needs an exemption from one or two rules but should still be scanned for everything else.

You can also use the `"reactDoctor"` key in `package.json`. CLI flags always override config values.

React Doctor respects `.gitignore`, `.eslintignore`, `.oxlintignore`, `.prettierignore`, and `linguist-vendored` / `linguist-generated` annotations in `.gitattributes`. Inline `// eslint-disable*` and `// oxlint-disable*` comments are honored too.

If you have a JSON oxlint or eslint config (`.oxlintrc.json` or `.eslintrc.json`), its rules get merged into the scan automatically and count toward the score. Set `adoptExistingLintConfig: false` to opt out.

#### Surface controls (CLI, PR comments, score, CI failure)

Diagnostics flow through four independent surfaces — `cli`, `prComment`, `score`, and `ciFailure` — and each one can be tuned per tag, category, or rule id. By default the `design` tag (Tailwind shorthand cleanup like `w-5 h-5 → size-5`, pure-black backgrounds, gradient text, …) stays visible on the local CLI but is excluded from the PR comment, the score, and the `--fail-on` gate so style cleanup can't dilute meaningful React findings:

```json
{
  "surfaces": {
    "prComment": {
      "includeTags": ["design"],
      "excludeCategories": ["Performance"]
    },
    "score": { "includeRules": ["react-doctor/design-no-redundant-size-axes"] },
    "ciFailure": { "excludeTags": ["test-noise"] }
  }
}
```

Each surface accepts `includeTags`, `excludeTags`, `includeCategories`, `excludeCategories`, `includeRules`, and `excludeRules`. Include wins over exclude when both match. Run the CLI with `--pr-comment` (the GitHub Action passes it automatically when `github-token` is set) to apply the `prComment` surface to the printed output destined for sticky PR comments.

#### Rule severity (`rules`, `categories`)

Same shape as ESLint / oxlint. `rules` is ESLint's exact field; `categories` mirrors oxlint's, keyed by React Doctor display categories (`"React Native"`, `"Server"`, `"Architecture"`, …).

```json
{
  "rules": { "react-doctor/no-array-index-as-key": "error" },
  "categories": { "React Native": "warn" }
}
```

Per-rule wins over per-category. `"off"` short-circuits before the rule runs; `"warn"` / `"error"` re-stamps the diagnostic so every channel — CLI, PR comment, score, `--fail-on` — sees the chosen severity, including for external-plugin rules. Use `surfaces` instead when you only want to hide a rule from one channel; use `ignore.tags` to silence a whole tag-defined family (`"design"`, `"test-noise"`, `"migration-hint"`) that doesn't align with a single category.

#### Optional companion plugins

When the following ESLint plugins are installed in the scanned project (or hoisted in your monorepo), React Doctor folds their rules into the same scan. Listed as **optional peer dependencies** — install only what you want.

| Plugin                                                                                            | Adds                                                                                                      | Namespace          |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| [`eslint-plugin-react-hooks`](https://www.npmjs.com/package/eslint-plugin-react-hooks) (v6 or v7) | The React Compiler frontend's correctness rules — fired when a React Compiler is detected in the project. | `react-hooks-js/*` |

The 8 rules from [`eslint-plugin-react-you-might-not-need-an-effect`](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect) (NickvanDyke, MIT) are now ported natively into React Doctor — they fire as `react-doctor/no-derived-state`, `react-doctor/no-chain-state-updates`, `react-doctor/no-event-handler`, `react-doctor/no-adjust-state-on-prop-change`, `react-doctor/no-reset-all-state-on-prop-change`, `react-doctor/no-pass-live-state-to-parent`, `react-doctor/no-pass-data-to-parent`, and `react-doctor/no-initialize-state`. No peer dependency required.

### Inline suppressions

```tsx
// react-doctor-disable-next-line react-doctor/no-cascading-set-state
useEffect(() => {
  setA(value);
  setB(value);
}, [value]);
```

When two rules fire on the same line, you have two equivalent options. Comma-separate the rule ids on a single comment:

```tsx
// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers, react-doctor/no-derived-useState
const [localSearch, setLocalSearch] = useState(searchQuery);
```

Or stack one comment per rule directly above the diagnostic. Stacked comments are honored as long as nothing but other `react-doctor-disable-next-line` comments sits between them and the target line:

```tsx
// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers
// react-doctor-disable-next-line react-doctor/no-derived-useState
const [localSearch, setLocalSearch] = useState(searchQuery);
```

A code line between stacked comments breaks the chain: only the comment immediately above the diagnostic (and any contiguous `react-doctor-disable-next-line` comments stacked on top of it) is honored. If a comment looks adjacent but the rule still fires, run `react-doctor --explain <file:line>` — it reports whether a nearby suppression was found, what rules it covers, and why it didn't apply.

Block comments work inside JSX:

<!-- prettier-ignore -->
```tsx
{/* react-doctor-disable-next-line react-doctor/no-danger */}
<div dangerouslySetInnerHTML={{ __html }} />
```

For multi-line JSX, putting the comment immediately above the opening tag covers the entire attribute list (matching ESLint convention).

## Custom rules (user plugins)

Drop your own oxlint-shaped plugin into `react-doctor.config.json`'s `plugins` field and react-doctor runs your rules alongside the built-in ones. Useful for team-specific conventions ("no `<Box>` outside `packages/ui`", "all API calls go through `lib/client`", etc.) that don't belong upstream.

### 1. Write the plugin

Create a file anywhere in your repo. The shape is the oxlint plugin contract — a default-exported `{ meta: { name }, rules: { ... } }`. Each rule's `create(context)` returns ESTree-style visitors.

```js
// lint/team-conventions.cjs
const noBareFetchRule = {
  create: (context) => ({
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "fetch") {
        context.report({
          node,
          message:
            "Use `lib/client.request()` instead of bare `fetch` — keeps auth + tracing consistent.",
        });
      }
    },
  }),
};

module.exports = {
  meta: { name: "team-conventions" },
  rules: {
    "no-bare-fetch": noBareFetchRule,
  },
};
```

For a richer authoring experience (TypeScript types, severity defaults, recommendation strings, category metadata, the `defineRule` helper), install [`oxlint-plugin-react-doctor`](https://npmjs.com/package/oxlint-plugin-react-doctor) and import `defineRule` + the `RulePlugin` types — the built-in plugin uses the same SDK.

### 2. Register the plugin in `react-doctor.config.json`

`plugins` accepts either a **relative path** (resolved relative to the config file) or an **npm package name**:

```json
{
  "plugins": ["./lint/team-conventions.cjs", "react-doctor-plugin-shopify-conventions"],
  "rules": {
    "team-conventions/no-bare-fetch": "error",
    "shopify-conventions/use-polaris-tokens": "warn"
  }
}
```

### 3. Run

`npx react-doctor .` picks up the plugin and flows its diagnostics through every surface (CLI / PR comment / score / `--fail-on` gate) the same as built-in rules.

### Notes

- **Opt-in by default**: a user-plugin rule only runs when `rules: { "<plugin-name>/<rule>": "warn" | "error" }` explicitly enables it. Mirrors how `defaultEnabled: false` built-in rules behave so installing a third-party plugin doesn't surprise you with a flood of new diagnostics on the first scan.
- **`meta.name` is required**: rule keys are `<plugin.meta.name>/<rule-name>`. A plugin without `meta.name` is rejected (with a warning) so rule keys in `config.rules` can't silently change when a file gets renamed.
- **Failure tolerance**: a plugin entry that can't be resolved or doesn't look like an oxlint plugin logs a warning to stderr and is skipped — your scan keeps going.
- **Per-rule severity / ignore / surfaces**: every existing severity / ignore / surface knob (`rules`, `categories`, `ignore.{paths, rules, tags}`, `surfaces.{cli, prComment, score, ciFailure}`) treats user-plugin rules the same as built-in rules. You can demote a user-plugin rule out of CI without touching the rule's source.

## Lint plugin (standalone)

The same rule set ships as both an oxlint plugin and an ESLint plugin, so you can wire it into whichever lint engine your project already runs. These are published as separate packages, so you can install just the lint integration without pulling in the full CLI.

**oxlint** in `.oxlintrc.json` (install [`oxlint-plugin-react-doctor`](https://npmjs.com/package/oxlint-plugin-react-doctor)):

```jsonc
{
  "jsPlugins": [{ "name": "react-doctor", "specifier": "oxlint-plugin-react-doctor" }],
  "rules": {
    "react-doctor/no-fetch-in-effect": "warn",
    "react-doctor/no-derived-state-effect": "warn",
  },
}
```

**ESLint** flat config (install [`eslint-plugin-react-doctor`](https://npmjs.com/package/eslint-plugin-react-doctor)):

```js
import reactDoctor from "eslint-plugin-react-doctor";

export default [
  reactDoctor.configs.recommended,
  reactDoctor.configs.next,
  reactDoctor.configs["react-native"],
  reactDoctor.configs["tanstack-start"],
  reactDoctor.configs["tanstack-query"],
];
```

The full rule list lives in [`packages/oxlint-plugin-react-doctor/src/plugin/rules`](https://github.com/millionco/react-doctor/tree/main/packages/oxlint-plugin-react-doctor/src/plugin/rules).

## CLI reference

```
Usage: react-doctor [directory] [options]

Options:
  -v, --version           display the version number
  --no-lint               skip linting
  --verbose               show every rule and per-file details (default shows top 3 rules)
  --score                 output only the score
  --json                  output a single structured JSON report
  -y, --yes               skip prompts, scan all workspace projects
  --full                  skip prompts, always run a full scan
  --project <name>        select workspace project (comma-separated for multiple)
  --diff [base]           scan only files changed vs base branch
  --staged                scan only staged files (for pre-commit hooks)
  --offline               skip the score API and share URL (no score shown)
  --fail-on <level>       exit with error on diagnostics: error, warning, none
  --annotations           output diagnostics as GitHub Actions annotations
  --pr-comment            tune CLI output for sticky PR comments (drops design
                          cleanup from the printed list and fail-on gate)
  --explain <file:line>   diagnose why a rule fired or why a suppression didn't apply
  --why <file:line>       alias for --explain
  -h, --help              display help
```

When a suppression isn't working, `--explain <file:line>` (or its alias `--why <file:line>`) reports what the scanner sees at that location, including why a nearby `react-doctor-disable-next-line` didn't apply. The diagnosis distinguishes the common failure modes — adjacent comment for a different rule (use the comma form), a code line between the comment and the diagnostic (the chain is broken), or no nearby suppression at all. The same hint surfaces inline with `--verbose` for every flagged site, and in `--json` output as `diagnostic.suppressionHint`, so a single scan doubles as a suppression audit without a separate flag.

`--json` produces a parsable object on stdout with all human-readable output suppressed. Errors still produce a JSON object with `ok: false`, so stdout is always a valid document.

### Config keys

| Key                        | Type                             | Default  |
| -------------------------- | -------------------------------- | -------- |
| `ignore.rules`             | `string[]`                       | `[]`     |
| `ignore.files`             | `string[]`                       | `[]`     |
| `ignore.overrides`         | `{ files, rules? }[]`            | `[]`     |
| `lint`                     | `boolean`                        | `true`   |
| `verbose`                  | `boolean`                        | `false`  |
| `diff`                     | `boolean \| string`              |          |
| `failOn`                   | `"error" \| "warning" \| "none"` | `"none"` |
| `customRulesOnly`          | `boolean`                        | `false`  |
| `share`                    | `boolean`                        | `true`   |
| `offline`                  | `boolean`                        | `false`  |
| `textComponents`           | `string[]`                       | `[]`     |
| `rawTextWrapperComponents` | `string[]`                       | `[]`     |
| `serverAuthFunctionNames`  | `string[]`                       | `[]`     |
| `respectInlineDisables`    | `boolean`                        | `true`   |
| `adoptExistingLintConfig`  | `boolean`                        | `true`   |
| `ignore.tags`              | `string[]`                       | `[]`     |

`textComponents` is the broad escape hatch for `rn-no-raw-text` — list components that themselves behave like React Native's `<Text>` (custom `Typography`, `NativeTabs.Trigger.Label`, etc.) and the rule will treat them as text containers regardless of what their children look like.

`rawTextWrapperComponents` is the narrower option for components that are not text elements but safely route string-only children through an internal `<Text>` (e.g. `heroui-native`'s `Button`, which stringifies its children and renders them through a `ButtonLabel`). Listed wrappers suppress `rn-no-raw-text` only when their children are entirely stringifiable. A wrapper with mixed children — e.g. `<Button>Save<Icon /></Button>` — still reports because the wrapper can't safely route raw text alongside a sibling JSX element.

`serverAuthFunctionNames` teaches `server-auth-actions` about custom auth guards your codebase wraps around its auth library (e.g. `requireWorkspaceMember`, `ensureSignedIn`). Listed names are accepted as a valid top-of-action auth check whether called bare (`requireWorkspaceMember()`) or as a member (`guards.requireWorkspaceMember()`), and — unlike the built-in default list — are treated as distinctive so the receiver is not re-validated.

`ignore.tags` suppresses entire categories of rules by tag. For example, `"tags": ["design"]` disables all opinionated design rules (gradient text, pure black backgrounds, side tab borders, default Tailwind palettes). Available tags: `"design"`.

`offline` skips the score API entirely — no score is shown and no share URL is generated. CI runs (GitHub Actions, GitLab CI, CircleCI) are not offline by default; only the share URL is suppressed. Set `offline: true` (or `--offline`) explicitly when you want zero network.

### React Native support matrix

`rn-*` rules cover the React Native ecosystem in addition to React DOM. Detection keys off `package.json` dependencies (or their hoisted equivalents) plus file-extension hints:

| Stack / runtime                                                                              | Detection signal (in `package.json` or workspace)                                                                                   | `rn-*` rules |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | :----------: |
| React Native CLI                                                                             | `react-native` dependency                                                                                                           |      ON      |
| React Native tvOS                                                                            | `react-native-tvos`                                                                                                                 |      ON      |
| Expo (managed and bare)                                                                      | `expo`, `expo-router`, any `@expo/*`                                                                                                |      ON      |
| React Native for Windows / macOS                                                             | `react-native-windows`, `react-native-macos`                                                                                        |      ON      |
| Out-of-tree React Native targets                                                             | Any `@react-native/*` or `@react-native-*` package (e.g. `@react-native-firebase/app`, `@react-native-async-storage/async-storage`) |      ON      |
| Metro-based projects without an `expo` / `react-native` dep                                  | Top-level `"react-native"` resolution field in `package.json`                                                                       |      ON      |
| Web-only React (Next.js, Vite, CRA, Gatsby, Remix, Docusaurus, Storybook, plain `react-dom`) | `next`, `vite`, `react-scripts`, `gatsby`, `@remix-run/*`, `@docusaurus/*`, `@storybook/*`, `react-dom` (without an RN sibling)     |     OFF      |
| `*.web.tsx` / `*.web.jsx` files in an RN package                                             | File extension                                                                                                                      |  OFF (file)  |
| `*.ios.tsx` / `*.android.tsx` / `*.native.tsx` files                                         | File extension                                                                                                                      |  ON (file)   |

Mixed monorepos work both ways: a web-rooted workspace with even one RN package gets the `rn-*` rules loaded, then file-level boundaries keep them silent on the web workspaces. The configuration knob `rawTextWrapperComponents` lets you teach `rn-no-raw-text` about library components that safely route string children through an internal `<Text>` (e.g. `heroui-native`'s `Button`); `textComponents` is the broader escape hatch for components that behave like `<Text>` themselves.

### React Native rules in mixed monorepos

`rn-*` rules respect per-package boundaries automatically. In a mixed React Native + web monorepo (`apps/mobile` alongside `apps/web` / `apps/vite-app` / `packages/storybook` / `apps/docs`), every `rn-*` rule walks up to the file's nearest `package.json` before running:

- Packages that declare `react-native`, `react-native-tvos`, `expo`, `expo-router`, `@expo/*`, `react-native-windows`, `react-native-macos`, anything under the `@react-native/` or `@react-native-` namespaces (`@react-native-firebase/app`, `@react-native-async-storage/async-storage`, …), or Metro's top-level `"react-native"` resolution field → rules ON.
- Packages that declare a web-only framework (`next`, `vite`, `react-scripts`, `gatsby`, `@remix-run/*`, `@docusaurus/*`, `@storybook/*`, or plain `react-dom` without an RN sibling) → rules OFF.
- Packages with no clear local signal → fall back to the project-level framework detection.

File extensions override the package classification when they're unambiguous: `*.web.tsx` / `*.web.jsx` are always skipped (Metro resolves these only against `react-native-web`); `*.ios.tsx` / `*.android.tsx` / `*.native.tsx` are always scanned (mobile-only).

The detection is bidirectional: a web-rooted monorepo (root `package.json` declares `next` or `vite`) still loads the `rn-*` rules when any workspace targets React Native — the file-level boundary then keeps them silent on the web workspaces and active on the mobile ones.

`rn-no-raw-text` additionally short-circuits raw text inside platform-fork branches:

- `if (Platform.OS === "web") { … }` consequent — and the `else` branch of `if (Platform.OS !== "web")`.
- `Platform.OS === "web" ? <X /> : …` ternaries, `Platform.OS === "web" && <X />` short-circuits, and the reversed-operand form `"web" === Platform.OS`.
- `switch (Platform.OS) { case "web": … }` case bodies (other cases still report).
- `Platform.select({ web: <X />, default: <Y /> })` — only the `web` arm is exempt.
- `Platform?.OS === "web"` (optional chain) and `Platform.OS! === "web"` (TS non-null assertion) parse the same way as the bare form.

The walker stops at function and `Program` boundaries — JSX defined inside a callback hoisted out of a `Platform.OS` branch does not inherit the parent guard. Negative platform checks like `Platform.OS === "ios"` are deliberately NOT treated as web exemptions; only the explicit web branch is.

## Scoring

The health score formula: `100 - (unique_error_rules x 1.5) - (unique_warning_rules x 0.75)`.

Scoring runs on react.doctor's API and is **network-dependent**: without a successful API round-trip (or under `--offline`) the score is omitted and the rest of the report still renders normally. Score-based automation must treat an empty value as a no-op (see the strict-threshold example above). Key details:

- The score counts **unique rules triggered**, not total instances. Fixing 49 of 50 `no-barrel-import` violations does not change the score; fixing all 50 removes the 0.75 penalty for that rule.
- Error-severity rules cost 1.5 points each. Warning-severity rules cost 0.75 points each.
- Category breakdowns shown in the output are for display only and do not weight the score.

Score labels: 75+ is **Great**, 50 to 74 is **Needs work**, under 50 is **Critical**.

Scores may decrease across releases as new rules are added. Each new rule that fires in your codebase introduces an additional penalty. This is expected: it means the tool is catching more issues, not that your code got worse. Don't chase 100/100 blindly; the score is a signal to investigate, not a target.

When a release moves your score noticeably:

- Check the per-release changelog for added rules, severity changes, or formula tweaks. Each release ships with the changeset-generated notes.
- Compare the `unique rules triggered` list against the previous run. A single new rule firing once can subtract 1.5 points.
- Pin to a specific `react-doctor` version in CI (see [Release versioning](#release-versioning)) if you need stable scores across upgrades. Pinning the action ref alone is not enough; pin the CLI side too.
- If a newly fired rule looks noisy in your codebase, `--explain <file:line>` (or `--why`) prints exactly which rule it is and the suppression snippet to silence it. See [Inline suppressions](#inline-suppressions) and [Configuration](#configuration).

## Diff and staged modes

React Doctor can scan only changed files instead of the full project:

- **`--diff [base]`** scans files changed vs a base branch. Auto-detects `main`/`master`, or pass an explicit branch: `--diff develop`. Also available as a config key: `"diff": true` or `"diff": "develop"`.
- **`--staged`** scans only files in the git staging area (index). Designed for pre-commit hooks — materializes staged file contents into a temp directory so the scan reflects exactly what will be committed.
- **`--full`** forces a full scan, overriding any `diff` value in config or CLI.

When on a feature branch without explicit flags, you'll be prompted: "Only scan changed files?" This prompt is suppressed in CI, `--json` mode, and non-interactive environments.

`--staged` and `--diff` cannot be combined.

### Pre-commit hooks with Husky + lint-staged

The most common setup is [Husky](https://typicode.github.io/husky/) for the git hook and [lint-staged](https://github.com/lint-staged/lint-staged) to filter which files run through each tool. React Doctor's `--staged` mode is built for this: it reads file contents from the git **index** (not the working tree) and materializes them into a temp directory, so partially-staged files are scanned exactly as they will be committed.

Install both, then wire them up:

```bash
npx ni -D husky lint-staged
npx husky init
```

`husky init` creates `.husky/pre-commit`. Replace its contents with:

```bash
npx lint-staged
```

Then add a `lint-staged` block to your `package.json`. Because React Doctor already filters to the staged set via `--staged`, **do not pass the lint-staged-injected file list** — invoke it with a single command and let it discover the index itself:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": "react-doctor --staged --fail-on warning"
  }
}
```

A few notes that bite people:

- **Don't append `{staged-files}`** — lint-staged would otherwise pass the matched paths as positional arguments and you'd get the union (path filter + index scan) instead of the intent.
- **Use the function form when you only want the hook to run if any matching file is staged** but still want a single project-wide scan:

  ```js
  // lint-staged.config.js
  export default {
    "*.{ts,tsx,js,jsx}": () => "react-doctor --staged --fail-on warning",
  };
  ```

- **`--fail-on warning`** blocks the commit on any diagnostic. Use `--fail-on error` for a softer gate, or `--fail-on none` to lint advisory-only.
- **Index vs. working tree:** `--staged` reflects `git diff --cached`, not your editor buffer. If you `git add` half a file and keep typing, only the added half is scanned — the unstaged tail is ignored.
- **Skip in CI:** lint-staged is a pre-commit concern. In CI, use the GitHub Action (above) or `react-doctor --diff <base>` directly; running both does duplicate work.
- **Other hook managers:** the same `react-doctor --staged --fail-on warning` command works under [Lefthook](https://lefthook.dev/), [pre-commit](https://pre-commit.com/), or a hand-written `.git/hooks/pre-commit` — `--staged` is hook-manager-agnostic.

To bypass the hook for a one-off commit, use `git commit --no-verify`.

## Agent and CI integration

React Doctor detects 50+ coding agents (Claude Code, Cursor, Codex, OpenCode, Windsurf, and more) and adapts its behavior automatically:

- **Install for agents**: `npx react-doctor@latest install` writes agent-specific rule files (SKILL.md, AGENTS.md, .cursorrules) into your project so agents learn React best practices.
- **JSON output**: `--json` produces a structured `JsonReport` on stdout. Errors still produce a valid JSON document with `ok: false`. Use `--json-compact` for minimal whitespace.
- **Score-only output**: `--score` outputs just the numeric score (0-100), useful for threshold checks in agent loops.
- **GitHub Actions annotations**: `--annotations` emits `::error` / `::warning` format for inline PR annotations. Annotations don't change the exit code.
- **Exit codes**: `--fail-on error` (default) exits non-zero when error-severity diagnostics are found. Use `--fail-on warning` or `--fail-on none` to tune CI gating. See [PR blocking and exit codes](#pr-blocking-and-exit-codes) for the full model — including how to fail only on new regressions vs. fail on the baseline score.
- **Programmatic API**: `import { diagnose } from "react-doctor/api"` for direct integration in scripts and automation.

In CI environments, prompts are automatically skipped. Pass `--offline` explicitly when you need zero network.

### Non-GitHub CI (GitLab, Bitbucket, CircleCI, Jenkins, …)

The composite action is GitHub-specific, but everything it does is built on top of the CLI; there's nothing GitHub-only about React Doctor itself. For other providers, run the CLI directly and consume the JSON report from your existing tooling:

```bash
npx react-doctor@latest --diff "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --fail-on warning --json > react-doctor.json
```

The JSON document is the same one the action consumes (`{ ok, score, diagnostics[], summary, project }`). Any CI dashboard that accepts a parsed report can read it. Three common patterns:

- **GitLab CI**: invoke the CLI in a `merge_request` job and surface `react-doctor.json` as a [Code Quality report artifact](https://docs.gitlab.com/ci/testing/code_quality.html) by translating diagnostics into the GitLab Code Quality JSON shape. Until a first-class GitLab integration ships, this is the recommended path.
- **CircleCI / Jenkins / Buildkite**: fail the step on a non-zero exit (`--fail-on warning`) and upload `react-doctor.json` as an artifact. Read `summary.errorCount` / `summary.warningCount` in a follow-up step for thresholding.
- **Pre-merge gates without a dashboard**: `--diff <base> --fail-on warning` is enough; the build log carries the diagnostics.

SARIF and a hosted GitLab integration are tracked separately; see `TODOS.md` if you'd like to follow along. In the meantime, the JSON output is intentionally stable: `JsonReport`, `JsonReportSummary`, and friends are exported from [`react-doctor/api`](packages/react-doctor/src/api.ts) for type-safe consumption.

## Node.js API

```js
import { diagnose, toJsonReport, summarizeDiagnostics } from "react-doctor/api";

const result = await diagnose("./path/to/your/react-project");

console.log(result.score); // { score: 82, label: "Great" } or null
console.log(result.diagnostics); // Diagnostic[]
console.log(result.project); // detected framework, React version, etc.
```

`diagnose` accepts a second argument: `{ lint?: boolean }`.

```js
const report = toJsonReport(result, { version: "1.0.0" });
const counts = summarizeDiagnostics(result.diagnostics);
```

`react-doctor/api` re-exports `JsonReport`, `JsonReportSummary`, `JsonReportProjectEntry`, `JsonReportMode`, plus the lower-level `buildJsonReport` and `buildJsonReportError` builders. See [`packages/react-doctor/src/api.ts`](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/api.ts) for the full types.

## Privacy and data

React Doctor runs entirely on your machine. The only network traffic is the optional score lookup and an opt-out share URL, and both can be disabled.

| Network call        | URL                                          | Sent                                                                                                                                                          | Disabled by                                  |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Score API           | `https://www.react.doctor/api/score`         | Gzipped JSON of the diagnostic list with **file paths stripped** (rule id, severity, message, position only). No source code, no file paths, no project name. | `--offline` / `"offline": true`              |
| Share URL (printed) | `https://www.react.doctor/share?p=...&s=...` | Query parameters only: detected project name, score, error count, warning count, affected file count. Nothing is uploaded; the link is rendered locally.      | `--offline`, `"share": false`, or any CI run |

What `--offline` disables, exactly:

- The score API call. No score is computed and the `score` action output / `--score` value is empty.
- The share URL line in the local CLI summary.

What `--offline` does **not** affect:

- Local rule execution, diagnostics, exit codes, JSON / annotation output, and the GitHub Actions sticky PR comment (the comment is constructed locally from the printed report).

Source code never leaves your machine. There is no telemetry pipeline, no file upload, and no usage analytics in the CLI.

For the hosted React Review product on [react.doctor](https://react.doctor), the GitHub App reads repository contents through GitHub's standard installation-scoped access in order to compute the same diagnostics server-side; review the App permissions screen before installing.

## Leaderboard

Top React codebases scanned by React Doctor, ranked by score. Updated automatically from [millionco/react-doctor-benchmarks](https://github.com/millionco/react-doctor-benchmarks).

<!-- LEADERBOARD:START -->
<!-- prettier-ignore -->
| #  | Repo | Score |
| -- | ---- | ----: |
| 1  | [executor](https://github.com/RhysSullivan/executor) | 96 |
| 2  | [nodejs.org](https://github.com/nodejs/nodejs.org) | 86 |
| 3  | [tldraw](https://github.com/tldraw/tldraw) | 71 |
| 4  | [t3code](https://github.com/pingdotgg/t3code) | 69 |
| 5  | [better-auth](https://github.com/better-auth/better-auth) | 64 |
| 6  | [mastra](https://github.com/mastra-ai/mastra) | 63 |
| 7  | [excalidraw](https://github.com/excalidraw/excalidraw) | 62 |
| 8  | [payload](https://github.com/payloadcms/payload) | 60 |
| 9  | [typebot](https://github.com/baptisteArno/typebot.io) | 57 |
| 10 | [medusajs/admin](https://github.com/medusajs/medusa) | 56 |

<!-- LEADERBOARD:END -->

See the [full leaderboard](https://www.react.doctor/leaderboard).

## Resources & Contributing Back

Want to try it out? Check out [the demo](https://react.doctor).

Looking to contribute back? Clone the repo, install, build, and submit a PR.

```bash
git clone https://github.com/millionco/react-doctor
cd react-doctor
pnpm install
pnpm build
node packages/react-doctor/bin/react-doctor.js /path/to/your/react-project
```

Find a bug? Head to the [issue tracker](https://github.com/millionco/react-doctor/issues).

### License

React Doctor is MIT-licensed open-source software.
