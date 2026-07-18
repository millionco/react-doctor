// rule: no-create-object-url-without-revoke
// weakness: value-version
// source: PR #1344 deep audit
declare const setPreview: (url: string) => void;
declare const getFallback: () => string;

export const showPreview = (blob: Blob) => {
  let url = URL.createObjectURL(blob);
  setPreview(url);
  url = getFallback();
  URL.revokeObjectURL(url);
};
