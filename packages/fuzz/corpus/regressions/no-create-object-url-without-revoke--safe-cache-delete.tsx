// rule: no-create-object-url-without-revoke
// weakness: ownership-transfer
// source: PR #1344 deep audit
const previewCache = new Map<string, string>();

export const cachePreview = (blob: Blob, id: string) => {
  const previousUrl = previewCache.get(id);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  previewCache.set(id, URL.createObjectURL(blob));
};

export const evictPreview = (id: string) => {
  const url = previewCache.get(id);
  if (url) URL.revokeObjectURL(url);
  previewCache.delete(id);
};
