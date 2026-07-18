// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 deep audit
const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const attachPreview = (image: HTMLImageElement, blob: Blob, shouldRevoke: boolean) => {
  const url = createPreview(blob);
  image.src = url;
  return () => shouldRevoke && URL.revokeObjectURL(url);
};
