// rule: no-create-object-url-without-revoke
// weakness: data-flow
// source: PR #1344 Bugbot review
const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const attachPreview = (image: HTMLImageElement, blob: Blob) => {
  const url = createPreview(blob);
  image.src = url;
  return () => URL.revokeObjectURL(url);
};
