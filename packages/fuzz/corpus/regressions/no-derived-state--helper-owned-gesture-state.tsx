// rule: no-derived-state
// weakness: control-flow-provenance
// source: pedropalau/react-bnb-gallery@0809f0f2918f03ded37a505cf4b85bcd8e0a79c9
import { useCallback, useEffect, useState } from "react";

export const Gallery = ({ activePhotoIndex }: { activePhotoIndex: number }) => {
  const [zoomPhotoIndex, setZoomPhotoIndex] = useState<number | null>(null);
  const clearZoomForPhoto = useCallback((photoIndex: number) => setZoomPhotoIndex(photoIndex), []);
  const updateZoom = useCallback((photoIndex: number | null) => setZoomPhotoIndex(photoIndex), []);

  useEffect(() => {
    clearZoomForPhoto(activePhotoIndex);
  }, [activePhotoIndex, clearZoomForPhoto]);

  return (
    <button onWheel={() => updateZoom(activePhotoIndex)}>
      {zoomPhotoIndex === activePhotoIndex ? "Zoomed" : "Idle"}
    </button>
  );
};
