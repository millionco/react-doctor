export const usePreview = (blob: Blob, shouldCleanUp: boolean) => {
  const url = URL.createObjectURL(blob);
  setPreview(url);
  if (shouldCleanUp) return () => URL.revokeObjectURL(url);
  return () => {};
};
