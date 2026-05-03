---
"react-doctor": patch
---

fix(react-doctor): stop flagging `useState` as `useRef` when state reaches render through `useMemo`, derived values, or context `value`

`rerender-state-only-in-handlers` (the rule that suggests "use `useRef`
because this state is never read in render") only checked whether the
state name appeared by name in the component's `return` JSX. That
heuristic produced loud false positives for ordinary patterns:

- state filtered/derived through `useMemo` → JSX uses the memo result
- state passed as the `value` of a React Context Provider
- state combined with other variables into a rendered constant

Following the bad hint and converting these to `useRef` silently broke
apps because `ref.current = …` does not trigger a re-render — search
results stopped updating, dialogs stayed open, and context consumers
saw stale snapshots.

The rule now performs a transitive "render-reachable" analysis on
top-level component bindings. A `useState` is only flagged when neither
the value itself nor anything derived from it (recursively) appears
anywhere in the rendered JSX, including attribute values like
`<Context value={…}>`, `style={…}`, `className={…}`, etc. Truly
transient state (e.g. a scroll position only stored to be ignored)
still fires. Closes #146.
