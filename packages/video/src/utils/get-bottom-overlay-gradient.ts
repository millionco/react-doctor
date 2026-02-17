import {
  OVERLAY_GRADIENT_BOTTOM_ALPHA,
  OVERLAY_GRADIENT_MIDDLE_ALPHA,
  OVERLAY_GRADIENT_MIDDLE_STOP_PERCENT,
  OVERLAY_GRADIENT_RGB,
} from "../constants";

export const getBottomOverlayGradient = (overlayOpacity: number) =>
  `linear-gradient(to top, rgba(${OVERLAY_GRADIENT_RGB}, ${overlayOpacity * OVERLAY_GRADIENT_BOTTOM_ALPHA}) 0%, rgba(${OVERLAY_GRADIENT_RGB}, ${overlayOpacity * OVERLAY_GRADIENT_MIDDLE_ALPHA}) ${OVERLAY_GRADIENT_MIDDLE_STOP_PERCENT}%, rgba(${OVERLAY_GRADIENT_RGB}, 0) 100%)`;
