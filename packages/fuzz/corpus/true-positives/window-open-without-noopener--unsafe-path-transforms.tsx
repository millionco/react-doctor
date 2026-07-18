// rule: window-open-without-noopener
// weakness: path-normalization
const getLocation = () => window.location;

export const openUnsafePath = (userControlledSuffix: string) => {
  window.open(window.location.pathname.slice(1));
  window.open(window.location.pathname.replace("safe", "/"));
  window.open(getLocation().pathname?.replace("/iframe/", "/main/") ?? "", "_blank");
  window.open(`${window.origin}${userControlledSuffix}`);
};
