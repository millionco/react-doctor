// rule: no-create-object-url-without-revoke
// source: PR #1344 deep audit
export const createAsyncPreview = async (blob: Blob) => await URL.createObjectURL(blob);

export const createPreviewRecord = (blob: Blob) => ({
  src: URL.createObjectURL(blob),
});
