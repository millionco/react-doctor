// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 Bugbot review
const previewCache = new Map<string, string>();

const renderEffectPreview = async (source: OffscreenCanvas) => {
  const blob = await source.convertToBlob({ type: "image/jpeg" });
  return URL.createObjectURL(blob);
};

export const generateAllPreviews = async (effects: { id: string }[], source: OffscreenCanvas) => {
  for (const effect of effects) {
    if (previewCache.has(effect.id)) continue;
    const url = await renderEffectPreview(source);
    if (url) previewCache.set(effect.id, url);
  }
  return previewCache;
};
