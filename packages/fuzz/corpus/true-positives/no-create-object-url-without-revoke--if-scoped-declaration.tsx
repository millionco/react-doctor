// rule: no-create-object-url-without-revoke
export const storePreviewUrl = (blob: Blob) => {
  if (blob.size > 0) {
    const previewUrl = URL.createObjectURL(blob);
    setPreviewUrl(previewUrl);
  }
};

declare const setPreviewUrl: (url: string) => void;
