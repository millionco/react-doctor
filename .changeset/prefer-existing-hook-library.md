---
"oxlint-plugin-react-doctor": patch
---

Add `prefer-existing-hook-library` (Maintainability, warn): catches top-level custom hooks whose names match a hook already shipped by `react-use` or `usehooks-ts` (`useDebounce`, `useLocalStorage`, `useOnClickOutside`, `useToggle`, `usePrevious`, `useEventListener`, `useInterval`, `useMount`, `useUpdateEffect`, … ~95 names in total). Hand-rolled versions of these hooks commonly miss SSR safety, cleanup races, stale closures on identity-unstable callbacks, and Strict-Mode double-fire semantics that the library hooks already handle.

- Detection is **name-based + scope-aware**: only module-level `FunctionDeclaration` / `VariableDeclarator` whose body actually contains React hook calls are flagged. Hooks defined inside another component or hook, utilities that happen to start with `use` but never call a hook, pure re-exports (`export { useDebounce } from "..."`), and single-statement delegation wrappers (including renamed-import facades like `import { useDebounce as upstream } from "react-use"; export const useDebounce = (v) => upstream(v, 500)`) are skipped.
- Ambiguous names that clash with React, routing libraries, or animation libraries (`useLocation`, `useEvent`, `useEventCallback`, `useSearchParams`, `useNavigation`, `useRouter`, `useSpring`, `useHash`) are intentionally excluded from the match list so the rule stays high-precision.
- Tagged `test-noise` so test / fixture / story files auto-skip the check.
