import type { InspectFlags } from "../utils/inspect-flags.js";
import { inspectAction } from "./inspect.js";

export const designAction = async (directory: string, flags: InspectFlags): Promise<void> =>
  inspectAction(
    directory,
    {
      ...flags,
      design: true,
      lint: flags.lint ?? true,
    },
    "design",
  );
