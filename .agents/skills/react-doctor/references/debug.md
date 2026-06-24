# Debugging with runtime evidence

Reproduce and fix UI bugs with runtime evidence, never by guessing from code alone. Use this when the user says something is broken, crashes, throws, hangs, or behaves wrong in the running app.

This is the [debug-agent](https://github.com/millionco/debug-agent) loop, built into React Doctor: hypothesize, instrument with logs, reproduce, analyze the logs, fix only once the logs prove the cause, verify, clean up.

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

- **Browser bugs:** drive the repro with whatever controls a live Chrome. The bundled browser core attaches to the Chrome you already have open over the Chrome DevTools Protocol, so the real session, logins, and cookies come along. If nothing debuggable is running, it launches a dedicated persistent Chrome (its own profile, headless — pass `--headed` to watch it, and `browser close` to stop it) that later commands reattach to, so the flow below works either way. To drive your real logged-in session, open Chrome with `--remote-debugging-port=9222` first and it attaches to that instead. `browser eval --profile` hands you the whole runtime picture in one pass — the console (with uncaught errors), the network waterfall with failures flagged, performance, memory (heap, DOM nodes, listeners), accessibility, and the React + CPU profiles — so you rarely need to instrument at all. Run it with no expression to read the page as it is, or pass the repro to record what it triggers. If [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) (`chrome-devtools`) is in your tools, it also covers this and adds performance traces and Lighthouse.

```bash
npx react-doctor browser open http://localhost:3000           # attach + open the page
npx react-doctor browser eval --profile                       # console + network + perf + a11y + React/CPU in one pass
npx react-doctor browser snapshot                             # what rendered, by role + name
npx react-doctor browser eval 'page.getByRole("button", { name: "Checkout" }).click()'
npx react-doctor browser eval 'page.getByRole("button", { name: "Checkout" }).click()' --profile  # drive + measure it
npx react-doctor browser eval 'page.evaluate(() => document.title)'   # raw DOM when you need it
```

`snapshot` and `eval` are a pair. `snapshot` lists the rendered elements by role and accessible name. `eval` runs an expression with the Playwright `page` in scope, so you act on what you saw using Playwright's own selectors: `page.locator("text=Login").click()`, `page.getByRole(...)`, `page.fill(...)`, `page.waitForSelector(...)`. For raw DOM, reach through `page.evaluate(() => …)`. No separate ref scheme to track.

- **Backend or CLI bugs:** write and run a small repro script (Node, shell) yourself.
- Otherwise ask the user for numbered steps, and remind them to restart any app or service whose instrumented files are bundled or cached.

Reuse the same repro pathway for every iteration.

## 4. Analyze the logs

Read the NDJSON at `logPath`. Mark each hypothesis CONFIRMED, REJECTED, or INCONCLUSIVE, citing the specific log lines. If the file is empty, the repro likely did not run the instrumented path, so try again. If every hypothesis is rejected, revert the rejected code changes, generate new hypotheses from a different subsystem, and add more instrumentation.

## 5. Fix, only with proof

Apply the smallest change that addresses the proven cause. Cross-check it against the baseline rules in `SKILL.md` (derive don't duplicate, effects, single source of truth). Do not remove the instrumentation yet. Never use `setTimeout` or `sleep` as a fix.

## 6. Verify

Clear the log file, re-run the same reproduction (tag the logs `runId:"post-fix"` if helpful), and compare before and after with cited lines. Re-run a couple of times to rule out races. No fix is confirmed without log proof.

## 7. Clean up

Once verified, search every file for `#region debug log`, delete each block through its `#endregion`, grep again to confirm none remain, and `git diff` to confirm only the intentional fix is left.
