// rule: no-create-object-url-without-revoke
// weakness: wrapper-transparency
// source: PR #1344 Bugbot review
const previewCache = new Map<string, string>();

const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const cachePreview = (id: string, blob: Blob) => {
  const url = createPreview(blob);
  previewCache.set(id, url);
};
