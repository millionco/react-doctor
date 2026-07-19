// rule: no-create-object-url-without-revoke
// weakness: data-flow
// source: PR #1344 exact-head audit
const previewCache = new Map<string, { preview: { url: string } }>();
const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const replacePreview = (blob: Blob, id: string) => {
  const previous = previewCache.get(id);
  if (previous) URL.revokeObjectURL(previous.preview.url);
  previewCache.set(id, { preview: { url: createPreview(blob) } });
};

export const evictPreview = (id: string, replacement: { preview: { url: string } }) => {
  let entry = previewCache.get(id);
  if (!entry) return;
  entry = replacement;
  const url = entry.preview.url;
  URL.revokeObjectURL(url);
  previewCache.delete(id);
};
