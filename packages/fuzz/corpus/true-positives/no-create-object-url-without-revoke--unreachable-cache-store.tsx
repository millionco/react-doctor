// rule: no-create-object-url-without-revoke
// source: PR #1344 deep audit
const previewCache = new Map<string, string>();
const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const preview = createPreview(new Blob());

if (preview.length < 0) previewCache.set("preview", preview);
