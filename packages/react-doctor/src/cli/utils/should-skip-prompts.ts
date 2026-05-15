import { isNonInteractiveEnvironment } from "./is-non-interactive-environment.js";

interface ShouldSkipPromptsInput {
  yes?: boolean;
  // Inspect-only flags. Both force a full, prompt-free run when set.
  full?: boolean;
  json?: boolean;
}

// Single source of truth for "the user can't (or doesn't want to) answer
// interactive prompts." Used by both `inspect` and `install` so the same
// CI / agent-shell signals skip prompts in both commands.
export const shouldSkipPrompts = (input: ShouldSkipPromptsInput = {}): boolean =>
  Boolean(input.yes) ||
  Boolean(input.full) ||
  Boolean(input.json) ||
  isNonInteractiveEnvironment() ||
  !process.stdin.isTTY;
