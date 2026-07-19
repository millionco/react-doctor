// rule: no-create-object-url-without-revoke
// source: PR #1344 Bugbot review
export const assignPreviewUrl = (anchor: HTMLAnchorElement, blob: Blob) => {
  anchor.href = URL.createObjectURL(blob) as string;
};
