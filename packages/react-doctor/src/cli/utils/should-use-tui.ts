import type { InspectFlags } from "./inspect-flags.js";
import { TUI_MIN_NODE_MAJOR_VERSION } from "./constants.js";

export interface ShouldUseTuiInput {
  readonly flags: InspectFlags;
  readonly isNonInteractiveEnvironment: boolean;
  readonly nodeMajorVersion: number;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly supportsRawMode: boolean;
  readonly terminalName?: string;
}

export const shouldUseTui = (input: ShouldUseTuiInput): boolean => {
  if (
    input.isNonInteractiveEnvironment ||
    !input.stdinIsTty ||
    !input.stdoutIsTty ||
    !input.supportsRawMode ||
    input.nodeMajorVersion < TUI_MIN_NODE_MAJOR_VERSION ||
    input.terminalName === "dumb"
  ) {
    return false;
  }

  const flags = input.flags;
  const requiresHeadlessRenderer =
    flags.score === true ||
    flags.json === true ||
    flags.jsonCompact === true ||
    flags.jsonOut !== undefined ||
    flags.staged === true ||
    flags.changedFilesFrom !== undefined;
  return !requiresHeadlessRenderer;
};
