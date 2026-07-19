// rule: no-create-object-url-without-revoke
// weakness: ownership-transfer
// source: PR #1344 Bugbot review
const previewCache = new Map<string, { preview: { url: string } }>();
const keyedPreviewCache = new Map<string, { id: string }>();
const makePreview = (blob: Blob) => URL.createObjectURL(blob);

export const cachePreview = (blob: Blob, id: string) => {
  const previous = previewCache.get(id);
  if (previous) URL.revokeObjectURL(previous.preview.url);
  previewCache.set(id, { preview: { url: makePreview(blob) } });
};

export const evictPreview = (id: string) => {
  const entry = previewCache.get(id);
  if (!entry) return;
  const {
    ["preview"]: { [`url`]: url },
  } = entry;
  URL.revokeObjectURL(url);
  previewCache.delete(id);
};

export const cacheKeyedPreview = (blob: Blob, id: string) => {
  const url = makePreview(blob);
  keyedPreviewCache.set(url, { id });
};

export const evictKeyedPreview = (url: string) => {
  URL.revokeObjectURL(url);
  keyedPreviewCache.delete(url);
};
