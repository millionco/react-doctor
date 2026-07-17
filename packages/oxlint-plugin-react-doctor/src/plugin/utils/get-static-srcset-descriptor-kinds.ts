export const getStaticSrcsetDescriptorKinds = (sourceSet: string): Set<string> | null => {
  if (sourceSet.includes("data:")) return null;
  const descriptorKinds = new Set<string>();
  for (const candidate of sourceSet.split(",")) {
    const parts = candidate.trim().split(/\s+/);
    const descriptor = parts.length > 1 ? (parts.at(-1) ?? "") : "";
    if (/^\d+w$/.test(descriptor)) descriptorKinds.add("width");
    else if (/^(?:\d+(?:\.\d+)?|\.\d+)x$/.test(descriptor) || descriptor === "") {
      descriptorKinds.add("density");
    } else {
      return null;
    }
  }
  return descriptorKinds;
};
