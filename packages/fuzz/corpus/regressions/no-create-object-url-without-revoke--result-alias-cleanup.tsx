// rule: no-create-object-url-without-revoke
// weakness: alias-resolution
// source: PR #1344 deep audit
export const makePreview = (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const originalUrl = url;
  return () => URL.revokeObjectURL(originalUrl);
};
