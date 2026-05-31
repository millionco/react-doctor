---
"@react-doctor/core": patch
---

Fix dead-code analysis silently failing ("Scanning failed (dead-code analysis, non-fatal).") on type-heavy projects. deslop's semantic pass builds a full TypeScript program and walks every identifier through the type checker; on projects with large generic types (tRPC routers, Effect/Zod schemas, deep generics) the checker instantiates enormous types and the child process exceeds Node's default ~4 GB heap, dying with an uncatchable "JavaScript heap out of memory" that surfaced as empty worker output and a non-fatal scan failure. The dead-code worker child is now spawned with `--max-old-space-size=8192` so those projects complete instead of crashing.
