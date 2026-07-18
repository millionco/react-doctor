// rule: window-open-without-noopener
// weakness: alias-guard
// source: PR #1000 deep audit 2026-07 (Window.open aliases retain the global security semantics)
const openPopup = globalThis.open;
const { open: openFromWindow } = window;
const popupHost = top;
const { open: openFromFrames } = frames;

export const openDestinations = (firstDestination: string, secondDestination: string) => {
  openPopup(firstDestination);
  openFromWindow(secondDestination);
  globalThis.open(firstDestination);
  self.open(secondDestination);
  popupHost.open(firstDestination);
  openFromFrames(secondDestination);
};
