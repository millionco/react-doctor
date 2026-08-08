// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 686ca2a44bc83a072d4d4dd3fd950ae2c2faf352bd0f78d1545e4fa19d01c750
import type { TouchEvent as ReactTouchEvent, WheelEvent } from 'react';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { DIRECTION_NEXT, DIRECTION_PREV } from '../constants';
import { defaultPhrases } from '../default-phrases';
import type {
  GalleryController,
  GalleryPhoto,
  GalleryPhrases,
} from '../types/gallery';
import { Caption } from './caption';
import { NextButton } from './next-button';
import { Photo } from './photo';
import { PrevButton } from './prev-button';

interface GalleryProps {
  activePhotoIndex?: number;
  activePhotoPressed?: () => void;
  direction?: string;
  light?: boolean;
  nextButtonPressed?: () => void;
  onActivePhotoIndexChange?: (index: number) => void;
  phrases?: GalleryPhrases;
  photos?: GalleryPhoto[];
  preloadSize?: number;
  prevButtonPressed?: () => void;
  showThumbnails?: boolean;
  wrap?: boolean;
  enableZoom?: boolean;
}

interface TouchInfo {
  screenX: number;
}

interface GalleryState {
  activePhotoIndex: number;
  hidePrevButton: boolean;
  hideNextButton: boolean;
  controlsDisabled: boolean;
  touchStartInfo: TouchInfo | null;
  touchEndInfo: TouchInfo | null;
  touchMoved: boolean;
}

const EMPTY_PHOTOS: GalleryPhoto[] = [];

function getNormalizedActivePhotoIndex(
  activePhotoIndex: number,
  totalPhotos: number,
): number {
  if (totalPhotos === 0) {
    return 0;
  }
  return Math.min(Math.max(activePhotoIndex, 0), totalPhotos - 1);
}

function getWrapControlState(
  activePhotoIndex: number,
  totalPhotos: number,
  wrap: boolean,
) {
  if (wrap || totalPhotos <= 1) {
    return {
      hidePrevButton: false,
      hideNextButton: false,
    };
  }
  return {
    hidePrevButton: activePhotoIndex === 0,
    hideNextButton: activePhotoIndex === totalPhotos - 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getLetterboxedSize(
  naturalW: number,
  naturalH: number,
  viewportW: number,
  viewportH: number,
): { width: number; height: number } {
  if (naturalW <= 0 || naturalH <= 0 || viewportW <= 0 || viewportH <= 0) {
    return { width: viewportW, height: viewportH };
  }
  const natAspect = naturalW / naturalH;
  const vpAspect = viewportW / viewportH;
  if (natAspect > vpAspect) {
    return { width: viewportW, height: viewportW / natAspect };
  } else {
    return { width: viewportH * natAspect, height: viewportH };
  }
}

function getMaxPan(
  renderedWidth: number,
  renderedHeight: number,
  viewportW: number,
  viewportH: number,
  scale: number,
): { x: number; y: number } {
  const maxX = Math.max(0, (renderedWidth * scale - viewportW) / 2);
  const maxY = Math.max(0, (renderedHeight * scale - viewportH) / 2);
  return { x: maxX, y: maxY };
}

function clampPan(
  panX: number,
  panY: number,
  scale: number,
  rendered: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const { x: maxX, y: maxY } = getMaxPan(
    rendered.width,
    rendered.height,
    viewport.width,
    viewport.height,
    scale,
  );
  return {
    x: maxX === 0 ? 0 : clamp(panX, -maxX, maxX),
    y: maxY === 0 ? 0 : clamp(panY, -maxY, maxY),
  };
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

const Gallery = forwardRef<GalleryController, GalleryProps>(function Gallery(
  {
    activePhotoIndex = 0,
    activePhotoPressed,
    light = false,
    nextButtonPressed,
    onActivePhotoIndexChange,
    phrases = defaultPhrases,
    photos = EMPTY_PHOTOS,
    preloadSize = 5,
    prevButtonPressed,
    showThumbnails = true,
    wrap = false,
    enableZoom = true,
  },
  ref,
) {
  const normalizedPropIndex = getNormalizedActivePhotoIndex(
    activePhotoIndex,
    photos.length,
  );

  const [state, setState] = useState<GalleryState>(() => {
    const { hidePrevButton, hideNextButton } = getWrapControlState(
      normalizedPropIndex,
      photos.length,
      wrap,
    );
    return {
      activePhotoIndex: normalizedPropIndex,
      hidePrevButton,
      hideNextButton,
      controlsDisabled: true,
      touchStartInfo: null,
      touchEndInfo: null,
      touchMoved: false,
    };
  });

  const [zoom, setZoom] = useState(() => ({
    scale: 1,
    panX: 0,
    panY: 0,
  }));

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const naturalSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
    moved: boolean;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startPan: { x: 0, y: 0 },
    moved: false,
  });

  const pinchRef = useRef<{
    isPinching: boolean;
    startDistance: number;
    startScale: number;
    startPan: { x: number; y: number };
    startMidViewport: { x: number; y: number };
  }>({
    isPinching: false,
    startDistance: 0,
    startScale: 1,
    startPan: { x: 0, y: 0 },
    startMidViewport: { x: 0, y: 0 },
  });

  const suppressClickRef = useRef(false);
  const suppressSwipeRef = useRef(false);

  const getViewportSize = useCallback((): { width: number; height: number } => {
    const el = viewportRef.current;
    if (!el) {
      return { width: 0, height: 0 };
    }
    const rect = el.getBoundingClientRect();
    const width = (rect as any).width || el.clientWidth || 0;
    const height = (rect as any).height || el.clientHeight || 0;
    return { width, height };
  }, []);

  const getNaturalSize = useCallback(() => {
    const img = imageRef.current as any;
    if (img) {
      const w = img.naturalWidth || naturalSizeRef.current.w || 0;
      const h = img.naturalHeight || naturalSizeRef.current.h || 0;
      if (w > 0 && h > 0) {
        return { w, h };
      }
    }
    return naturalSizeRef.current;
  }, []);

  const getRenderedSize = useCallback(() => {
    const vp = getViewportSize();
    const nat = getNaturalSize();
    if (nat.w > 0 && nat.h > 0 && vp.width > 0 && vp.height > 0) {
      return getLetterboxedSize(nat.w, nat.h, vp.width, vp.height);
    }
    const img = imageRef.current as any;
    if (img) {
      const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0 };
      const iw = (rect as any).width || img.width || 0;
      const ih = (rect as any).height || img.height || 0;
      if (iw > 0 && ih > 0) {
        const scale = zoomRef.current.scale || 1;
        return { width: iw / scale, height: ih / scale };
      }
    }
    return { width: vp.width, height: vp.height };
  }, [getViewportSize, getNaturalSize]);

  const resetZoom = useCallback(() => {
    setZoom({ scale: 1, panX: 0, panY: 0 });
    dragRef.current.isDragging = false;
    pinchRef.current.isPinching = false;
    suppressClickRef.current = false;
    suppressSwipeRef.current = false;
  }, []);

  const isPendingPhotoChange = normalizedPropIndex !== state.activePhotoIndex;

  useEffect(() => {
    const { hidePrevButton, hideNextButton } = getWrapControlState(
      normalizedPropIndex,
      photos.length,
      wrap,
    );

    setState((prevState) => {
      const indexChanged = prevState.activePhotoIndex !== normalizedPropIndex;
      if (
        !indexChanged &&
        prevState.hidePrevButton === hidePrevButton &&
        prevState.hideNextButton === hideNextButton
      ) {
        return prevState;
      }
      if (indexChanged) {
        setZoom({ scale: 1, panX: 0, panY: 0 });
        dragRef.current.isDragging = false;
        pinchRef.current.isPinching = false;
        suppressClickRef.current = false;
        suppressSwipeRef.current = false;
      }
      return {
        ...prevState,
        activePhotoIndex: normalizedPropIndex,
        hidePrevButton,
        hideNextButton,
      };
    });
  }, [normalizedPropIndex, photos.length, wrap]);

  useEffect(() => {
    onActivePhotoIndexChange?.(state.activePhotoIndex);
  }, [onActivePhotoIndexChange, state.activePhotoIndex]);

  useEffect(() => {
    if (!enableZoom) {
      resetZoom();
    }
  }, [enableZoom, resetZoom]);

  const getItemByDirection = useCallback(
    (direction: string, activeIndex: number) => {
      if (photos.length === 0) {
        return 0;
      }
      const isNextDirection = direction === DIRECTION_NEXT;
      const isPrevDirection = direction === DIRECTION_PREV;
      const lastItemIndex = photos.length - 1;
      const isGoingToWrap =
        (isPrevDirection && activeIndex === 0) ||
        (isNextDirection && activeIndex === lastItemIndex);

      if (isGoingToWrap && !wrap) {
        return activeIndex;
      }

      const delta = isPrevDirection ? -1 : 1;
      const itemIndex = (activeIndex + delta) % photos.length;
      return itemIndex === -1 ? photos.length - 1 : itemIndex;
    },
    [photos, wrap],
  );

  const move = useCallback(
    (direction: string, index: number | false = false) => {
      setZoom({ scale: 1, panX: 0, panY: 0 });
      dragRef.current.isDragging = false;
      pinchRef.current.isPinching = false;
      suppressClickRef.current = false;
      suppressSwipeRef.current = false;

      setState((prevState) => {
        const nextElementIndex =
          index !== false
            ? index
            : getItemByDirection(direction, prevState.activePhotoIndex);

        const { hidePrevButton, hideNextButton } = getWrapControlState(
          nextElementIndex,
          photos.length,
          wrap,
        );

        return {
          ...prevState,
          activePhotoIndex: nextElementIndex,
          hidePrevButton,
          hideNextButton,
        };
      });
    },
    [getItemByDirection, photos.length, wrap],
  );

  const prev = useCallback(() => {
    move(DIRECTION_PREV);
  }, [move]);

  const next = useCallback(() => {
    move(DIRECTION_NEXT);
  }, [move]);

  useImperativeHandle(
    ref,
    () => ({
      prev,
      next,
    }),
    [prev, next],
  );

  const onNextButtonPress = useCallback(() => {
    next();
    nextButtonPressed?.();
  }, [next, nextButtonPressed]);

  const onPrevButtonPress = useCallback(() => {
    prev();
    prevButtonPressed?.();
  }, [prev, prevButtonPressed]);

  const onPhotoLoad = useCallback(() => {
    setState((prevState) => ({ ...prevState, controlsDisabled: false }));
    const img = imageRef.current as any;
    if (img) {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && h > 0) {
        naturalSizeRef.current = { w, h };
      }
    }
  }, []);

  const onPhotoError = useCallback(() => {
    setState((prevState) => ({ ...prevState, controlsDisabled: false }));
  }, []);

  const onPhotoPress = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (enableZoom && zoomRef.current.scale > 1) {
      return;
    }
    move(DIRECTION_NEXT);
    activePhotoPressed?.();
  }, [activePhotoPressed, move, enableZoom]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!enableZoom) {
        return;
      }
      const vpEl = viewportRef.current;
      if (!vpEl) return;
      const rect = vpEl.getBoundingClientRect();
      const vpSize = {
        width: (rect as any).width || vpEl.clientWidth || 0,
        height: (rect as any).height || vpEl.clientHeight || 0,
      };

      const current = zoomRef.current;
      const oldScale = current.scale;
      const oldPan = { x: current.panX, y: current.panY };

      let newScale = oldScale * Math.exp(-(event as any).deltaY * 0.0015);
      newScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
      if (Math.abs(newScale - oldScale) < 0.001) {
        if (newScale > 1) {
          suppressClickRef.current = true;
          suppressSwipeRef.current = true;
        }
        return;
      }

      event.preventDefault();

      const clientX = (event as any).clientX ?? rect.left + vpSize.width / 2;
      const clientY = (event as any).clientY ?? rect.top + vpSize.height / 2;
      const focalX = clientX - (rect.left + vpSize.width / 2);
      const focalY = clientY - (rect.top + vpSize.height / 2);

      let newPanX: number;
      let newPanY: number;
      if (newScale === 1) {
        newPanX = 0;
        newPanY = 0;
      } else {
        newPanX = focalX - (focalX - oldPan.x) * (newScale / oldScale);
        newPanY = focalY - (focalY - oldPan.y) * (newScale / oldScale);
      }

      const nat = getNaturalSize();
      const rendered =
        nat.w > 0 && nat.h > 0 && vpSize.width > 0 && vpSize.height > 0
          ? getLetterboxedSize(nat.w, nat.h, vpSize.width, vpSize.height)
          : getRenderedSize();

      const clamped = clampPan(newPanX, newPanY, newScale, rendered, vpSize);

      setZoom({ scale: newScale, panX: clamped.x, panY: clamped.y });

      if (newScale > 1) {
        suppressClickRef.current = true;
        suppressSwipeRef.current = true;
      } else {
        suppressClickRef.current = false;
        suppressSwipeRef.current = false;
      }
    },
    [enableZoom, getNaturalSize, getRenderedSize],
  );

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLButtonElement | HTMLDivElement>) => {
      const touches = (event as any).targetTouches as TouchList;
      if (!touches) return;
      if (!enableZoom) {
        if (touches.length === 1) {
          setState((prev) => ({
            ...prev,
            touchStartInfo: { screenX: (touches[0] as any).screenX ?? touches[0].clientX },
          }));
        }
        return;
      }

      if (touches.length === 2) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;
        const midX = (touches[0].clientX + touches[1].clientX) / 2;
        const midY = (touches[0].clientY + touches[1].clientY) / 2;
        const vpEl = viewportRef.current;
        const rect = vpEl?.getBoundingClientRect();
        const vpWidth = (rect as any)?.width || vpEl?.clientWidth || 0;
        const vpHeight = (rect as any)?.height || vpEl?.clientHeight || 0;
        const focalX = rect ? midX - (rect.left + vpWidth / 2) : 0;
        const focalY = rect ? midY - (rect.top + vpHeight / 2) : 0;

        pinchRef.current = {
          isPinching: true,
          startDistance: dist,
          startScale: zoomRef.current.scale,
          startPan: { x: zoomRef.current.panX, y: zoomRef.current.panY },
          startMidViewport: { x: focalX, y: focalY },
        };
        dragRef.current.isDragging = false;
        suppressSwipeRef.current = true;
        suppressClickRef.current = true;
      } else if (touches.length === 1) {
        const currentScale = zoomRef.current.scale;
        if (currentScale > 1) {
          dragRef.current = {
            isDragging: true,
            startX: touches[0].clientX,
            startY: touches[0].clientY,
            startPan: { x: zoomRef.current.panX, y: zoomRef.current.panY },
            moved: false,
          };
          pinchRef.current.isPinching = false;
        } else {
          setState((prev) => ({
            ...prev,
            touchStartInfo: { screenX: (touches[0] as any).screenX ?? touches[0].clientX },
            touchMoved: false,
            touchEndInfo: null,
          }));
        }
      }
    },
    [enableZoom],
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLButtonElement | HTMLDivElement>) => {
      const touches = (event as any).targetTouches as TouchList;
      if (!touches) return;
      if (!enableZoom) {
        if (touches.length === 1) {
          setState((prev) => ({
            ...prev,
            touchMoved: true,
            touchEndInfo: { screenX: (touches[0] as any).screenX ?? touches[0].clientX },
          }));
        }
        return;
      }

      if (pinchRef.current.isPinching && touches.length === 2) {
        const vpEl = viewportRef.current;
        if (!vpEl) return;
        const rect = vpEl.getBoundingClientRect();
        const vpSize = {
          width: (rect as any).width || vpEl.clientWidth || 0,
          height: (rect as any).height || vpEl.clientHeight || 0,
        };
        if (vpSize.width === 0 && vpSize.height === 0) return;

        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;
        const midX = (touches[0].clientX + touches[1].clientX) / 2;
        const midY = (touches[0].clientY + touches[1].clientY) / 2;
        const currentFocalX = midX - (rect.left + vpSize.width / 2);
        const currentFocalY = midY - (rect.top + vpSize.height / 2);

        const ratio = dist / pinchRef.current.startDistance;
        let newScale = pinchRef.current.startScale * ratio;
        newScale = clamp(newScale, MIN_SCALE, MAX_SCALE);

        const startFocalX = pinchRef.current.startMidViewport.x;
        const startFocalY = pinchRef.current.startMidViewport.y;
        const startPan = pinchRef.current.startPan;
        const startScale = pinchRef.current.startScale;

        let newPanX: number;
        let newPanY: number;
        if (newScale === 1) {
          newPanX = 0;
          newPanY = 0;
        } else {
          newPanX =
            currentFocalX - (startFocalX - startPan.x) * (newScale / startScale);
          newPanY =
            currentFocalY - (startFocalY - startPan.y) * (newScale / startScale);
        }

        const nat = getNaturalSize();
        const rendered =
          nat.w > 0 && nat.h > 0
            ? getLetterboxedSize(nat.w, nat.h, vpSize.width, vpSize.height)
            : getRenderedSize();

        const clamped = clampPan(newPanX, newPanY, newScale, rendered, vpSize);
        setZoom({ scale: newScale, panX: clamped.x, panY: clamped.y });
        suppressClickRef.current = true;
        suppressSwipeRef.current = true;

        if ((event as any).cancelable) {
          (event as any).preventDefault();
        }
      } else if (dragRef.current.isDragging && touches.length === 1) {
        const vpEl = viewportRef.current;
        if (!vpEl) return;
        const rect = vpEl.getBoundingClientRect();
        const vpSize = {
          width: (rect as any).width || vpEl.clientWidth || 0,
          height: (rect as any).height || vpEl.clientHeight || 0,
        };

        const deltaX = touches[0].clientX - dragRef.current.startX;
        const deltaY = touches[0].clientY - dragRef.current.startY;
        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
          dragRef.current.moved = true;
        }

        let newPanX = dragRef.current.startPan.x + deltaX;
        let newPanY = dragRef.current.startPan.y + deltaY;

        const nat = getNaturalSize();
        const rendered =
          nat.w > 0 && nat.h > 0 && vpSize.width > 0 && vpSize.height > 0
            ? getLetterboxedSize(nat.w, nat.h, vpSize.width, vpSize.height)
            : getRenderedSize();

        const clamped = clampPan(
          newPanX,
          newPanY,
          zoomRef.current.scale,
          rendered,
          vpSize,
        );
        setZoom((prev) => ({ ...prev, panX: clamped.x, panY: clamped.y }));
        suppressSwipeRef.current = true;

        if ((event as any).cancelable) {
          (event as any).preventDefault();
        }
      } else {
        if (touches.length === 1 && zoomRef.current.scale === 1) {
          setState((prev) => ({
            ...prev,
            touchMoved: true,
            touchEndInfo: { screenX: (touches[0] as any).screenX ?? touches[0].clientX },
          }));
        }
      }
    },
    [enableZoom, getNaturalSize, getRenderedSize],
  );

  const handleTouchEnd = useCallback(
    (_event: ReactTouchEvent) => {
      if (!enableZoom) {
        setState((prevState) => {
          const { touchStartInfo, touchEndInfo, touchMoved } = prevState;
          if (touchMoved && touchStartInfo && touchEndInfo) {
            if (touchStartInfo.screenX < touchEndInfo.screenX) {
              onPrevButtonPress();
            } else if (touchStartInfo.screenX > touchEndInfo.screenX) {
              onNextButtonPress();
            }
          }
          return {
            ...prevState,
            touchMoved: false,
          };
        });
        return;
      }

      if (pinchRef.current.isPinching) {
        pinchRef.current.isPinching = false;
        if (zoomRef.current.scale === 1) {
          setZoom({ scale: 1, panX: 0, panY: 0 });
        }
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 300);
      }

      if (dragRef.current.isDragging) {
        const wasMoved = dragRef.current.moved;
        dragRef.current.isDragging = false;
        if (wasMoved) {
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 100);
        }
        if (zoomRef.current.scale > 1) {
          setState((prev) => ({ ...prev, touchMoved: false }));
          return;
        }
      }

      if (zoomRef.current.scale > 1 || suppressSwipeRef.current) {
        setState((prev) => ({
          ...prev,
          touchMoved: false,
          touchStartInfo: null,
          touchEndInfo: null,
        }));
        suppressSwipeRef.current = false;
        return;
      }

      setState((prevState) => {
        const { touchStartInfo, touchEndInfo, touchMoved } = prevState;
        if (touchMoved && touchStartInfo && touchEndInfo) {
          if (touchStartInfo.screenX < touchEndInfo.screenX) {
            onPrevButtonPress();
          } else if (touchStartInfo.screenX > touchEndInfo.screenX) {
            onNextButtonPress();
          }
        }
        return {
          ...prevState,
          touchMoved: false,
        };
      });
    },
    [enableZoom, onNextButtonPress, onPrevButtonPress],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!enableZoom) return;
      if (zoomRef.current.scale <= 1) return;
      dragRef.current = {
        isDragging: true,
        startX: event.clientX,
        startY: event.clientY,
        startPan: { x: zoomRef.current.panX, y: zoomRef.current.panY },
        moved: false,
      };
    },
    [enableZoom],
  );

  useEffect(() => {
    if (!enableZoom) return;
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      const deltaX = event.clientX - dragRef.current.startX;
      const deltaY = event.clientY - dragRef.current.startY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        dragRef.current.moved = true;
      }
      let newPanX = dragRef.current.startPan.x + deltaX;
      let newPanY = dragRef.current.startPan.y + deltaY;

      const vpEl = viewportRef.current;
      if (!vpEl) return;
      const rect = vpEl.getBoundingClientRect();
      const vpSize = {
        width: (rect as any).width || vpEl.clientWidth || 0,
        height: (rect as any).height || vpEl.clientHeight || 0,
      };
      if (vpSize.width === 0 && vpSize.height === 0) return;

      const nat = getNaturalSize();
      const rendered =
        nat.w > 0 && nat.h > 0
          ? getLetterboxedSize(nat.w, nat.h, vpSize.width, vpSize.height)
          : getRenderedSize();

      const clamped = clampPan(
        newPanX,
        newPanY,
        zoomRef.current.scale,
        rendered,
        vpSize,
      );
      setZoom((prev) => ({ ...prev, panX: clamped.x, panY: clamped.y }));
    };

    const handleMouseUp = () => {
      if (!dragRef.current.isDragging) return;
      const wasMoved = dragRef.current.moved;
      dragRef.current.isDragging = false;
      if (wasMoved) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 100);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [enableZoom, getNaturalSize, getRenderedSize]);

  const to = useCallback(
    (index: number) => {
      if (
        index > photos.length - 1 ||
        index < 0 ||
        state.activePhotoIndex === index
      ) {
        return;
      }
      const direction =
        index > state.activePhotoIndex ? DIRECTION_NEXT : DIRECTION_PREV;
      move(direction, index);
    },
    [move, photos.length, state.activePhotoIndex],
  );

  const onThumbnailPress = useCallback(
    (index: number) => {
      to(index);
    },
    [to],
  );

  const controls = useMemo(() => {
    const hasMultiplePhotos = photos.length > 1;
    if (!hasMultiplePhotos) {
      return null;
    }
    const ui = [];
    if (!state.hidePrevButton) {
      ui.push(
        <PrevButton
          key=".prevControl"
          disabled={state.controlsDisabled}
          onPress={onPrevButtonPress}
          light={light}
        />,
      );
    }
    if (!state.hideNextButton) {
      ui.push(
        <NextButton
          key=".nextControl"
          disabled={state.controlsDisabled}
          onPress={onNextButtonPress}
          light={light}
        />,
      );
    }
    return ui;
  }, [
    light,
    onNextButtonPress,
    onPrevButtonPress,
    photos.length,
    state.controlsDisabled,
    state.hideNextButton,
    state.hidePrevButton,
  ]);

  const galleryModalPreloadPhotos = useMemo(() => {
    let counter = 1;
    let index = state.activePhotoIndex;
    const preloadPhotos = [];

    while (index < photos.length && counter <= preloadSize) {
      const photo = photos[index];
      preloadPhotos.push(
        <img key={photo.photo} alt={photo.photo} src={photo.photo} />,
      );
      index += 1;
      counter += 1;
    }

    return preloadPhotos;
  }, [photos, preloadSize, state.activePhotoIndex]);

  const hasPhotos = photos.length > 0;
  const current = photos[state.activePhotoIndex];
  const { noPhotosProvided: emptyMessage } = phrases;

  const isZoomEnabled = enableZoom !== false;
  const effectiveScale = !isZoomEnabled || isPendingPhotoChange ? 1 : zoom.scale;
  const effectivePanX = !isZoomEnabled || isPendingPhotoChange ? 0 : zoom.panX;
  const effectivePanY = !isZoomEnabled || isPendingPhotoChange ? 0 : zoom.panY;

  const photoStyle: any = {
    '--rbg-zoom-scale': `${effectiveScale}`,
    '--rbg-photo-scale': `${effectiveScale}`,
    '--rbg-scale': `${effectiveScale}`,
    '--rbg-pan-x': `${effectivePanX}px`,
    '--rbg-pan-y': `${effectivePanY}px`,
    '--rbg-photo-pan-x': `${effectivePanX}px`,
    '--rbg-photo-pan-y': `${effectivePanY}px`,
    position: 'relative',
    top: 'auto',
    left: 'auto',
    right: 'auto',
    bottom: 'auto',
    margin: '0',
    maxWidth: '100%',
    maxHeight: '100%',
    width: 'auto',
    height: 'auto',
    transform: `translate3d(${effectivePanX}px, ${effectivePanY}px, 0) scale(${effectiveScale})`,
    transformOrigin: 'center center',
    willChange: 'transform',
  };

  return (
    <div className="gallery">
      <div className="gallery-modal--preload">{galleryModalPreloadPhotos}</div>
      <div className="gallery-main">
        {controls}
        <div className="gallery-photos">
          {hasPhotos ? (
            <div className="gallery-photo">
              <div
                className="gallery-photo--current"
                ref={viewportRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                style={{
                  overflow: 'hidden',
                  touchAction: enableZoom ? 'none' : undefined,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Photo
                  photo={current}
                  onLoad={onPhotoLoad}
                  onError={onPhotoError}
                  onPress={onPhotoPress}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  style={photoStyle}
                  imageRef={imageRef}
                  enableZoom={enableZoom}
                />
              </div>
            </div>
          ) : (
            <div className="gallery-empty">{emptyMessage}</div>
          )}
        </div>
      </div>
      {showThumbnails && current && (
        <Caption
          phrases={phrases}
          current={state.activePhotoIndex}
          photos={photos}
          onPress={onThumbnailPress}
        />
      )}
    </div>
  );
});

const MemoizedGallery = memo(Gallery);

export { MemoizedGallery as Gallery };
