// rule: window-open-without-noopener
// weakness: path-normalization
export const openUnsafePath = (userControlledSuffix: string) => {
  window.open(window.location.pathname.slice(1));
  window.open(window.location.pathname.replace("safe", "/"));
  window.open(`${window.origin}${userControlledSuffix}`);
};
