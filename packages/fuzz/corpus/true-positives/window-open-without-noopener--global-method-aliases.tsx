// rule: window-open-without-noopener
// weakness: alias-guard
// source: PR #1000 deep audit 2026-07 (Window.open aliases retain the global security semantics)
const openPopup = globalThis.open;
const { open: openFromWindow } = window;

export const openDestinations = (firstDestination: string, secondDestination: string) => {
  openPopup(firstDestination);
  openFromWindow(secondDestination);
};
