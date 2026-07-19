// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 Bugbot review
const previewCache = new Map<string, string | false>();

const createPreview = (blob: Blob | null) => blob && URL.createObjectURL(blob);

export const cachePreview = (id: string, blob: Blob | null) => {
  previewCache.set(id, createPreview(blob));
};
