// rule: window-open-without-noopener
// weakness: wrapper-transparency
// source: Bugbot review on PR #1392
export const openParenthesizedUrl = () => {
  // prettier-ignore
  window.open((new URL("/store", window.location.origin)).toString(), "_blank");
};
