// rule: no-create-object-url-without-revoke
export const usePreviewUrl = (blob: Blob) => {
  if (blob.size > 0) {
    const previewUrl = URL.createObjectURL(blob);
    setPreviewUrl(previewUrl);
    URL.revokeObjectURL(previewUrl);
  }
};

declare const setPreviewUrl: (url: string) => void;
