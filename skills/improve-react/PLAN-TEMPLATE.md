# Plan Template

Every `improve-react` plan follows this structure. The executor may be a less
capable model with zero context; include the exact code and exact target state.

```markdown
# NNN — <Short imperative title>

- **Status**: TODO
- **Commit**: <output of `git rev-parse --short HEAD` when written>
- **Severity**: HIGH | MEDIUM | LOW
- **Category**: Bugs & correctness | Performance | Accessibility | Security | Maintainability & architecture
- **Rule**: <plugin>/<rule-id> | Beyond the scan
- **Estimated scope**: <n files, rough size>

## Problem

Cite every location as `path/to/file.tsx:123` and include the relevant current
code verbatim. Explain the user impact and why this is worth doing now.

    // src/features/search/SearchBox.tsx:18 — current
    useEffect(() => {
      setResults(filter(items, query));
    }, [items]);

## Target

Show the exact end code, pulled from the canonical per-rule prompt when this is
a rule-backed finding. Never approximate the fix.

    // target
    useEffect(() => {
      setResults(filter(items, query));
    }, [items, query]);

## Repo conventions to follow

- Follow the repository's memo, hook, and component patterns.
- Imitate one concrete exemplar: `path/to/exemplar.tsx:42`.
- Preserve local naming, import placement, state ownership, and test style.

## Steps

1. At `path/to/file.tsx:123`, make one concrete edit and preserve surrounding behavior.
2. Add or update the focused test at `path/to/file.test.tsx:45`, if the repo's
   conventions cover this behavior.
3. Re-read the diff and remove unrelated churn.

## Boundaries

- Do NOT change public component APIs or user-visible behavior.
- Do NOT add dependencies.
- Keep the change behavior-preserving unless a step explicitly says otherwise.
- STOP if the code has drifted from the commit stamp; report the drift instead
  of improvising.

## Verification

- **Mechanical**:
  - `npx react-doctor@latest --scope changed` clears the targeted diagnostic and
    the score does not regress.
  - Run the repository's typecheck, lint, and focused/full tests.
- **Behavior check**: Interact with `<specific route/control>` and confirm
  `<observable behavior>` is unchanged. For a performance plan, record the
  before/after in the React DevTools Profiler and confirm the unnecessary
  re-render actually dropped; use “Highlight updates” to verify the affected
  subtree no longer flashes.
- **Done when**: the targeted diagnostic is clear, score is not lower, required
  checks pass, and the behavior/Profiler observation matches the target.
```

## Notes for the plan author

- Write one plan per finding. Merge only when findings share every file and the
  same fix pattern.
- Pull the exact fix from the canonical per-rule prompt at
  `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md`, or from
  `npx react-doctor@latest rules explain <rule>`.
- The behavior check is not optional. For performance work, the Profiler and
  “Highlight updates” check are not optional either.
- After writing plans, create or update `plans/README.md` with plan status,
  recommended execution order, and dependencies.
