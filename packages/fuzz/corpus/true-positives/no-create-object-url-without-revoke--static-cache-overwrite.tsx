// rule: no-create-object-url-without-revoke
// weakness: ownership-transfer
// source: PR #1344 deep audit
const previewCache = new Map<string, string>();
const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const cachePreview = (blob: Blob) => {
  previewCache.set("same", createPreview(blob));
};
