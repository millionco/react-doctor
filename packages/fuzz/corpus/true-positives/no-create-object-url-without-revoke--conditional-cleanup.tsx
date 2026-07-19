const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const usePreview = (blob: Blob, shouldCleanUp: boolean) => {
  const url = createPreview(blob);
  setPreview(url);
  if (shouldCleanUp) return () => URL.revokeObjectURL(url);
  return () => {};
};
