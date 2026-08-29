---
"oxlint-plugin-react-doctor": patch
---

Fix `no-transition-all` false positive on tw-animate-css entrance/exit animations. The rule was incorrectly flagging `animate-in`/`animate-out` with `duration-*` utilities as transition-all violations. Animation utilities use `duration-*` for animation timing, not transition timing, so they should not be flagged.
