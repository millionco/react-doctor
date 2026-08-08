// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 02022e387075ed617314970905872a90edfda5093878c6d2605dab96c6492818
import clsx from 'clsx';
import type { CSSProperties, TouchEvent as ReactTouchEvent } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GalleryPhoto } from '../types/gallery';
import { getCaptionText } from '../utils/get-caption-text';
import { Image } from './image';

interface PhotoProps {
  photo?: GalleryPhoto | null;
  onPress?: () => void;
  onTouchStart?: (event: ReactTouchEvent<HTMLButtonElement>) => void;
  onTouchMove?: (event: ReactTouchEvent<HTMLButtonElement>) => void;
  onTouchEnd?: (event: ReactTouchEvent<HTMLButtonElement>) => void;
  onLoad?: () => void;
  onError?: () => void;
  style?: CSSProperties;
  enableZoom?: boolean;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function getRenderedSize(
  viewportW: number,
  viewportH: number,
  naturalW: number,
  naturalH: number
): { w: number; h: number } {
  if (!viewportW || !viewportH) return { w: 0, h: 0 };
  if (!naturalW || !naturalH) {
    return { w: viewportW, h: viewportH };
  }
  const viewportRatio = viewportW / viewportH;
  const imageRatio = naturalW / naturalH;
  if (imageRatio > viewportRatio) {
    const w = viewportW;
    const h = viewportW / imageRatio;
    return { w, h };
  } else {
    const h = viewportH;
    const w = viewportH * imageRatio;
    return { w, h };
  }
}

function getMaxPan(
  viewportW: number,
  viewportH: number,
  renderedW: number,
  renderedH: number,
  scale: number
): { x: number; y: number } {
  const maxX = Math.max(0, (renderedW * scale - viewportW) / 2);
  const maxY = Math.max(0, (renderedH * scale - viewportH) / 2);
  return { x: maxX, y: maxY };
}

function Photo({
  photo = null,
  onPress,
  onTouchStart: parentTouchStart,
  onTouchMove: parentTouchMove,
  onTouchEnd: parentTouchEnd,
  onLoad,
  onError,
  enableZoom = true,
}: PhotoProps) {
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [scale, setScale] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const scaleRef = useRef(scale);
  const panRef = useRef(pan);
  const viewportRef = useRef(viewport);
  const naturalRef = useRef(natural);
  const enableZoomRef = useRef(enableZoom);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    naturalRef.current = natural;
  }, [natural]);
  useEffect(() => {
    enableZoomRef.current = enableZoom;
  }, [enableZoom]);

  const dragState = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const pinchState = useRef<{
    startDist: number;
    startScale: number;
    startPan: { x: number; y: number };
    startMid: { x: number; y: number };
    viewportW: number;
    viewportH: number;
  } | null>(null);

  const suppressClickRef = useRef(false);

  const photoKey = photo?.photo || '';

  useLayoutEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    scaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    suppressClickRef.current = false;
    dragState.current = null;
    pinchState.current = null;
  }, [photoKey]);

  useLayoutEffect(() => {
    if (!enableZoom) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      scaleRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      suppressClickRef.current = false;
    }
  }, [enableZoom]);

  const measureViewport = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    let target: Element | null = el;
    const current = el.closest('.gallery-photo--current');
    if (current) target = current;
    const rect = (target as HTMLElement).getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w && h) {
      setViewport((prev) => {
        if (Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5) return prev;
        return { w, h };
      });
    }
  }, []);

  useLayoutEffect(() => {
    measureViewport();
  }, [measureViewport]);

  useEffect(() => {
    const onResize = () => measureViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureViewport]);

  const clampPan = useCallback(
    (desiredX: number, desiredY: number, effScale?: number, vp?: { w: number; h: number }, nat?: { w: number; h: number }) => {
      const sc = effScale ?? scaleRef.current;
      const v = vp ?? viewportRef.current;
      const n = nat ?? naturalRef.current;
      const rendered = getRenderedSize(v.w, v.h, n.w, n.h);
      const max = getMaxPan(v.w, v.h, rendered.w, rendered.h, sc);
      let nx = clamp(desiredX, -max.x, max.x);
      let ny = clamp(desiredY, -max.y, max.y);
      if (max.x === 0) nx = 0;
      if (max.y === 0) ny = 0;
      return { x: nx, y: ny };
    },
    []
  );

  useLayoutEffect(() => {
    if (viewport.w && viewport.h) {
      const clamped = clampPan(panRef.current.x, panRef.current.y, scaleRef.current, viewport, natural);
      if (clamped.x !== panRef.current.x || clamped.y !== panRef.current.y) {
        setPan({ x: clamped.x, y: clamped.y });
      }
    }
  }, [viewport, natural, scale, clampPan]);

  const handleImageLoad = useCallback(
    (e?: any) => {
      const img = e?.currentTarget as HTMLImageElement | undefined;
      if (img && img.naturalWidth && img.naturalHeight) {
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      }
      onLoad?.();
      requestAnimationFrame(() => measureViewport());
    },
    [onLoad, measureViewport]
  );

  // Wheel zoom via native listener (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (evt: WheelEvent) => {
      if (!enableZoomRef.current) return;
      evt.preventDefault();
      evt.stopPropagation();
      const rect = (containerRef.current as HTMLElement).getBoundingClientRect();
      const vp = viewportRef.current.w ? viewportRef.current : { w: rect.width, h: rect.height };
      const curScale = scaleRef.current;
      const curPan = panRef.current;
      const delta = -(evt as any).deltaY;
      let factor = 0;
      if ((evt as any).ctrlKey) factor = delta * 0.01;
      else factor = delta * 0.0015;
      let newScale = curScale * (1 + factor);
      newScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
      if (Math.abs(newScale - curScale) < 0.001) {
        if (newScale <= MIN_SCALE + 0.001) {
          setScale(1);
          setPan({ x: 0, y: 0 });
          suppressClickRef.current = true;
          setTimeout(() => {
            if (scaleRef.current <= 1.01) suppressClickRef.current = false;
          }, 80);
        }
        return;
      }
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const focalX = (evt as any).clientX - centerX;
      const focalY = (evt as any).clientY - centerY;
      let newPanX = focalX - ((focalX - curPan.x) * newScale) / curScale;
      let newPanY = focalY - ((focalY - curPan.y) * newScale) / curScale;
      const rendered = getRenderedSize(vp.w, vp.h, naturalRef.current.w, naturalRef.current.h);
      const max = getMaxPan(vp.w, vp.h, rendered.w, rendered.h, newScale);
      newPanX = clamp(newPanX, -max.x, max.x);
      newPanY = clamp(newPanY, -max.y, max.y);
      if (max.x === 0) newPanX = 0;
      if (max.y === 0) newPanY = 0;
      if (newScale <= MIN_SCALE + 0.01) {
        newScale = 1;
        newPanX = 0;
        newPanY = 0;
      }
      setScale(newScale);
      setPan({ x: newPanX, y: newPanY });
      suppressClickRef.current = true;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as any);
  }, []);

  const handleClick = useCallback(
    (ev: React.MouseEvent) => {
      if (suppressClickRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
        if (scaleRef.current <= 1.01) {
          suppressClickRef.current = false;
        }
        return;
      }
      if (scaleRef.current > 1.01) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      onPress?.();
    },
    [onPress]
  );

  const getTouchInfo = (touches: ReactTouchEvent['touches']) => {
    if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const midX = (touches[0].clientX + touches[1].clientX) / 2;
      const midY = (touches[0].clientY + touches[1].clientY) / 2;
      return { dist, midX, midY };
    }
    return null;
  };

  const onTouchStartInternal = useCallback(
    (e: ReactTouchEvent<HTMLButtonElement>) => {
      if (!enableZoomRef.current) {
        parentTouchStart?.(e);
        return;
      }
      const touches = e.touches;
      measureViewport();
      if (touches.length === 2) {
        e.preventDefault();
        e.stopPropagation();
        const info = getTouchInfo(touches as any);
        if (!info) return;
        const rect = containerRef.current?.getBoundingClientRect();
        const centerX = rect ? rect.left + rect.width / 2 : info.midX;
        const centerY = rect ? rect.top + rect.height / 2 : info.midY;
        const relMidX = info.midX - centerX;
        const relMidY = info.midY - centerY;
        const vp = viewportRef.current;
        pinchState.current = {
          startDist: info.dist,
          startScale: scaleRef.current,
          startPan: { ...panRef.current },
          startMid: { x: relMidX, y: relMidY },
          viewportW: vp.w,
          viewportH: vp.h,
        };
        dragState.current = null;
        suppressClickRef.current = true;
        return;
      }
      if (touches.length === 1 && scaleRef.current > 1.01) {
        e.stopPropagation();
        const t = touches[0];
        dragState.current = {
          dragging: true,
          startX: t.clientX,
          startY: t.clientY,
          startPanX: panRef.current.x,
          startPanY: panRef.current.y,
        };
        suppressClickRef.current = true;
        return;
      }
      if (scaleRef.current > 1.01) {
        e.stopPropagation();
        return;
      }
      parentTouchStart?.(e);
    },
    [parentTouchStart, measureViewport]
  );

  const onTouchMoveInternal = useCallback(
    (e: ReactTouchEvent<HTMLButtonElement>) => {
      if (!enableZoomRef.current) {
        parentTouchMove?.(e);
        return;
      }
      const touches = e.touches;
      if (touches.length === 2 && pinchState.current) {
        e.preventDefault();
        e.stopPropagation();
        const info = getTouchInfo(touches as any);
        if (!info) return;
        const ps = pinchState.current;
        const newScale = clamp((info.dist / ps.startDist) * ps.startScale, MIN_SCALE, MAX_SCALE);
        const rect = containerRef.current?.getBoundingClientRect();
        const centerX = rect ? rect.left + rect.width / 2 : info.midX;
        const centerY = rect ? rect.top + rect.height / 2 : info.midY;
        const curMidRelX = info.midX - centerX;
        const curMidRelY = info.midY - centerY;

        const startMidX = ps.startMid.x;
        const startMidY = ps.startMid.y;
        const startPan = ps.startPan;
        const startScale = ps.startScale;

        let newPanX = curMidRelX - (newScale * (startMidX - startPan.x)) / startScale;
        let newPanY = curMidRelY - (newScale * (startMidY - startPan.y)) / startScale;

        const vpW = ps.viewportW || viewportRef.current.w;
        const vpH = ps.viewportH || viewportRef.current.h;
        const rendered = getRenderedSize(vpW, vpH, naturalRef.current.w, naturalRef.current.h);
        const max = getMaxPan(vpW, vpH, rendered.w, rendered.h, newScale);
        newPanX = clamp(newPanX, -max.x, max.x);
        newPanY = clamp(newPanY, -max.y, max.y);
        if (max.x === 0) newPanX = 0;
        if (max.y === 0) newPanY = 0;

        let finalScale = newScale;
        if (finalScale <= MIN_SCALE + 0.01) {
          finalScale = 1;
          newPanX = 0;
          newPanY = 0;
        }

        setScale(finalScale);
        setPan({ x: newPanX, y: newPanY });
        suppressClickRef.current = true;
        return;
      }
      if (touches.length === 1 && dragState.current?.dragging && scaleRef.current > 1.01) {
        e.preventDefault();
        e.stopPropagation();
        const t = touches[0];
        const dx = t.clientX - dragState.current.startX;
        const dy = t.clientY - dragState.current.startY;
        let desiredX = dragState.current.startPanX + dx;
        let desiredY = dragState.current.startPanY + dy;
        const vp = viewportRef.current;
        const rendered = getRenderedSize(vp.w, vp.h, naturalRef.current.w, naturalRef.current.h);
        const max = getMaxPan(vp.w, vp.h, rendered.w, rendered.h, scaleRef.current);
        desiredX = clamp(desiredX, -max.x, max.x);
        desiredY = clamp(desiredY, -max.y, max.y);
        if (max.x === 0) desiredX = 0;
        if (max.y === 0) desiredY = 0;
        setPan({ x: desiredX, y: desiredY });
        suppressClickRef.current = true;
        return;
      }
      if (scaleRef.current > 1.01) {
        e.stopPropagation();
        return;
      }
      parentTouchMove?.(e);
    },
    [parentTouchMove]
  );

  const onTouchEndInternal = useCallback(
    (e: ReactTouchEvent<HTMLButtonElement>) => {
      if (!enableZoomRef.current) {
        parentTouchEnd?.(e);
        return;
      }
      if (pinchState.current) {
        e.preventDefault();
        e.stopPropagation();
        if (scaleRef.current <= MIN_SCALE + 0.01) {
          setScale(1);
          setPan({ x: 0, y: 0 });
        }
        pinchState.current = null;
        if (scaleRef.current <= 1.01) {
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 300);
        }
        return;
      }
      if (dragState.current?.dragging) {
        e.preventDefault();
        e.stopPropagation();
        dragState.current = null;
        if (scaleRef.current <= 1.01) {
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 50);
        }
        return;
      }
      if (scaleRef.current > 1.01) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      parentTouchEnd?.(e);
    },
    [parentTouchEnd]
  );

  if (!photo) return null;

  const captionText = getCaptionText(photo.caption);
  const wrapperClass = clsx('gallery-media-photo', 'gallery-media-photo--block', 'gallery-media-cover');

  const customProps: Record<string, string> = {
    '--rbg-zoom-scale': `${scale}`,
    '--rbg-photo-scale': `${scale}`,
    '--rbg-scale': `${scale}`,
    '--rbg-pan-x': `${pan.x}px`,
    '--rbg-pan-y': `${pan.y}px`,
    '--rbg-photo-pan-x': `${pan.x}px`,
    '--rbg-photo-pan-y': `${pan.y}px`,
  };

  const imageStyle: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    maxWidth: '100%',
    maxHeight: '100%',
    transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
    transformOrigin: 'center center',
    ...(customProps as any),
  };

  return (
    <ul className="gallery-images--ul gallery-photo-list">
      <li className={clsx(wrapperClass, 'gallery-photo-item')}>
        <button
          ref={containerRef}
          type="button"
          onClick={handleClick}
          className="photo-button gallery-photo-button"
          onTouchStart={onTouchStartInternal}
          onTouchMove={onTouchMoveInternal}
          onTouchEnd={onTouchEndInternal}
          onPointerDown={(ev) => {
            if (!enableZoomRef.current) return;
            if (scaleRef.current <= 1.01) return;
            if (ev.button !== 0) return;
            (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
            dragState.current = {
              dragging: true,
              startX: ev.clientX,
              startY: ev.clientY,
              startPanX: panRef.current.x,
              startPanY: panRef.current.y,
            };
            suppressClickRef.current = true;
          }}
          onPointerMove={(ev) => {
            if (!dragState.current?.dragging) return;
            if (scaleRef.current <= 1.01) return;
            const dx = ev.clientX - dragState.current.startX;
            const dy = ev.clientY - dragState.current.startY;
            let desiredX = dragState.current.startPanX + dx;
            let desiredY = dragState.current.startPanY + dy;
            const vp = viewportRef.current;
            const rendered = getRenderedSize(vp.w, vp.h, naturalRef.current.w, naturalRef.current.h);
            const max = getMaxPan(vp.w, vp.h, rendered.w, rendered.h, scaleRef.current);
            desiredX = clamp(desiredX, -max.x, max.x);
            desiredY = clamp(desiredY, -max.y, max.y);
            if (max.x === 0) desiredX = 0;
            if (max.y === 0) desiredY = 0;
            setPan({ x: desiredX, y: desiredY });
          }}
          onPointerUp={(ev) => {
            if (dragState.current) {
              dragState.current = null;
              (ev.target as HTMLElement).releasePointerCapture?.(ev.pointerId);
              if (scaleRef.current <= 1.01) {
                setTimeout(() => {
                  suppressClickRef.current = false;
                }, 50);
              }
            }
          }}
          style={{
            touchAction: enableZoom && scale > 1 ? 'none' : undefined,
            width: '100%',
            height: '100%',
          } as any}
        >
          <Image
            alt={photo.alt || captionText}
            className="photo gallery-photo-image"
            src={photo.photo || ''}
            onLoad={handleImageLoad as any}
            onError={onError as any}
            style={imageStyle as any}
          />
        </button>
      </li>
    </ul>
  );
}

const MemoizedPhoto = memo(Photo);
export { MemoizedPhoto as Photo };
