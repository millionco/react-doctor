// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: alias-guard
// source: synthetic

export const setCookie = (name: string, value: string) => {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;
};
module.exports = { setCookie: () => undefined };
