// rule: window-open-without-noopener
// weakness: wrapper-transparency
// source: PR #1000 split deep audit
export const openUntrustedPopup = (url: string) => {
  window["open"](url);
};
