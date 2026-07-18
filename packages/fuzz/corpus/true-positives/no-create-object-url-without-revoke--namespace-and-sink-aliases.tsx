// rule: no-create-object-url-without-revoke
// weakness: alias-resolution
// source: PR #1344 deep audit
const method = "setAttribute";
const attribute = "href";
const setter = Math.random() > 0.5 ? setPreview : setAvatar;

export const attachPreviews = (element: HTMLElement, firstBlob: Blob, secondBlob: Blob) => {
  setter(URL.createObjectURL(firstBlob));
  element[method](attribute, URL.createObjectURL(secondBlob));
};

declare const setAvatar: (url: string) => void;
declare const setPreview: (url: string) => void;
