import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";

export const shouldUseCuratedPortBehavior = (
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => getReactDoctorStringSetting(settings, "portedRuleMode") === "curated";
