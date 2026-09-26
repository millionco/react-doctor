---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Soften await parallelization messaging to acknowledge uncertainty

The `server-sequential-independent-await` and `async-await-in-loop` rules now use conditional language that acknowledges parallelization only helps when work is truly independent. The messages explicitly mention the requirements: no shared queues, transactions, ordering constraints, or synchronous work behind async facades.

**Changed messages:**
- `server-sequential-independent-await`: Now says "These awaits appear independent, but parallelization only improves performance when work doesn't share queues, transactions, or resources. Verify independence, then consider \`Promise.all([...])\`."
- `async-await-in-loop`: Now says "This loop runs awaits sequentially. Parallelization may improve performance if work is truly independent (no shared queues, transactions, or ordering requirements). Verify before applying..."

**Detection unchanged:** The rules still fire on the same patterns. No new exemptions were added. The fix addresses messaging accuracy, not detection scope.

Fixes #1840
