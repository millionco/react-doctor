// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (effect previews: URLs feed a deliberate bounded module-scope cache reused across mounts)
const previewCache = new Map<string, string>();

const renderEffectPreview = async (source: OffscreenCanvas) => {
  const blob = await source.convertToBlob({ type: "image/jpeg" });
  return URL.createObjectURL(blob);
};

export const generateAllPreviews = async (effects: { id: string }[], source: OffscreenCanvas) => {
  for (const def of effects) {
    if (previewCache.has(def.id)) continue;
    const url = await renderEffectPreview(source);
    if (url) previewCache.set(def.id, url);
  }
  return previewCache;
};
