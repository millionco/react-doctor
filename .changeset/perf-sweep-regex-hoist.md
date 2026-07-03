---
"oxlint-plugin-react-doctor": patch
---

perf: regex-hoist sweep — ~8 per-call RegExp constructions move to module scope or behind cheap gates (public-env secret-name global pattern hoisted, supabase RLS enables collected in one pass instead of per-table compile+slice, dangerous-html-sink inert-target and serializer exemptions gated/lazy, design color/duration parsers get first-char and substring discriminators)
