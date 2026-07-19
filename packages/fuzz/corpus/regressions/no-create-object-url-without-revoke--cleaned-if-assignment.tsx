export const showPreview = (blob?: Blob) => {
  let previewUrl: string | undefined;
  if (blob) previewUrl = makePreviewUrl(blob);
  setPreview(previewUrl);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
};

const makePreviewUrl = (blob: Blob) => URL.createObjectURL(blob);
