// rule: window-open-without-noopener
// weakness: concat-prefix
export const openHost = (userControlledHost: string) => {
  window.open("https://" + userControlledHost);
  window.open("//" + userControlledHost);
  window.open("" + userControlledHost);
};
