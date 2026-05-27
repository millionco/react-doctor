// Reads a per-rule settings object out of the host's `settings`
// dictionary, keyed under `settings["react-doctor"][<settingsKey>]`.
// Every Solid rule that accepts options funnels through here so the
// "is this nested under the react-doctor namespace?" check is in one
// place — mirrors the same shape used by `alt-text` / `get-element-type`
// for jsx-a11y settings, just under a different parent key.
export const readSolidRuleSettings = <Shape extends object>(
  settings: Readonly<Record<string, unknown>> | undefined,
  settingsKey: string,
): Shape => {
  const reactDoctorBlock = settings?.["react-doctor"];
  if (
    typeof reactDoctorBlock !== "object" ||
    reactDoctorBlock === null ||
    Array.isArray(reactDoctorBlock)
  ) {
    return {} as Shape;
  }
  const ruleBlock = Object.getOwnPropertyDescriptor(reactDoctorBlock, settingsKey)?.value;
  if (typeof ruleBlock !== "object" || ruleBlock === null) return {} as Shape;
  return ruleBlock as Shape;
};
