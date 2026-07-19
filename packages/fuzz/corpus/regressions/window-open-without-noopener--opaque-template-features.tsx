// rule: window-open-without-noopener
// weakness: wrapper-transparency
// source: Cursor Bugbot review on PR #1392
import { POPUP_FEATURES } from "./popup-features";

export const openPopup = (destination: string) => {
  window.open(destination, "_blank", `${POPUP_FEATURES}`);
};
