export const makePreview = (blob: Blob, enabled: boolean) =>
  enabled ? { src: URL.createObjectURL(blob) } : null;

export const makePreviewList = (blob: Blob, enabled: boolean) =>
  enabled && [URL.createObjectURL(blob)];

export const makeLoggedPreview = (blob: Blob) => (
  console.info(blob.type), { src: URL.createObjectURL(blob) }
);
