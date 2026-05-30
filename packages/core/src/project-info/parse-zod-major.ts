import { getLowestDependencyMajor } from "./utils/dependency-version-spec.js";

export const parseZodMajor = (zodVersion: string | null | undefined): number | null => {
  if (typeof zodVersion !== "string") return null;
  return getLowestDependencyMajor(zodVersion);
};
