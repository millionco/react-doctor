import { createHash } from "node:crypto";
import type { ReactDoctorConfig } from "@react-doctor/core";

interface SourceFilterConfigInput {
  readonly userConfig: ReactDoctorConfig | null;
  readonly respectInlineDisables: boolean;
}

export const computeSourceFilterConfigHash = (input: SourceFilterConfigInput): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        textComponents: [...new Set(input.userConfig?.textComponents ?? [])].sort(),
        rawTextWrapperComponents: [
          ...new Set(input.userConfig?.rawTextWrapperComponents ?? []),
        ].sort(),
        respectInlineDisables: input.respectInlineDisables,
      }),
    )
    .digest("hex");
