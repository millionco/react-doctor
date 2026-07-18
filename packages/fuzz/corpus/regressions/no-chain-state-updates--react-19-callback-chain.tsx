// rule: no-chain-state-updates
// weakness: framework-gating
// source: react-bench GxmdkB6, pedropalau/react-bnb-gallery at 0809f0f
// react-major: 19

import { useCallback, useEffect, useRef, useState } from "react";

export const Gallery = ({ activePhotoIndex, photos, wrap }) => {
  const [zoom, setZoom] = useState({ scale: 1, panX: 0, panY: 0 });
  const [state, setState] = useState({ activePhotoIndex: 0, hidePrevButton: false });
  const zoomRef = useRef(zoom);
  const setZoomState = useCallback((nextZoom) => {
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  }, []);
  const resetZoom = useCallback(() => setZoomState({ scale: 1, panX: 0, panY: 0 }), [setZoomState]);

  useEffect(() => {
    setState((previousState) => ({
      ...previousState,
      activePhotoIndex,
      hidePrevButton: photos.length === 0 || !wrap,
    }));
    resetZoom();
  }, [activePhotoIndex, photos, resetZoom, wrap]);

  return (
    <button type="button" onClick={() => setZoomState({ scale: 2, panX: 0, panY: 0 })}>
      {zoom.scale + state.activePhotoIndex}
    </button>
  );
};
