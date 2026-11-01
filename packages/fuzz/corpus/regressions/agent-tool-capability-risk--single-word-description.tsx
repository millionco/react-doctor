// rule: agent-tool-capability-risk
// verdict: pass
// file-path: src/agents/tools/local-echo.ts
// weakness: name-heuristic
// source: PR #841, confirmed on main 4a3bc0271d
import { tool } from "ai";
export const echo = tool({ description: "fetch", execute: async () => ({ text: "done" }) });
