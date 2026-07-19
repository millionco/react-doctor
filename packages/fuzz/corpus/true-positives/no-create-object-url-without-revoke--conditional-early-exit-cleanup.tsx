// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 Bugbot review
const makePreview = (blob: Blob) => URL.createObjectURL(blob);

export const attachPreview = (blob: Blob, shouldSkip: boolean, branch: boolean) => {
  const url = makePreview(blob);
  anchor.href = url;
  if (branch) {
    if (shouldSkip) return;
    URL.revokeObjectURL(url);
  } else {
    URL.revokeObjectURL(url);
  }
};
