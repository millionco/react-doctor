// rule: window-open-without-noopener
// weakness: url-instance-href
export const openSafeUrl = () => {
  const popupUrl = new URL("/safe", window.origin);
  window.open(popupUrl.href);
};
