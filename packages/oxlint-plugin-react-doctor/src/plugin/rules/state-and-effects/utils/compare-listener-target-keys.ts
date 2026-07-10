export const compareListenerTargetKeys = (
  firstTargetKey: string,
  secondTargetKey: string,
): "same" | "different" | "unknown" => {
  if (firstTargetKey === secondTargetKey) return "same";
  if (firstTargetKey.startsWith("global:") && secondTargetKey.startsWith("global:")) {
    return "different";
  }
  if (firstTargetKey.startsWith("fresh:") || secondTargetKey.startsWith("fresh:")) {
    return "different";
  }
  return "unknown";
};
