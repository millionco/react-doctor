import { inspectAction } from "./inspect.js";

interface WhyOptions {
  cwd?: string;
  project?: string;
}

/**
 * `why <file:line>` — explains why a rule fired (or why a suppression didn't
 * apply) at a specific location. A thin wrapper over the inspect flow's
 * single-location explain path so it reuses the same scan, config resolution,
 * and clean error handling. (Replaces the former `--explain` / `--why` flags.)
 */
export const whyAction = async (location: string, options: WhyOptions): Promise<void> => {
  await inspectAction(options.cwd ?? process.cwd(), {
    explain: location,
    project: options.project,
  });
};
