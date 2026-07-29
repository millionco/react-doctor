import * as Effect from "effect/Effect";
import type { ReactDoctorConfig } from "../../core/core-configuration.js";
import type { ProjectInfo } from "../../core/core-types.js";

export interface PrintProjectDetectionInput {
  readonly projectInfo: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly isDiffMode: boolean;
  readonly includePaths: ReadonlyArray<string>;
  readonly lintSourceFileCount: number | undefined;
}

export const printProjectDetection = (_input: PrintProjectDetectionInput): Effect.Effect<void> =>
  Effect.void;
