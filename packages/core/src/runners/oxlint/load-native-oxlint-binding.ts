import { createRequire } from "node:module";
import { isRecord } from "../../utils/is-record.js";
import { resolveNativeOxlintBindingPath } from "./resolve-paths.js";

const bundledRequire = createRequire(new URL("./load-native-oxlint-binding.cjs", import.meta.url));
const bindingByPath = new Map<string, Record<string, unknown> | null>();

export const loadNativeOxlintBinding = (): Record<string, unknown> | null => {
  const bindingPath = resolveNativeOxlintBindingPath();
  if (bindingPath === null) return null;
  const cachedBinding = bindingByPath.get(bindingPath);
  if (cachedBinding !== undefined) return cachedBinding;
  let loadedBinding: unknown;
  try {
    loadedBinding = bundledRequire(bindingPath);
  } catch {
    bindingByPath.set(bindingPath, null);
    return null;
  }
  const binding = isRecord(loadedBinding) ? loadedBinding : null;
  bindingByPath.set(bindingPath, binding);
  return binding;
};
