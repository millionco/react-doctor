import { isNativeOxlintRequired } from "./is-native-oxlint-required.js";

export const handleNativeOxlintFailure = (message: string, cause?: unknown): void => {
  if (!isNativeOxlintRequired()) return;
  if (cause === undefined) throw new Error(message);
  throw new Error(message, { cause });
};
