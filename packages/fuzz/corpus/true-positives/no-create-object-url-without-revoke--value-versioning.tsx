// rule: no-create-object-url-without-revoke
// weakness: data-flow
// source: PR #1344 deep audit
const makePreview = (blob: Blob) => URL.createObjectURL(blob);

export const attachPreview = (image: HTMLImageElement, blob: Blob) => {
  let previewUrl = makePreview(blob);
  const originalUrl = previewUrl;
  image.src = originalUrl;
  previewUrl = image.src;
  URL.revokeObjectURL(originalUrl);
};

export const replacePreview = (image: HTMLImageElement, blob: Blob) => {
  let previewUrl = makePreview(blob);
  image.src = previewUrl;
  ({ previewUrl } = { previewUrl: image.src });
  URL.revokeObjectURL(previewUrl);
};
