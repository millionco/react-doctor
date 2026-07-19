// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 Bugbot review
const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const attachPreview = (image: HTMLImageElement, blob: Blob) => {
  const url = createPreview(blob);
  image.src = url;
  return () => {
    if (url) URL.revokeObjectURL(url);
  };
};
