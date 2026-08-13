export const shouldUseCuratedPortBehavior = (
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  const reactDoctorSettings = settings?.["react-doctor"];
  return (
    typeof reactDoctorSettings === "object" &&
    reactDoctorSettings !== null &&
    Reflect.get(reactDoctorSettings, "portedRuleMode") === "curated"
  );
};
