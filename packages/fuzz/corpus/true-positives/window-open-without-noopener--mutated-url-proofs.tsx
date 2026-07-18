// rule: window-open-without-noopener
// weakness: mutation
export const openMutatedUrl = (blob: Blob, userControlledUrl: string) => {
  URL.createObjectURL = () => userControlledUrl;
  window.open(URL.createObjectURL(blob));

  globalThis.URL = class UnsafeUrl extends URL {
    static createObjectURL = () => userControlledUrl;
  };
  window.open(URL.createObjectURL(blob));

  const popupUrl = new URL("/safe", window.origin);
  popupUrl.href = userControlledUrl;
  window.open(popupUrl.toString());

  URL.prototype.toString = () => userControlledUrl;
  const serializedPopupUrl = new URL("/safe", window.origin);
  window.open(serializedPopupUrl.toString());
};
