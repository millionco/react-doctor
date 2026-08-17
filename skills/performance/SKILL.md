---
name: performance
description: Diagnose React runtime performance with React Doctor traces, live render outlines, Long Animation Frames, interaction timing, and component render evidence. Use when invoked as `/performance` for a slow interaction, unexpected re-renders, or a measured before-and-after comparison.
disable-model-invocation: true
---

# Diagnose React runtime performance

Measure one reproducible interaction, connect browser work to React renders, and report only conclusions supported by the trace.

## Define the interaction

Before recording:

1. Identify the target URL
2. Write the exact actions to reproduce
3. Choose the expected result
4. Confirm whether authentication is required

Use a production build when available. Development builds add framework work that can distort render and script timings. If you must measure a development build, label that limitation in the report.

## Record the trace

Run the scan in an interactive terminal:

```bash
npx react-doctor@latest scan http://localhost:3000 --format json
```

React Doctor opens an isolated Chrome profile. Perform the planned interaction while purple outlines identify rendered components. Press Enter after the interaction settles; recordings stop automatically after five minutes.

Interactive users can omit the URL and choose a detected localhost app or enter another URL. Agents must always pass the explicit URL so automated runs never wait for input.

For an authenticated session, connect through the Chrome DevTools Protocol (CDP):

```bash
npx react-doctor@latest scan https://app.example.com \
  --cdp http://127.0.0.1:9222 \
  --format json
```

Use a dedicated debug profile for CDP because Chrome tracing is browser-wide. Sign in, close every non-blank tab, and then start the scan. React Doctor closes leftover blank tabs before tracing. Never request cookies, copy a browser profile, or close an externally managed browser.

The compressed `.json.gz` trace can contain URLs, source paths, and application behavior. Keep it local unless an upload is explicitly approved.

## Read the report

Evaluate the report in this order:

1. **Capture support**: confirm React detection, build type, React tracks, and Long Animation Frame support
2. **User impact**: inspect the worst interaction, total blocking duration, Largest Contentful Paint (LCP), and Cumulative Layout Shift (CLS)
3. **Browser work**: inspect long frames and script hotspots for event handling, JavaScript, style, layout, and paint cost
4. **React work**: inspect component render count, total self time, and maximum self time
5. **Capture limits**: read every warning, especially dropped event counts

Follow these interpretation rules:

- A high render count is evidence, not a defect. Pair it with duration and user impact
- Generated chunk names identify browser work, not the owning source component
- A slow interaction can be browser-bound even when every component render is cheap
- Repeated Event Timing records with one interaction identifier represent one interaction
- Dropped component events make hotspot totals incomplete
- Use purple labels to identify the active subtree, then use recorded timings to set severity

## Connect measurements to source

Search the repository for measured component display names and event handlers. Confirm that each candidate runs in the recorded flow before reporting it.

Open the DevTools trace when the summary cannot explain a long frame. Correlate the interaction timestamp with script tasks, style or layout work, React tracks, and paint. Do not infer causality from neighboring timestamps alone.

## Report findings

Use this structure:

```markdown
## Flow tested

tested_url, build_type, and exact_interaction

## Verdict

one_evidence_backed_paragraph

## Evidence

| Signal            |                  Measurement | Interpretation  |
| ----------------- | ---------------------------: | --------------- |
| Worst interaction |                  duration_ms | measured_cause  |
| Total blocking    |                  duration_ms | measured_scope  |
| Top component     | render_count and duration_ms | measured_impact |

## Findings

1. `path/to/component.tsx:42`: measured_problem, evidence, and smallest_fix

## Limits

capture_warnings, missing_support, or environmental_caveats
```

Do not pad the report with static lint findings. Include source findings only when runtime evidence connects them to the tested flow.

## Validate a fix

Do not edit code unless code changes are requested. After a fix:

1. Rebuild with the same mode
2. Record the same interaction at the same viewport
3. Run three before and three after samples when timing variance could change the conclusion
4. Compare medians for interaction, blocking, and component duration
5. Confirm behavior and accessibility did not regress

Reject improvements that only move work outside the recorded window or disable useful behavior.
