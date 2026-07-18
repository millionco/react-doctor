// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 deep audit
const createPreview = (blob: Blob) => URL.createObjectURL(blob);

export const attachPreview = (image: HTMLImageElement, blob: Blob, shouldRevoke: boolean) => {
  const url = createPreview(blob);
  image.src = url;
  return () => shouldRevoke && URL.revokeObjectURL(url);
};

export const attachPreviews = (blobs: Blob[], mode: number) => {
  for (const blob of blobs) {
    const url = createPreview(blob);
    setPreview(url);
    switch (mode) {
      case 1:
        continue;
      case 2:
        URL.revokeObjectURL(url);
        break;
      default:
        URL.revokeObjectURL(url);
    }
  }
};

declare const setPreview: (url: string) => void;
