---
name: react-doctor
description: Use when finishing a feature, fixing a bug, before committing React code, or when the user types `/doctor` to scan/triage/clean up React diagnostics, `/debug` to root-cause a bug with runtime evidence, or `/performance` to attribute and fix React jank, dropped frames, or slow interactions. Covers lint, accessibility, bundle size, architecture, evidence-based debugging, and runtime performance attribution. Includes a regression check, a full local-triage workflow, a runtime-instrumentation debug loop, and a LoAF + commit performance rig.
version: "1.3.0"
---

# React Doctor

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score.

## After making React code changes:

Run `npx react-doctor@latest --verbose --diff` and check the score did not regress.

If the score dropped, fix the regressions before committing.

## For general cleanup or code improvement:

Run `npx react-doctor@latest --verbose` (without `--diff`) to scan the full codebase. Fix issues by severity — errors first, then warnings.

## /doctor — full local triage workflow

When the user types `/doctor`, says "run react doctor", or asks for a full triage / cleanup pass (not just a regression check), fetch the canonical local-triage playbook and follow every step in it:

```bash
curl --fail --silent --show-error \
  --header 'Cache-Control: no-cache' \
  https://www.react.doctor/prompts/react-doctor-agent.md
```

The playbook is the single source of truth — a scan → filter → triage → fix → validate loop that edits the working tree directly (never commits, never opens PRs). Updating the prompt at its source updates every agent on its next fetch — no skill reinstall needed.

Pair it with the matching per-rule prompts at `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md` (fetched on demand inside the playbook) so each fix uses the canonical, reviewer-tested recipe.

## Command

```bash
npx react-doctor@latest --verbose --diff
```

| Flag        | Purpose                                       |
| ----------- | --------------------------------------------- |
| `.`         | Scan current directory                        |
| `--verbose` | Show affected files and line numbers per rule |
| `--diff`    | Only scan changed files vs base branch        |
| `--score`   | Output only the numeric score                 |

---

# /debug — evidence-based debugging

When the user types `/debug`, reports a bug, a crash, unexpected behavior, broken state, missing UI, an infinite loop, stale data, a hydration mismatch, a console error, or asks to debug / investigate / root-cause an issue (including "why does this not work" or "this used to work"), you are now in **REACT DEBUGGING MODE**. You must debug with **runtime evidence**, not guesses.

**Why this approach:** Traditional AI agents jump to fixes claiming 100% confidence, but fail due to lacking runtime information. React adds extra failure modes — stale closures, double invocation in Strict Mode, hydration mismatches, async race conditions in effects, server vs client component boundaries — that look fine in source but explode at runtime. You **cannot** and **must NOT** fix React bugs from code alone — you need actual runtime data from a browser, a Node SSR pass, or a test runner.

**Your systematic workflow:**

1. **Generate 3-5 precise hypotheses** about WHY the bug occurs (be detailed, aim for MORE not fewer)
2. **Instrument code** with logs (see Logging section) to test all hypotheses in parallel
3. **Reproduce the bug.**
   - **If a failing test already exists**: run it directly.
   - **If reproduction is straightforward** (e.g., a single CLI command, a curl request, a simple script): write and run an ad hoc reproduction script yourself. Tailor it to the runtime — Playwright/Puppeteer for browser bugs, a Node/Python/shell script for backend bugs, etc.
   - **Otherwise**: ask the user to reproduce it. Provide clear, numbered steps. Remind them to restart apps/services if instrumented files are cached or bundled. Offer: "If you'd like me to write a reproduction script instead, let me know."
   - Once the user confirms a reproduction pathway (manual or automated), reuse it for all subsequent iterations without re-asking.
4. **Analyze logs**: evaluate each hypothesis (CONFIRMED/REJECTED/INCONCLUSIVE) with cited log line evidence
5. **Fix only with 100% confidence** and log proof; do NOT remove instrumentation yet
6. **Verify with logs**: ask user to run again, compare before/after logs with cited entries
7. **If logs prove success** and user confirms: remove all instrumentation by searching for `#region debug log` / `#endregion` markers and deleting those blocks (see Cleanup section). **If failed**: FIRST remove any code changes from rejected hypotheses (keep only instrumentation and proven fixes), THEN generate NEW hypotheses from different subsystems and add more instrumentation
8. **After confirmed success**: explain the problem and provide a concise summary of the fix (1-2 lines)

**Critical constraints:**

- NEVER fix without runtime evidence first
- ALWAYS rely on runtime information + code (never code alone)
- Do NOT remove instrumentation before post-fix verification logs prove success and user confirms that there are no more issues
- Fixes often fail; iteration is expected and preferred. Taking longer with more data yields better, more precise fixes

## React debugging tips

React bugs cluster into a small number of failure modes. Use this catalog to generate sharper hypotheses in step 1 and to pick smarter log placements in step 2.

### Common React bug classes (use to seed hypotheses)

| Symptom                                                                    | Likely cause                                                                                                                                                                                             | First place to look                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Infinite re-render" / "Maximum update depth exceeded" — variant A         | `setState` called unconditionally in component render body                                                                                                                                               | Render body of the offending component                                                                                                                                                                                |
| "Infinite re-render" / "Maximum update depth exceeded" — variant B         | `useEffect` dep is an object/array literal (often returned from a custom hook), so identity changes every render and the effect re-fires                                                                 | Identity of every value returned by every custom hook used in the deps array — log `Object.is(prev, next)` per render to confirm                                                                                      |
| Stale value in handler, "I clicked but it used the old state"              | Stale closure over state/props captured at mount                                                                                                                                                         | `useCallback`/`useMemo` deps; convert to `useRef`-latest or read from setter callback                                                                                                                                 |
| Effect runs twice in dev only                                              | React 18+ Strict Mode double-invokes effects to surface missing cleanup                                                                                                                                  | `useEffect` cleanup function — must be idempotent and cancel in-flight work                                                                                                                                           |
| "Cannot update a component while rendering a different component"          | `setState` called during another component's render (often via parent ref or context)                                                                                                                    | Stack trace points to the setter; move to effect or event                                                                                                                                                             |
| "Hydration failed" / text mismatch                                         | Server HTML diverges from first client render — most often **timezone** via `toLocaleString`/`Intl`, then locale, `Date.now()`, `Math.random()`, `window`/`document`/`localStorage` access during render | The exact node in the warning; gate non-deterministic code behind `useEffect` or `useSyncExternalStore`. Timezone divergence is the modal cause — an N-hour offset between server and client text is almost always TZ |
| Network request fires N times for one interaction                          | Effect deps churn, or fetch inside render, or React Query/SWR key instability                                                                                                                            | Log the effect deps and key identity per render                                                                                                                                                                       |
| State "resets" unexpectedly                                                | Component unmounted/remounted (key changed, conditional parent, router)                                                                                                                                  | Log mount/unmount and parent's render output; check `key=` props                                                                                                                                                      |
| `Cannot read properties of undefined` after data loads                     | Reading nested data before suspense/loading guard resolves                                                                                                                                               | Log the resolved value and the render path that consumed it                                                                                                                                                           |
| Race condition: latest request loses to earlier one                        | Effect didn't cancel previous in-flight fetch                                                                                                                                                            | Add `AbortController` in cleanup and log abort reason                                                                                                                                                                 |
| Server Component error: "You're importing a Component that needs useState" | Client-only API used in a Server Component                                                                                                                                                               | The file's first line — needs `"use client"` directive                                                                                                                                                                |
| Form submit does nothing in Next.js                                        | Server Action signature mismatch or not awaited                                                                                                                                                          | Log the action input on the server and the response on the client                                                                                                                                                     |

### React-aware log placements

When instrumenting React code (step 2 of the workflow), prefer these placements over generic function entry/exit:

- **Top of component body** — log `{ props, renderCount }` to detect unwanted re-renders. Use a `useRef` counter to avoid feedback loops, AND **cap log emission when a loop is suspected** (e.g. `if (renderCount.current > 50) return;`). Without the cap, instrumentation will fire hundreds of POSTs before React's update guard trips and the debug log becomes unreadable. Same cap applies to any log placed inside an effect that you suspect is re-firing.
- **Inside `useEffect` body** — log `{ deps, runCount }` and the values of each dep with their identity (e.g. `Object.is` against previous via `useRef`).
- **Inside `useEffect` cleanup** — log `{ reason: 'cleanup', deps }`. Catches Strict Mode and unmount issues.
- **Before every `setState`** — log `{ from: prev, to: next, source: 'handler|effect|callback' }`. Use the functional form (`setX(prev => ...)`) so the log captures the actual `prev` React saw.
- **Top of every event handler** — log `{ event: e.type, target, currentState }`. Confirms the handler ran and what it captured.
- **Inside async callbacks** — log before and after every `await`. Captures stale closure issues and unresolved promises.
- **Custom hook entry/exit** — log inputs and returned values, including `Object.is` identity comparison against the previous render's return value. Custom hooks that return object/array literals are the #1 source of dep-churn infinite loops.
- **Server Components** — log on the server (file-append NDJSON, not `fetch`); include `request.url` and any `cookies()`/`headers()` reads. Client-side `fetch` will not run in a Server Component.
- **Client side of a Server Component (hydration debugging)** — Server Components have no client lifecycle of their own, so to capture what the client _actually rendered_ during hydration (mandatory for any hydration mismatch investigation) drop a sibling Client Component (`"use client"`) right next to the Server Component, pass it the same input, and log via the `useEffect` + `fetch` pattern. Without this, you can only see one half of the divergence.
- **Server Actions** — log entry with full input, log every branch, log the returned value or thrown error.
- **Suspense boundaries** — log when a child throws a promise (in the resource read) and when it resolves.

### Runtime tools to layer in (in addition to logs)

Use these alongside instrumentation when symptoms warrant. They are not a substitute for cited log evidence, but they often narrow the hypothesis space fast.

- **Headless browser for "what is the page actually showing?"** — if the agent has Playwright MCP, Chrome DevTools MCP, a built-in browser tool, or `agent-browser` on `PATH`, use it. The two operations you want:
  - **ARIA snapshot of the live DOM**: use it before generating hypotheses for "missing UI", "wrong state showing", "extra/duplicate element", or hydration mismatch — you stop arguing about source code and start citing what the DOM actually contains. Filter to interactive elements (buttons, inputs, links) when you only need the action surface.
  - **Headless screenshot**: when the ARIA tree looks fine but _visually_ something is broken (overflow, z-index, wrong color, off-screen modal). Attach to the bug report, or diff before/after a fix. Capture full page for layout issues, mobile viewport (e.g. 390×844) to repro mobile-only bugs, and reuse the persistent session so login state survives across captures.
  - If the agent has no browser tool, ask the user to attach a screenshot or open the page themselves and describe the symptom. Don't substitute `WebFetch` / `curl` — HTML is not a browser.
- **React DevTools → Components tab**: inspect props, state, hooks, and `key=` of any node.
- **React DevTools → Profiler tab**: record an interaction, then read the flame graph for which components committed and _why_ (props/state/hooks/parent). Use the profiler to pick _which_ component to instrument.
- **`react-scan`** (`npx react-scan@latest <url>` or the lite injection): live overlay of which fibers re-rendered. Best for "this feels janky" before you have a precise hypothesis.
- **Browser DevTools → Sources → conditional breakpoints**: for one-shot inspection. Logs are still preferred when you need to compare across runs.
- **Network tab → "Preserve log" + "Disable cache"**: required when debugging fetch dedup, SWR, or React Query issues across navigations.
- **`<StrictMode>`**: leave it on in dev. If a bug only appears in Strict Mode, it is a real bug — usually a missing cleanup or non-idempotent effect.
- **Next.js server logs**: for App Router bugs, the server terminal is your console. Tail `next dev` output and instrument Server Components by appending NDJSON directly to the log path (see Logging step 2 — the non-JS branch applies because Node has FS access).

### Reproduction strategy by surface

Step 3 of the workflow asks how to reproduce. For React, pick the cheapest reliable path:

| Surface                                            | Preferred reproduction                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure component logic / hooks                       | Vitest + `@testing-library/react` — fastest, runs headless                                                                                                                                     |
| Browser-only bug (events, layout, focus)           | Playwright script driving the dev server                                                                                                                                                       |
| SSR / hydration mismatch                           | `next build && next start`, then capture an ARIA snapshot of `http://localhost:3000` via the agent's browser tool — diff against expectation; the dev server hides hydration errors behind HMR |
| "What does the page actually look like right now?" | ARIA snapshot via the agent's browser tool (text), or screenshot (visual) — both reuse the persistent session                                                                                  |
| Server Action / route handler                      | `curl` or a Node script hitting the endpoint with the exact payload                                                                                                                            |
| Visual regression                                  | Screenshot before the change, screenshot after, attach both to the report — logs alone won't catch it                                                                                          |

### Forbidden React "fixes" (anti-patterns)

These commonly appear under pressure. They are not fixes — they are evidence you skipped the workflow.

- Wrapping in `setTimeout(..., 0)` to "let React settle" — this hides ordering bugs, doesn't fix them.
- Adding a missing dep to a `useEffect` deps array without understanding why it was missing — often causes new infinite loops.
- **Swapping `useEffect([objectFromHook])` for `useEffect([objectFromHook.a, objectFromHook.b])` without first proving via logs that the object identity was the cause.** Confirm identity churn with a log first; only then memoize the source hook OR destructure the deps.
- Sprinkling `useMemo` / `useCallback` "just in case" — without a measured re-render problem, this adds cost and complexity. **Exception (correctness, not perf):** memoizing a custom hook's return value or wrapping a value before passing it into a `useEffect` dep is sometimes the _only_ idiomatic fix for a referential-instability bug. Apply it once logs prove identity is changing every render.
- Disabling `<StrictMode>` to silence double-invocation — this hides the real cleanup bug.
- Adding `key={Math.random()}` or `key={Date.now()}` to "force a re-render" — destroys all child state on every render, almost never correct.
- Suppressing the `react-hooks/exhaustive-deps` lint without a comment explaining why.
- Swallowing errors in a `try/catch` to "make the red go away" without logging what was caught.
- **`suppressHydrationWarning={true}` to silence a hydration mismatch when the divergence is real** (timezone, locale, `Date.now`, `Math.random`, `window`/`localStorage` access during render). This API is only correct when the divergence is provably benign. For a real divergence the tree is still regenerated on the client and wrong HTML still ships to non-JS users and search crawlers. Fix the divergence (deterministic formatting with explicit `timeZone`/`locale`, or render a stable placeholder server-side and the localized value only in a Client Component effect).

If a proposed fix matches any of the above, generate new hypotheses instead.

## Logging

### STEP 0: Start the debug server (MANDATORY BEFORE ANY INSTRUMENTATION)

Run the debug server in **daemon mode** before any instrumentation. The `--daemon` flag starts the server in the background and exits immediately with the server info — no backgrounding or `&` required.

```bash
npx react-doctor@latest debug --daemon
```

The command prints a single JSON line to stdout and exits:

```json
{
  "sessionId": "a1b2c3",
  "port": 54321,
  "endpoint": "http://127.0.0.1:54321/ingest/a1b2c3",
  "logPath": "/tmp/react-doctor-debug/debug-a1b2c3.log"
}
```

Capture and remember these values:

- **Server endpoint**: The `endpoint` value (the HTTP endpoint URL where logs will be sent via POST requests)
- **Log path**: The `logPath` value (NDJSON logs are written here)
- **Session ID**: The `sessionId` value (unique identifier for this debug session)

If the server fails to start, STOP IMMEDIATELY and inform the user.

- DO NOT PROCEED with instrumentation without valid logging configuration.
- The server is idempotent — if one is already running, it returns the existing server's info instead of starting a duplicate.
- You do not need to pre-create the log file; it will be created automatically when your instrumentation first writes to it.

### STEP 1: Understand the log format

- Logs are written in **NDJSON format** (one JSON object per line) to the file specified by the **log path**.
- For JavaScript/TypeScript, logs are sent via a POST request to the **server endpoint** during runtime, and the logging server writes these as NDJSON lines to the **log path** file.
- For other languages (Python, Go, Rust, Java, C/C++, Ruby, etc.), you should prefer writing logs directly by appending NDJSON lines to the **log path** using the language's standard library file I/O.

Example log entry:

```json
{
  "sessionId": "a1b2c3",
  "id": "log_1733456789_abc",
  "timestamp": 1733456789000,
  "location": "test.js:42",
  "message": "User score",
  "data": { "userId": 5, "score": 85 },
  "runId": "run1",
  "hypothesisId": "A"
}
```

### STEP 2: Insert instrumentation logs

- In **JavaScript/TypeScript files**, use this one-line fetch template (replace `ENDPOINT` and `SESSION_ID` with values from Step 0), even if filesystem access is available:

```
fetch('ENDPOINT',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'SESSION_ID',location:'file.js:LINE',message:'desc',data:{k:v},timestamp:Date.now()})}).catch(()=>{});
```

- In **non-JavaScript languages** (Python, Go, Rust, Java, C, C++, Ruby), instrument by opening the **log path** in append mode using standard library file I/O, writing a single NDJSON line with your payload, and then closing the file. Keep these snippets as tiny and compact as possible (ideally one line, or just a few).

- Decide how many instrumentation logs to insert based on the complexity of the code under investigation and the hypotheses you are testing. A single well-placed log may be enough when the issue is highly localized; complex multi-step flows may need more. Aim for the minimum number that can confirm or reject ALL your hypotheses. Guidelines:
  - At least 1 log is required; never skip instrumentation entirely
  - Do not exceed 10 logs — if you think you need more, narrow your hypotheses first
  - Typical range is 2-6 logs, but use your judgment

- Choose log placements from these categories as relevant to your hypotheses:
  - Function entry with parameters
  - Function exit with return values
  - Values BEFORE critical operations
  - Values AFTER critical operations
  - Branch execution paths (which if/else executed)
  - Suspected error/edge case values
  - State mutations and intermediate values

- Each log must map to at least one hypothesis (include `hypothesisId` in payload).
- Use this payload structure: `{sessionId, runId, hypothesisId, location, message, data, timestamp}`
- **REQUIRED:** Wrap EACH debug log in a collapsible code region:
  - Use language-appropriate region syntax (e.g., `// #region debug log`, `// #endregion` for JS/TS)
  - This keeps the editor clean by auto-folding debug instrumentation
- **FORBIDDEN:** Logging secrets (tokens, passwords, API keys, PII)

### STEP 3: Clear previous logs before each run (MANDATORY)

- Send a `DELETE` request to the **server endpoint** to clear the log file before each run. For example: `curl -X DELETE ENDPOINT` (replace `ENDPOINT` with the endpoint value from Step 0).
- This ensures clean logs for the new run without mixing old and new data.
- Clearing the log file is NOT the same as removing instrumentation; do not remove any debug logs from code here.
- **CRITICAL:** Only clear YOUR session's logs (via your endpoint from Step 0). NEVER delete, modify, or overwrite log files belonging to other debug sessions.

### STEP 4: Read logs after the program runs

- After the user runs the program and confirms completion in their interface, do NOT ask them to type "done"; then use the file-read tool to read the file at the **log path**.
- The log file will contain NDJSON entries (one JSON object per line) from your instrumentation.
- Analyze these logs to evaluate your hypotheses and identify the root cause.
- If the log file is empty or missing: tell the user the reproduction may have failed and ask them to try again.

### STEP 5: Keep logs during fixes

- When implementing a fix, DO NOT remove debug logs yet.
- Logs MUST remain active for verification runs.
- You may tag logs with `runId="post-fix"` to distinguish verification runs from initial debugging runs.
- FORBIDDEN: Removing or modifying any previously added logs in any files before post-fix verification logs are analyzed or the user explicitly confirms success.
- Only remove logs after a successful post-fix verification run (log-based proof) or explicit user request to remove.

## Critical reminders (must follow)

- Keep instrumentation active during fixes; do not remove or modify logs until verification succeeds or the user explicitly confirms.
- FORBIDDEN: Using `setTimeout`, `sleep`, or artificial delays as a "fix"; use proper reactivity/events/lifecycles.
- FORBIDDEN: Removing instrumentation before analyzing post-fix verification logs or receiving explicit user confirmation.
- Verification requires before/after log comparison with cited log lines; do not claim success without log proof.
- Clear logs by sending a DELETE request to the server endpoint.
- Do not create the log file manually; it's created automatically.
- Clearing the log file is not removing instrumentation.
- NEVER delete or modify log files that do not belong to this session. Only touch the log file at the exact path from Step 0.
- Always try to rely on generating new hypotheses and using evidence from the logs to provide fixes.
- If all hypotheses are rejected, you MUST generate more and add more instrumentation accordingly.
- **Remove code changes from rejected hypotheses:** When logs prove a hypothesis wrong, revert the code changes made for that hypothesis. Do not let defensive guards, speculative fixes, or unproven changes accumulate. Only keep modifications that are supported by runtime evidence.
- Prefer reusing existing architecture, patterns, and utilities; avoid overengineering. Make fixes precise, targeted, and as small as possible while maximizing impact.

## Cleanup

When it is time to remove instrumentation (after a verified fix or user request):

1. Search all files for `#region debug log` markers (e.g., grep/ripgrep for `#region debug log`)
2. For each match, delete everything from the `#region debug log` line through its corresponding `#endregion` line (inclusive)
3. Grep again to verify zero markers remain
4. Run `git diff` to review all changes — confirm only your intentional fix remains and no stray debug code was missed

This is why wrapping every debug log in `#region debug log` / `#endregion` is mandatory — it enables deterministic cleanup.

## Debug server API reference

| Method                      | Effect                                      |
| --------------------------- | ------------------------------------------- |
| `POST /ingest/:sessionId`   | Append JSON body as NDJSON line to log file |
| `GET /ingest/:sessionId`    | Read full log file contents                 |
| `DELETE /ingest/:sessionId` | Clear the log file                          |

| `react-doctor debug` flag | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| `--daemon`                | Start in the background and exit (recommended) |
| `--json`                  | Print server info as JSON (no spinner/colors)  |
| `--port <number>`         | Port to listen on (default: random)            |
| `--host <address>`        | Host to bind to (default: 127.0.0.1)           |
| `--session-id <id>`       | Reuse a specific session id                    |
| `--log-path <path>`       | Override the NDJSON log file path              |

---

# /performance — runtime performance attribution

When the user types `/performance`, reports dropped frames, janky scroll, slow typing or click response, poor INP, animation stutter, cascading re-renders, or asks to debug rendering / commit / interaction performance in React, use this rig. It reuses the same NDJSON debug server as `/debug` (`react-doctor debug --daemon`).

## Overview

Runtime attribution for React jank. Two observers, one clock: `long-animation-frame` (LoAF) names the script in the slow frame; `react-scan/lite` names the fiber in the commit and why it re-rendered. You correlate by `performance.now()` timestamps. The user flicks the UI to reproduce — clicks, scrolls, types — and confirms when done; you set up the rig, read the logs, and propose fixes. Cite a LoAF entry plus a commit event in every conclusion, or don't conclude.

## When to use

Symptoms (any of):

- Dropped frames, janky scroll, animation stutter
- Slow click / keypress / touch response, typing lag in controlled inputs
- Poor INP, slow LCP, layout shifts
- Tab switches, route changes, modal opens feel sluggish

Do NOT use for:

- Non-React browser perf — a LoAF-only web-performance pass
- Bundle size, code splitting — bundle analyzer (run `npx react-doctor@latest --verbose`)
- SSR / hydration latency — different subsystem
- Memory leaks, heap snapshots
- Backend / API slowness

## Core pattern

Before — count renders and squint:

```tsx
const renderCount = useRef(0);
useEffect(() => {
  renderCount.current++;
  console.log("Rendered", renderCount.current);
});
```

After — two observers, one clock:

```ts
import { instrument } from "react-scan/lite";
instrument({
  endpoint: "...",
  sessionId: "...",
  recordChangeDescriptions: true,
  includeFiberSource: true,
  includeFiberIdentity: true,
});
```

Plus the LoAF observer in `<head>`. Every frame > 50ms is reported with `scripts[]`; every commit with `tree[]` and `changeDescription`.

## Workflow

1. Generate 3–5 hypotheses; mark each CONFIRMED / REJECTED / INCONCLUSIVE as evidence comes in.
2. ARIA-snapshot the target page (Playwright MCP, Chrome DevTools MCP, a built-in browser tool, or `agent-browser` on `PATH`) to confirm the URL loads. No browser tool? Ask the user — never `WebFetch` / `curl`.
3. Start the daemon (STEP 0) and `pnpm add -D react-scan`.
4. Inject observers (STEP 1).
5. Verify `profiling-hooks-status: available` (STEP 2). If false, fall back to LoAF-only.
6. Have the user reproduce ≥ 3× in their UI; give numbered steps if it helps. Single samples are noise. Automating via Playwright MCP / Chrome DevTools MCP is fine when you have the tool, but the user is the default driver — they know which click triggers the jank.
7. Clear the log via `curl -X DELETE <endpoint>` (NOT `rm`) before each run. Wait for the user to say they're done before reading.
8. Correlate (Quick reference). Cite a LoAF entry plus a commit event.
9. Apply the fix at 100% confidence. The user reloads (HMR is fine) and retriggers the same interaction; tag the post-fix payloads with `runId="post-fix"`. Pass requires both: the LoAF duration drops AND the `fiberId` / `changeDescription` signature is gone, not relocated. Clean up `#region debug log` markers only after the user confirms.

## Implementation

### STEP 0: Start the rig

`pnpm add -D react-scan` (or `npm i -D` / `bun add -D`), then start the same debug server as `/debug`:

```bash
npx react-doctor@latest debug --daemon
```

Daemon mode prints one JSON line and exits:

```json
{
  "sessionId": "a1b2c3",
  "endpoint": "http://127.0.0.1:54321/ingest/a1b2c3",
  "logPath": "/tmp/react-doctor-debug/debug-a1b2c3.log"
}
```

Idempotent — re-running returns the existing session. If `logPath` has entries from a prior session, ask before reusing; entries interleave and corrupt correlation.

### STEP 1: Inject the observers

Both MUST run before `react-dom` mounts. Late injection silently drops early LoAFs and all pre-mount commits.

LoAF observer: paste this as the first `<script>` in `<head>` (or copy the IIFE body to the top of your SPA entry, before any side-effecting `import`). Replace `__ENDPOINT__` and `__SESSION_ID__` with the values from STEP 0. Safari/Firefox have no LoAF support; the `try/catch` no-ops there.

```html
<script>
  // #region debug log
  (() => {
    const ENDPOINT = "__ENDPOINT__";
    const SESSION_ID = "__SESSION_ID__";
    const send = (kind, payload) =>
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: SESSION_ID,
          location: "PerformanceObserver:" + kind,
          message: kind,
          data: payload,
          timestamp: performance.now(),
        }),
        keepalive: true,
      }).catch(() => {});
    try {
      new PerformanceObserver((list) => {
        for (const loaf of list.getEntries()) {
          send("long-animation-frame", {
            startTime: loaf.startTime,
            duration: loaf.duration,
            renderStart: loaf.renderStart,
            styleAndLayoutStart: loaf.styleAndLayoutStart,
            blockingDuration: loaf.blockingDuration,
            firstUIEventTimestamp: loaf.firstUIEventTimestamp,
            scripts: (loaf.scripts || []).map((s) => ({
              invoker: s.invoker,
              invokerType: s.invokerType,
              sourceURL: s.sourceURL,
              sourceFunctionName: s.sourceFunctionName,
              sourceCharPosition: s.sourceCharPosition,
              executionStart: s.executionStart,
              duration: s.duration,
              forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration,
              pauseDuration: s.pauseDuration,
            })),
          });
        }
      }).observe({ type: "long-animation-frame", buffered: true });
    } catch {}
  })();
  // #endregion
</script>
```

`react-scan/lite`: import in your SPA entry (`main.tsx` / `App.tsx` / `_app.tsx` / `app/layout.tsx`) above any React import.

```ts
// #region debug log
import { instrument } from "react-scan/lite";

instrument({
  endpoint: "__ENDPOINT__",
  sessionId: "__SESSION_ID__",
  recordChangeDescriptions: true,
  includeFiberSource: true,
  includeFiberIdentity: true,
});
// #endregion
```

All three flags are required (why a fiber re-rendered, `file:line`, stable `fiberId` across commits).

`actualDuration` and `mark*` hooks only populate in `__PROFILE__` builds (default-on in dev). For prod, alias `react-dom` → `react-dom/profiling`; without it, `actualDuration` is `0` and ranking is impossible.

### STEP 2: Verify profiling is active

Check the first `profiling-hooks-status` event:

- `available: true` — proceed.
- `available: false, reason: "no-inject-method"` — non-`__PROFILE__` build. LoAF-only.
- `available: false, reason: "threw"` — incompatible React. LoAF-only.

LoAF-only: cite scripts (`sourceURL`, `duration`, `forcedStyleAndLayoutDuration`, `blockingDuration`) and rank per-frame budget consumers. You CANNOT cite a fiber, prop, hook, or context — mark such hypotheses INCONCLUSIVE and re-run on a `__PROFILE__` build.

### Log lifecycle

- Clear `logPath` via `curl -X DELETE <endpoint>` (NOT `rm` — races the daemon's writes). Only your own session.
- Read after the user confirms reproduction. Empty log → reproduction failed; clear and retry.
- Keep instrumentation through the fix. Tag verification runs with `runId="post-fix"`.
- Cleanup after success + user confirmation: `grep -rn "#region debug log"`, delete each region inclusively, also remove the wrapping `<script>` if injected as raw HTML, drop `react-scan` from `package.json` if added only for this session, `git diff` before committing.

## Quick reference: correlating LoAF to commits

For each LoAF with `duration > 50ms`:

1. List commits whose `timestamp` falls inside `[loaf.startTime, loaf.startTime + loaf.duration)`.
2. Sort each commit's `tree[]` by `actualDuration` desc.
3. The topmost fiber where `changeDescription.parent === false` is the trigger; its `parent: true` descendants are the cascade.
4. Read the trigger's `changeDescription` for the cause: which props, state, hooks, or context changed identity.
5. Cross-check with `state-update` events in the same window for who scheduled the work.

| Field                                    | Meaning                                                        |
| ---------------------------------------- | -------------------------------------------------------------- |
| `tree[i].name`                           | Component display name                                         |
| `tree[i].fiberId`                        | Stable id across commits                                       |
| `tree[i].source.{file,line,col}`         | JSX call site                                                  |
| `tree[i].ownerName`                      | The component that rendered this one (JSX parent)              |
| `tree[i].actualDuration`                 | Self+children time in this commit (ms)                         |
| `tree[i].selfBaseDuration`               | Self-only steady-state render cost                             |
| `tree[i].changeDescription.props`        | Prop names whose identity changed; the most common jank cause  |
| `tree[i].changeDescription.state`        | Class component state changed                                  |
| `tree[i].changeDescription.hooks`        | Hook indices that changed (includes `useMemo` / `useCallback`) |
| `tree[i].changeDescription.context`      | Consumed context value changed                                 |
| `tree[i].changeDescription.parent`       | Ancestor also rendered — cascade indicator, NOT a root cause   |
| `tree[i].changeDescription.isFirstMount` | First render, expected cost                                    |

> CONFIRMED hypothesis B: LoAF `startTime=12483, duration=128, scripts[2].duration=84, sourceURL=react-dom.development.js`. Matching `commit` at `timestamp=12490`: `tree[0] = { name: "ProductList", source: "src/pages/checkout.tsx:42", actualDuration: 84, changeDescription: { props: ["items"], parent: false } }`. The `items` prop changes identity every render — memoize in the parent's `useMemo`.

## Pick the fix

Map the citation to one technique. Apply only the one the evidence points at — never shotgun several.

| Diagnostic signal                                                                  | Likely fix                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `changeDescription.props` lists a prop with object/array/function identity         | `rerender-memo`                                                |
| `changeDescription.props` lists a primitive that flips frequently                  | `rerender-use-deferred-value`                                  |
| `forcedStyleAndLayoutDuration > 16ms` in a script                                  | `js-cache-function-results`                                    |
| Third-party URL dominates `scripts[].sourceURL`                                    | `rendering-resource-hints`                                     |
| User-code chunk dominates `scripts[].sourceURL` on a non-initial route             | `bundle-dynamic-imports`, `bundle-preload`                     |
| Hot loop in user code with no commit nearby                                        | `js-cache-function-results`                                    |
| Long script from non-blocking work (analytics, prefetch, lazy init)                | `js-request-idle-callback`                                     |
| Trigger is a fresh-identity component on every render                              | `rerender-memo`                                                |
| Typing lag in a controlled input                                                   | `rerender-use-deferred-value`, `rerender-transitions`          |
| Tab / route switch sticky; click highlight delayed                                 | `rerender-transitions`, `rendering-usetransition-loading`      |
| Long list `tree[]` with hundreds of children dominating `actualDuration`           | `rendering-content-visibility`                                 |
| Frequently-toggled subtree shows `isFirstMount: true` on every reveal              | `rendering-activity`                                           |
| Effect tears down and re-subscribes on every render (`[callback]` in deps)         | `advanced-use-latest`                                          |
| First-paint flash from `useEffect`-set state derived from `localStorage` / cookies | `rendering-hydration-no-flicker`, `client-localstorage-schema` |
| Long initial `scripts[]` with React tree first-mount work that should run once     | `advanced-init-once`                                           |

## Common mistakes

| Mistake                                                 | Why it fails                                                                    | Fix                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pasting snippets after framework bootstrap              | Misses early LoAFs and all pre-mount commits                                    | First `<script>` in `<head>`, or top of SPA entry before any React import |
| `React.memo` / `useMemo` / `useCallback` shotgun        | Memo bookkeeping has measured cost; useless if render isn't the bottleneck      | Confirm via LoAF + commit FIRST; memoize the cited prop only              |
| Concluding from `actualDuration` alone                  | Could be prop identity, layout thrash, expensive derived data — different fixes | Read `changeDescription` plus LoAF `forcedStyleAndLayoutDuration`         |
| Treating `changeDescription.parent: true` as cause      | Cascade symptom, not root cause                                                 | Find the ancestor with `parent: false`                                    |
| Profiling dev build                                     | 2–5× slower than prod; StrictMode double-invokes                                | Measure prod build before claiming numbers                                |
| `setTimeout(..., 0)` "fix"                              | Defers, doesn't remove work                                                     | Verify post-fix LoAF shows the script duration is gone, not relocated     |
| Reading minified `sourceURL` literally                  | Bundled path is meaningless                                                     | `includeFiberSource: true` for real `file:line`, or sourcemap             |
| Memoizing a controlled input to fix typing lag          | Input cost isn't the bottleneck; downstream derived work is                     | `useDeferredValue` / `startTransition` / debounce                         |
| Removing instrumentation before verification            | Can't prove the fix worked                                                      | Keep `#region debug log` until post-fix run + user confirms               |
| Trusting one profile                                    | Single sample is noise                                                          | Reproduce ≥ 3× before and after                                           |
| "React DevTools showed it's slow" or "feels faster now" | Single-sample human UI ≠ runtime evidence                                       | Cite a LoAF + commit                                                      |
| Deleting another session's `logPath`                    | Corrupts an unrelated debug session                                             | Only touch your own `endpoint` / `logPath`                                |
