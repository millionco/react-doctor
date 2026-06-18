export const trackPageView = () => {
  window.dispatchEvent(new CustomEvent("pageview"));
};
