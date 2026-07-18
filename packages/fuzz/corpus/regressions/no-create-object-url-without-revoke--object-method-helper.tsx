// rule: no-create-object-url-without-revoke
// weakness: false-positive
// source: PR #1344 Bugbot review
const previewHelpers = {
  create: (blob: Blob) => URL.createObjectURL(blob),
};
const helperAlias = previewHelpers;
const method = "create";

export const usePreview = (blob: Blob) => {
  const url = helperAlias[method](blob);
  URL.revokeObjectURL(url);
};
