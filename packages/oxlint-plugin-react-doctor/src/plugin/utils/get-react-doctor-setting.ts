import type { RuleContext } from "./rule-context.js";

// Reads a single string-valued field out of
// `context.settings["react-doctor"]`. Returns `undefined` whenever the
// `react-doctor` block is missing, isn't a plain object, the field is
// absent, or the field is present but not a string. Centralized so each
// rule (`is-react-native-file`, future rules consuming
// `settings["react-doctor"].framework`, etc.) reads the settings block
// in exactly the same defensive shape — never trusting the prototype
// chain (`Object.getOwnPropertyDescriptor`, not direct lookup) and
// never throwing on a malformed config.
export const getReactDoctorStringSetting = (
  settings: RuleContext["settings"],
  settingName: string,
): string | undefined => {
  const reactDoctorSettings = settings?.["react-doctor"];
  if (
    typeof reactDoctorSettings !== "object" ||
    reactDoctorSettings === null ||
    Array.isArray(reactDoctorSettings)
  ) {
    return undefined;
  }
  const settingValue = Object.getOwnPropertyDescriptor(reactDoctorSettings, settingName)?.value;
  return typeof settingValue === "string" ? settingValue : undefined;
};
