// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 Bugbot review
const previewCache = new Map<string, string>();

const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const cachePreview = async (id: string, blob: Blob) => {
  previewCache.set(id, await createPreview(blob));
};
