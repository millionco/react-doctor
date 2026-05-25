import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";

const AGENT_GUIDANCE_LINES = [
  "Triage diagnostics before editing: mark true positives, false positives, or needs-human-review.",
  "Assign high/medium/low confidence and start with high-confidence, low-risk fixes.",
  "Group related diagnostics by root cause before making changes.",
  "Split unrelated or behavior-changing work into separate PRs/branches.",
  "Run relevant tests after each focused batch.",
] as const;

export const printAgentGuidance = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.log(`${highlighter.bold("Agent guidance")}`);
    for (const line of AGENT_GUIDANCE_LINES) {
      yield* Console.log(highlighter.gray(`  - ${line}`));
    }
    yield* Console.log("");
  });
