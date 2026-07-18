// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: PR #1344 Bugbot review
export const createPreview = (blob: Blob, fallbackUrl: string) => {
  const previewUrl = URL.createObjectURL(blob) ?? fallbackUrl;
  return { previewUrl };
};
