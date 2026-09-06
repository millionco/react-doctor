import { createRequire } from "node:module";
import { isRecord } from "../../utils/is-record.js";
import { handleNativeOxlintFailure } from "./handle-native-oxlint-failure.js";
import { resolveNativeOxlintBindingPath } from "./resolve-paths.js";

const bundledRequire = createRequire(new URL("./load-native-oxlint-binding.cjs", import.meta.url));
const bindingByPath = new Map<string, Record<string, unknown> | null>();

export const loadNativeOxlintBinding = (): Record<string, unknown> | null => {
  const bindingPath = resolveNativeOxlintBindingPath();
  if (bindingPath === null) {
    handleNativeOxlintFailure("The required native Oxlint binding path is not configured.");
    return null;
  }
  const cachedBinding = bindingByPath.get(bindingPath);
  if (cachedBinding !== undefined) {
    if (cachedBinding === null) {
      handleNativeOxlintFailure(
        `Unable to load the required native Oxlint binding at ${bindingPath}.`,
      );
      return null;
    }
    return cachedBinding;
  }
  let loadedBinding: unknown;
  try {
    loadedBinding = bundledRequire(bindingPath);
  } catch (error) {
    bindingByPath.set(bindingPath, null);
    handleNativeOxlintFailure(
      `Unable to load the required native Oxlint binding at ${bindingPath}.`,
      error,
    );
    return null;
  }
  const binding = isRecord(loadedBinding) ? loadedBinding : null;
  bindingByPath.set(bindingPath, binding);
  if (binding === null) {
    handleNativeOxlintFailure(
      `The required native Oxlint binding at ${bindingPath} returned an invalid module.`,
    );
    return null;
  }
  return binding;
};
