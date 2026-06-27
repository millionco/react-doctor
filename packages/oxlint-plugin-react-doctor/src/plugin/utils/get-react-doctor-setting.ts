import type { RuleContext } from "./rule-context.js";

// Extracted helpers for reading typed entries out of the `react-doctor`
// settings bag that core writes into the oxlint config (see
// `createOxlintConfig` in `@react-doctor/core`). Both functions:
//   - Guard against the settings bag being missing, an array, or `null`.
//   - Use `Object.getOwnPropertyDescriptor` instead of bracket access
//     so that prototype-pollution-style keys (`__proto__`, …) can't
//     leak inherited values into rule logic.
//   - Filter the returned value by its actual runtime type so a
//     malformed payload (e.g. a `number` where a `string[]` belongs)
//     falls back to a safe default rather than crashing the rule.

const readReactDoctorSettingsBag = (settings: RuleContext["settings"]): object | null => {
  const reactDoctorSettings = settings?.["react-doctor"];
  if (
    typeof reactDoctorSettings !== "object" ||
    reactDoctorSettings === null ||
    Array.isArray(reactDoctorSettings)
  ) {
    return null;
  }
  return reactDoctorSettings;
};

const readOwnPropertyValue = (bag: object, settingName: string): unknown =>
  Object.getOwnPropertyDescriptor(bag, settingName)?.value;

export const getReactDoctorStringSetting = (
  settings: RuleContext["settings"],
  settingName: string,
): string | undefined => {
  const bag = readReactDoctorSettingsBag(settings);
  if (!bag) return undefined;
  const settingValue = readOwnPropertyValue(bag, settingName);
  return typeof settingValue === "string" ? settingValue : undefined;
};

export const getReactDoctorNumberSetting = (
  settings: RuleContext["settings"],
  settingName: string,
): number | undefined => {
  const bag = readReactDoctorSettingsBag(settings);
  if (!bag) return undefined;
  const settingValue = readOwnPropertyValue(bag, settingName);
  return typeof settingValue === "number" && Number.isFinite(settingValue)
    ? settingValue
    : undefined;
};

export const getReactDoctorStringArraySetting = (
  settings: RuleContext["settings"],
  settingName: string,
): ReadonlyArray<string> => {
  const bag = readReactDoctorSettingsBag(settings);
  if (!bag) return [];
  const settingValue = readOwnPropertyValue(bag, settingName);
  if (!Array.isArray(settingValue)) return [];
  return settingValue.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
};

// Whether the project exposes a given capability token (e.g. "server-actions",
// "nextjs:static-export"). The capability set is the single framework-capability
// vocabulary that `@react-doctor/core` serializes into the settings bag — rules
// ask `hasReactDoctorCapability(...)` instead of hardcoding their own framework
// `Set`. Returns `false` on a missing/malformed bag (the safe default: a rule
// that can't see a capability behaves as if the project lacks it).
export const hasReactDoctorCapability = (
  settings: RuleContext["settings"],
  capability: string,
): boolean => getReactDoctorStringArraySetting(settings, "capabilities").includes(capability);
