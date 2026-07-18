// rule: no-create-object-url-without-revoke
// weakness: alias-resolution
// source: PR #1344 deep audit
const method = `setAttribute`;
const attributeBase = `href`;
const attribute = attributeBase;
const srcProperty = `src`;
const aliasedSrcProperty = srcProperty;
const currentBaseProperty = `current`;
const currentProperty = currentBaseProperty;
const setter = Math.random() > 0.5 ? setPreview : setAvatar;

export const attachPreviews = (
  element: HTMLElement,
  previewRef: { current: string },
  firstBlob: Blob,
  secondBlob: Blob,
  thirdBlob: Blob,
  fourthBlob: Blob,
) => {
  setter(URL.createObjectURL(firstBlob));
  element[method](attribute, URL.createObjectURL(secondBlob));
  element[aliasedSrcProperty] = URL.createObjectURL(thirdBlob);
  previewRef[currentProperty] = URL.createObjectURL(fourthBlob);
};

declare const setAvatar: (url: string) => void;
declare const setPreview: (url: string) => void;
