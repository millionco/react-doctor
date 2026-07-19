// rule: no-create-object-url-without-revoke
// weakness: ownership-transfer
// source: PR #1344 deep audit
const previewCache = new Map<string, { url: string }>();

export const cachePreview = (blob: Blob, id: string) => {
  const previousEntry = previewCache.get(id);
  if (previousEntry) URL.revokeObjectURL(previousEntry.url);
  previewCache.set(id, { url: URL.createObjectURL(blob) });
};

export const clearPreviews = () => {
  previewCache.forEach((entry) => URL.revokeObjectURL(entry.url));
  previewCache.clear();
};
