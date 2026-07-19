// rule: no-create-object-url-without-revoke
// weakness: wrapper-transparency
// source: PR #1344 Bugbot review
declare const setPreviewUrl: (url: string) => void;

export const showPreview = (blob: Blob) => {
  setPreviewUrl!(URL.createObjectURL(blob));
};
