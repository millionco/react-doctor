import type { ReactDoctorConfig } from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { TUI_MIN_NODE_MAJOR_VERSION } from "./constants.js";

export interface ShouldUseTuiInput {
  readonly flags: InspectFlags;
  readonly userConfig?: ReactDoctorConfig | null;
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
  let requiresStableConfiguredScope = false;
  if (input.userConfig?.scope !== undefined) {
    requiresStableConfiguredScope = input.userConfig.scope !== "full";
  } else if (input.userConfig?.diff !== undefined) {
    requiresStableConfiguredScope =
      input.userConfig.diff !== false && input.userConfig.diff !== "false";
  } else if (input.userConfig?.base !== undefined) {
    requiresStableConfiguredScope = true;
  }
  const requiresStableRenderer =
    flags.verbose === true ||
    flags.outputDir !== undefined ||
    flags.score === true ||
    flags.json === true ||
    flags.jsonCompact === true ||
    flags.jsonOut !== undefined ||
    flags.staged === true ||
    flags.scope !== undefined ||
    flags.base !== undefined ||
    flags.includeUntracked === true ||
    flags.diff !== undefined ||
    flags.changedFilesFrom !== undefined ||
    flags.debug === true ||
    flags.failOn !== undefined ||
    requiresStableConfiguredScope;
  return !requiresStableRenderer;
};
