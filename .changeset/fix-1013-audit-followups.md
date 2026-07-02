---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

fix(rules): close three follow-up gaps in the 20-day audit fixes

- **Comment stripper**: `isRegexLiteralStart` now uses a Unicode-aware
  identifier class, so a division after a non-ASCII identifier (`café / total`,
  `合計 / 個数`) is no longer misread as a regex literal — which had blanked
  real code up to the next slash and let `/* … */` comment bodies escape
  stripping across the pattern-based security-scan rules.
- **`server-auth-actions`**: the cache/navigation exemption now requires the
  callee to resolve to _any_ import rather than specifically `next/cache` /
  `next/navigation`. A module-local `const revalidatePath = …` (a privileged
  shadow) is still flagged, but a revalidation-only action importing through a
  common re-export barrel (`import { revalidatePath } from "@/lib/cache"`) is no
  longer a false positive.
- **`rn-no-raw-text`**: fragment piercing now sees through named
  `<Fragment>` / `<React.Fragment>` (via the existing `isJsxFragmentElement`
  helper), not only the shorthand `<>`, so children forwarded through a named
  fragment into a host are classified the same as the shorthand form.
