const previewCache = new Map<string, string | false>();
const makePreviewUrl = (blob: Blob) => URL.createObjectURL(blob);

export const cachePreview = (id: string, blob?: Blob) => {
  previewCache.set(id, Boolean(blob) && makePreviewUrl(blob!));
};

export const usePreview = (blob?: Blob) => {
  const previewUrl = blob ? makePreviewUrl(blob) : null;
  setPreview(previewUrl);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
};
