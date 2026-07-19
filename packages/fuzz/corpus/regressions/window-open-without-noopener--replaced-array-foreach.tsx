// rule: window-open-without-noopener
// weakness: replaced-array-method
export const capturePopup = (userControlledUrl: string) => {
  const links = [userControlledUrl];
  links.forEach = (callback) => callback(links[0]);
  return links.forEach((href) => window.open(href));
};
