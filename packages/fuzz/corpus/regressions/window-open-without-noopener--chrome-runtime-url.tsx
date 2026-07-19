// rule: window-open-without-noopener
// weakness: framework-gating
// source: PR #1402 Daytona parity audit (yosevu/react-chrome-extension-template options page)
export const openOptionsPage = () => {
  window.open(chrome.runtime.getURL("options.html"));
};
