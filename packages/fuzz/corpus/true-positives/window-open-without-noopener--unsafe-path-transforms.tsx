// rule: window-open-without-noopener
// weakness: path-normalization
export const openUnsafePath = () => {
  window.open(window.location.pathname.slice(1));
};
