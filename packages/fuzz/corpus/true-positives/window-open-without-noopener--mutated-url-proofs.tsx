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

  const lateMutatedPopupUrl = new URL("/safe", window.origin);
  URL.prototype.toJSON = () => userControlledUrl;
  window.open(lateMutatedPopupUrl.toJSON());

  const implicitlySerializedPopupUrl = new URL("/safe", window.origin);
  URL.prototype.toString = () => userControlledUrl;
  window.open(`${implicitlySerializedPopupUrl}`);

  const aliasedPopupUrl = new URL("/safe", window.origin);
  const popupUrlAlias = aliasedPopupUrl;
  URL.prototype.toString = () => userControlledUrl;
  window.open(popupUrlAlias);

  const nestedHrefPopupUrl = new URL("/safe", window.origin);
  const getNestedPopupHref = () => nestedHrefPopupUrl.href;
  const openNestedPopupHref = () => {
    nestedHrefPopupUrl.href = userControlledUrl;
    window.open(getNestedPopupHref());
  };
  openNestedPopupHref();

  const nestedInstancePopupUrl = new URL("/safe", window.origin);
  const getNestedPopupUrl = () => nestedInstancePopupUrl;
  const openNestedPopupUrl = () => {
    nestedInstancePopupUrl.href = userControlledUrl;
    window.open(getNestedPopupUrl());
  };
  openNestedPopupUrl();
};
