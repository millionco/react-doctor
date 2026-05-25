import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";

const AGENT_GUIDANCE_LINES = [
  "Treat React Doctor diagnostics as starting hypotheses. Read the relevant code before confirming or suppressing each finding.",
  "For each group, decide true positive, false positive, or needs-human-review, then assign high/medium/low confidence.",
  "Do not suppress a finding without evidence from the file in question. Confidence requires code context.",
  "Understand the root cause before editing. Fix the underlying code instead of changing react-doctor config or suppressing rules unless explicitly asked.",
  "Investigate deeply where relevant: race conditions, security-sensitive flows, state propagation, multi-file refactors, and downstream dependency chains.",
  "Ignore pure style preferences, theoretical issues without real impact, missing features, and unrelated pre-existing code.",
  "Start with high-confidence fixes that preserve behavior. Leave low-confidence or product-dependent changes as notes.",
  "Run `npx react-doctor@latest --verbose --diff` before and after changes, plus relevant tests after each focused batch.",
  "When available, spawn subagents or isolated worktrees for independent rule families, then review and merge only the best safe fixes.",
  "Split unrelated, broad, or behavior-changing work into separate PRs/branches instead of one large cleanup.",
  "If a fix needs an API, UX, or architecture decision, stop and ask before editing.",
] as const;

export const printAgentGuidance = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.log(`${highlighter.bold("Agent guidance")}`);
    for (const line of AGENT_GUIDANCE_LINES) {
      yield* Console.log(highlighter.gray(`  - ${line}`));
    }
    yield* Console.log("");
  });
