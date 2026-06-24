# Debugging with runtime evidence

Reproduce and fix UI bugs with runtime evidence, never by guessing from code alone. Use this when the user says something is broken, crashes, throws, hangs, or behaves wrong in the running app.

The loop: hypothesize, instrument with logs, reproduce, analyze the logs, fix only once the logs prove the cause, verify, clean up.

## 0. Start the logging server (before any instrumentation)

The server is long-running. Start it once and keep it up for the whole session. `--daemon` prints the server info and returns, leaving the server running in the background:

```bash
npx react-doctor debug serve --daemon
```

It prints one JSON line. Capture and remember:

- `endpoint`: POST your logs here from JS or TS at runtime
- `logPath`: the NDJSON log file you read after each run
- `sessionId`: include it in every log payload

The server is idempotent: a second start returns the running server's info. If it fails to start, stop and tell the user. Do not instrument without it.

## 1. Generate hypotheses

Write 3 to 5 precise hypotheses about why the bug happens: a thrown error in a specific component, a failed or duplicated request, a null or undefined access, a state update after unmount, a missing loading or error branch. Aim for more, not fewer. Each hypothesis gets an id (A, B, C, …).

## 2. Instrument the code

Add 2 to 6 logs (never more than 10) at the points that confirm or reject each hypothesis: function entry and exit, values before and after a critical operation, which branch ran. In JS or TS, POST to the server `endpoint`:

```js
// #region debug log
fetch("ENDPOINT", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sessionId: "SESSION_ID",
    hypothesisId: "A",
    location: "cart.tsx:42",
    message: "cart total before render",
    data: { total },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion
```

Wrap every debug log in `// #region debug log` and `// #endregion` so cleanup later is deterministic. Each log maps to at least one `hypothesisId`. Never log secrets or PII.

## 3. Reproduce

Clear the log file (`DELETE` the file at `logPath`) before each run, then trigger the exact behavior the user described:

- **Browser bugs:** drive the repro with a live Chrome. The bundled browser attaches to your open Chrome over the Chrome DevTools Protocol (real session, logins, cookies come along), or launches a dedicated persistent one (own profile, headless — `--headed` to watch, `browser close` to stop) that later commands reattach to. To drive your logged-in session, start Chrome with `--remote-debugging-port=9222` first. `browser eval --profile` hands you the whole runtime picture in one pass — console (with uncaught errors), network with failures flagged, performance, memory, accessibility, and the React + CPU profiles — so you rarely need to instrument at all. Run it with no expression to read the page as-is, or pass the repro to record what it triggers. [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp), if present, also covers this and adds Lighthouse.

```bash
npx react-doctor browser open http://localhost:3000           # attach + open the page
npx react-doctor browser eval --profile                       # console + network + perf + a11y + React/CPU in one pass
npx react-doctor browser snapshot                             # what rendered, by role + name
npx react-doctor browser eval 'page.getByRole("button", { name: "Checkout" }).click()'
npx react-doctor browser eval 'page.getByRole("button", { name: "Checkout" }).click()' --profile  # drive + measure it
npx react-doctor browser eval 'page.evaluate(() => document.title)'   # raw DOM when you need it
```

Locate from the accessibility tree, then act — cheaper and more stable than coordinates or DOM scraping. `snapshot` lists rendered elements by role and accessible name; inside `eval`, `page.locator("…").ariaSnapshot()` does the same for one subtree. `eval` runs Playwright code with the `page` in scope: `page.getByRole("button", { name: "Checkout" }).click()`, `page.getByLabel(...).fill(...)`, `page.waitForSelector(...)`. When the code only acts, `eval` returns the resulting accessibility tree (one call drives the page and shows the new state); if it triggers a page-side error (`console.error` or an uncaught throw), `eval` appends an "Errors during eval" section. Multiple statements work without an IIFE. For raw DOM, reach through `page.evaluate(() => …)` — bare `window`/`document` at the top level won't, since `eval` runs in Node.

- **Backend or CLI bugs:** write and run a small repro script (Node, shell) yourself.
- Otherwise ask the user for numbered steps, and remind them to restart any app or service whose instrumented files are bundled or cached.

Reuse the same repro pathway for every iteration.

## 4. Analyze the logs

Read the NDJSON at `logPath`. Mark each hypothesis CONFIRMED, REJECTED, or INCONCLUSIVE, citing the specific log lines. If the file is empty, the repro likely did not run the instrumented path, so try again. If every hypothesis is rejected, revert the rejected code changes, generate new hypotheses from a different subsystem, and add more instrumentation.

When reasoning from black-box behavior rather than logs (a driven interaction, a measured delta), the same proof bar applies: confirm the mechanism in the source before calling it a bug. An internally-consistent anomaly — the box grows by exactly the distance the page scrolled — is usually intended behavior (auto-pan, momentum, a debounce), not a defect. Synthetic input is not real input: `page.mouse.move(..., { steps })` spreads over wall-clock time, so an effect that looks like it "scales with event count" may be time-based. Read the handler, then conclude.

## 5. Fix, only with proof

Apply the smallest change that addresses the proven cause. Cross-check it against the baseline rules in `SKILL.md` (derive don't duplicate, effects, single source of truth). Do not remove the instrumentation yet. Never use `setTimeout` or `sleep` as a fix.

## 6. Verify

Clear the log file, re-run the same reproduction (tag the logs `runId:"post-fix"` if helpful), and compare before and after with cited lines. Re-run a couple of times to rule out races. No fix is confirmed without log proof.

## 7. Clean up

Once verified, search every file for `#region debug log`, delete each block through its `#endregion`, grep again to confirm none remain, and `git diff` to confirm only the intentional fix is left.
