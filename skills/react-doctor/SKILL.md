---
name: react-doctor
description: Use when writing, finishing, or committing React or React Native code, when the user types `/react-doctor`, or when they ask to scan, triage, lint, profile performance, debug a UI in the browser, or review design and accessibility. Covers lint, accessibility, performance, bundle size, and architecture.
version: "1.6.0"
---

# React Doctor

One skill that makes your agent good at React. It writes better React by default, checks your changes in the background, and opens a real browser to profile performance, reproduce bugs, and review design.

## Baseline rules (always on)

Apply these on every React edit, before any tool runs. They shape how you write code, not only what you flag:

1. Derive state during render, don't duplicate it in another `useState`.
2. Skip effects for values you can compute while rendering and for logic that belongs in an event handler.
3. Compose components instead of piling on boolean props.
4. Lift state only as far as it needs to go, no higher.
5. Keep one source of truth for each piece of state.
6. Render without side effects; keep the render pass pure.
7. Use stable keys in lists, never the array index.
8. Fetch independent data in parallel, not in a waterfall.
9. Skip manual `useMemo`, `useCallback`, and `memo`; let the React Compiler handle it.
10. Handle the loading, error, and empty states, not only the happy path.

## Routing

`/react-doctor` picks the job from what you're doing. Name a job (`/react-doctor perf`) to force it. When the request is genuinely unclear, ask which one rather than guessing.

| Signal                                                  | Job        | What it does                    |
| ------------------------------------------------------- | ---------- | ------------------------------- |
| "review", "before commit", "clean up", or changed files | **doctor** | static scan plus 0 to 100 score |
| "slow", "laggy", "janky", "re-rendering"                | **perf**   | React render + CPU profilers    |
| "broken", "crashes", "doesn't work" in the UI           | **debug**  | reproduce in a real browser     |
| "looks off", "polish", a screenshot or pasted element   | **design** | measured UI review              |

doctor runs from code alone, so it is the one that fires in the background. The browser jobs (perf, debug, design) need a live page and are slower, so they run only when asked.

## Which browser to drive

debug, design, and perf need a real Chrome. Two ways to get one:

1. **A browser MCP already in your tools.** Prefer [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) (`chrome-devtools`) or similar for console, network, and snapshots. It adds full performance traces and Lighthouse on top.
2. **The bundled `react-doctor browser` command.** Attaches to the Chrome you already have open over the Chrome DevTools Protocol, and launches a dedicated persistent one only as a fallback. It covers `open`, `eval`, `snapshot`, `screenshot`, `console`, `network`, an axe-core `audit`, `perf` (long animation frames with per-script attribution), `profile` (one recording with both lenses — a React render profile of slowest commits, hottest components, and unnecessary re-renders, plus a V8/DevTools CPU profile over CDP with the hottest JS functions ranked by self time), and `report` (every signal in one load).

It is the same Chrome either way, so the playbooks apply to both: `browser open`, `eval`, `snapshot`, and `screenshot` map onto the MCP's `navigate_page`, `evaluate_script`, `take_snapshot`, and `take_screenshot`.

## Run as an MCP server

React Doctor ships its own Model Context Protocol server over stdio so any MCP-capable agent can call the jobs directly:

```bash
npx react-doctor@latest mcp
```

It exposes `doctor_scan` (the static scan), the `browser_*` tools (`browser_open`, `browser_eval`, `browser_snapshot`, `browser_screenshot`, `browser_audit`, `browser_console`, `browser_network`, `browser_perf`, `browser_profile`, `browser_report`), and the `debug_*` log server (`debug_serve`, `debug_read_logs`, `debug_clear_logs`). `browser_profile` records both a React render profile and a literal Chrome DevTools CPU profile in one pass.

## doctor: scan and triage

After making React changes, run a regression check and confirm the score did not drop:

```bash
npx react-doctor@latest --verbose --scope changed
```

If the score dropped, fix the regressions before committing. For a cleanup of the whole codebase, drop `--scope changed` (the default is `--scope full`) and fix by severity: errors first, then warnings.

When the user types `/react-doctor`, `/doctor`, says "run react doctor", or asks for a full triage or cleanup pass (not a regression check), fetch the canonical local-triage playbook and follow every step in it:

```bash
curl --fail --silent --show-error \
  --header 'Cache-Control: no-cache' \
  https://www.react.doctor/prompts/react-doctor-agent.md
```

The playbook is the single source of truth: a scan, filter, triage, fix, validate loop that edits the working tree directly and never commits or opens PRs. Updating the prompt at its source updates every agent on its next fetch, no reinstall needed. Pair it with the per-rule prompts at `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md` (fetched on demand inside the playbook) so each fix uses the reviewer-tested recipe.

## perf: profile performance

When the user reports jank, slow interactions, dropped frames, excessive re-renders, or asks to profile or optimize render performance, read [references/performance.md](references/performance.md) and follow it. It runs an evidence-driven profile, analyze, fix, re-profile loop against the real React DevTools profiler export, never guessing from code alone.

## debug: reproduce in a real browser

When the user says something is broken, crashes, throws, or behaves wrong in the running app, read [references/debug.md](references/debug.md) and follow it. It runs the [debug-agent](https://github.com/millionco/debug-agent) loop: generate hypotheses, instrument the code with runtime NDJSON logs, reproduce the bug in the live browser, and fix only once the logs prove the cause.

## design: review and improve UI

When the user wants to build, polish, or review an interface ("looks off", "make this nicer", a pasted screenshot or element), read [references/design.md](references/design.md) and follow it. It opens the page, takes a screenshot, and reports what it can measure (contrast, line length, spacing, tap-target size), not only taste.

## Configuring or explaining rules

When the user wants to understand a rule, disagrees with one, or wants to disable or tune which rules run (not fix code), read [references/explain.md](references/explain.md) and follow it. Start with `npx react-doctor@latest rules explain <rule>`, then apply the narrowest control via `npx react-doctor@latest rules disable|set|category|ignore-tag …`.

## Command

```bash
npx react-doctor@latest --verbose --scope changed
```

| Flag              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `.`               | Scan current directory                                           |
| `--verbose`       | Show affected files and line numbers per rule                    |
| `--scope changed` | Only report issues introduced vs the base branch (default: full) |
| `--scope lines`   | Only report issues on the changed lines                          |
| `--score`         | Output only the numeric score                                    |
