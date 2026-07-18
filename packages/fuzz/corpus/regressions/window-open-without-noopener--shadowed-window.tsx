// rule: window-open-without-noopener
// weakness: name-heuristic
// source: PR #1000 split deep audit
interface PopupApi {
  open: (url: string) => void;
}

export const openEmbeddedPopup = (window: PopupApi, url: string) => {
  window.open(url);
};
