import * as os from "node:os";

export const lowerChildProcessPriority = (processId: number | undefined): void => {
  if (processId === undefined) return;
  try {
    os.setPriority(processId, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // HACK: Process priority is a responsiveness hint and can be unavailable in restricted hosts.
  }
};
