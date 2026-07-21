import type { Capability } from "./capability.js";
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

// A project's capabilities (e.g. "server-actions", "nextjs:static-export") are
// one vocabulary describing what it can do. `@react-doctor/core` builds the set
// once and serializes it into the settings bag. Rules use it two ways:
//   build time: a rule's `requires` / `disabledWhen` turn it fully on or off
//     (via `shouldEnableRule` in core, before the lint runs);
//   runtime: `hasCapability(...)` lets a rule that stays on pick its wording.
// Returns false on a missing/malformed bag (the safe default: behave as if the
// project lacks the capability).
export const hasCapability = (settings: RuleContext["settings"], capability: Capability): boolean =>
  getReactDoctorStringArraySetting(settings, "capabilities").includes(capability);

export const hasCapabilityOrUnspecified = (
  settings: RuleContext["settings"],
  capability: Capability,
): boolean => {
  const bag = readReactDoctorSettingsBag(settings);
  if (!bag || readOwnPropertyValue(bag, "capabilities") === undefined) return true;
  return hasCapability(settings, capability);
};
