---
"react-doctor": patch
---

Add anonymized telemetry for which rules users silence. A `rule.disabled` counter records config off-switches (`rules: "off"` and `ignore.rules`, keyed by canonicalized rule + source) once per scan, and a `rule.suppressed` counter records findings the diagnostic pipeline dropped per user intent — config off-switch, per-path `ignore.overrides` entry, or inline `react-doctor-disable*` comment — with per-source rollups (`diag.suppressed*`) on the per-scan wide event. No rule identity ever rode telemetry for silenced rules before, so rule-rejection (the strongest false-positive signal) was unmeasurable.
