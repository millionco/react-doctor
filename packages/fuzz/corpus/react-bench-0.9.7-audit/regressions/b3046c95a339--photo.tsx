// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit b3046c95a3398240527c1a118869f89c441006c4f1a0c4b3c466609dcfd4e7ca
import clsx from 'clsx';
import type { CSSProperties, TouchEvent as ReactTouchEvent } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryPhoto } from '../types/gallery';
import { getCaptionText } from '../utils/get-caption-text';
import { LoadingSpinner } from './loading-spinner';

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
  onZoomedChange?: (zoomed: boolean) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function getRenderedSize(cw: number, ch: number, nw: number, nh: number) {
  if (cw <= 0 || ch <= 0 || nw <= 0 || nh <= 0) return { width: cw, height: ch };
  const s = Math.min(cw / nw, ch / nh);
  return { width: nw * s, height: nh * s };
}

function clampPan(panX: number, panY: number, scale: number, cw: number, ch: number, rw: number, rh: number) {
  const maxX = Math.max(0, (rw * scale - cw) / 2);
  const maxY = Math.max(0, (rh * scale - ch) / 2);
  const x = maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, panX));
  const y = maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, panY));
  return { x, y };
}

function dist(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}
function mid(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function Photo({
  photo = null,
  onPress,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onLoad,
  onError,
  style,
  enableZoom = true,
  onZoomedChange,
}: PhotoProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const naturalRef = useRef({ w: 0, h: 0 });
  const containerSizeRef = useRef({ w: 0, h: 0 });
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { naturalRef.current = natural; containerSizeRef.current = containerSize; }, [natural, containerSize]);

  // handle photo identity
  const currentPhotoId = photo?.photo || '';
  const lastPhotoIdRef = useRef(currentPhotoId);
  const pendingResetRef = useRef(false);

  if (lastPhotoIdRef.current !== currentPhotoId) {
    lastPhotoIdRef.current = currentPhotoId;
    scaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    pendingResetRef.current = true;
  }

  const lastZoomed = useRef(false);
  // effective values for render - immediate reset when disabled or photo changed
  const isDisabled = !enableZoom;
  const isPendingReset = pendingResetRef.current;
  const renderScale = isDisabled ? 1 : (isPendingReset ? 1 : scale);
  const renderPan = isDisabled ? { x: 0, y: 0 } : (isPendingReset ? { x: 0, y: 0 } : pan);

  useEffect(() => {
    if (pendingResetRef.current) {
      pendingResetRef.current = false;
      setScale(1);
      setPan({ x: 0, y: 0 });
      setLoading(true);
      setHasError(false);
      setNatural({ w: 0, h: 0 });
      naturalRef.current = { w: 0, h: 0 };
      lastZoomed.current = false;
      onZoomedChange?.(false);
    }
  }, [currentPhotoId, onZoomedChange]);

  // notify zoomed
  useEffect(() => {
    const zoomed = renderScale > 1.001;
    if (lastZoomed.current !== zoomed) {
      lastZoomed.current = zoomed;
      onZoomedChange?.(zoomed);
    }
  }, [renderScale, onZoomedChange]);

  useEffect(() => {
    if (!enableZoom) {
      if (scale !== 1 || pan.x !== 0 || pan.y !== 0) {
        setScale(1);
        setPan({ x: 0, y: 0 });
        scaleRef.current = 1;
        panRef.current = { x: 0, y: 0 };
      }
    }
  }, [enableZoom, scale, pan]);

  // measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    const onR = () => measure();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [currentPhotoId]);

  useEffect(() => {
    if (natural.w === 0 || containerSize.w === 0) return;
    const rs = getRenderedSize(containerSize.w, containerSize.h, natural.w, natural.h);
    const clamped = clampPan(panRef.current.x, panRef.current.y, scaleRef.current, containerSize.w, containerSize.h, rs.width, rs.height);
    if (clamped.x !== panRef.current.x || clamped.y !== panRef.current.y) {
      setPan(clamped);
    }
  }, [natural, containerSize]);

  const doApplyScale = useCallback((newScaleUnclamped: number, focalX: number, focalY: number, cw: number, ch: number) => {
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScaleUnclamped));
    const s0 = scaleRef.current;
    const p0 = panRef.current;
    let nx: number, ny: number;
    if (clampedScale <= 1.0001) {
      nx = 0; ny = 0;
    } else {
      const px = focalX - cw / 2;
      const py = focalY - ch / 2;
      nx = px - ((px - p0.x) / (s0 || 1)) * clampedScale;
      ny = py - ((py - p0.y) / (s0 || 1)) * clampedScale;
    }
    const nat = naturalRef.current;
    let rw = cw, rh = ch;
    if (nat.w > 0 && nat.h > 0 && cw > 0 && ch > 0) {
      const rs = getRenderedSize(cw, ch, nat.w, nat.h);
      rw = rs.width; rh = rs.height;
    }
    const clamped = clampPan(nx, ny, clampedScale, cw, ch, rw, rh);
    setScale(clampedScale);
    setPan(clamped);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!enableZoom) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const fx = e.clientX - rect.left;
    const fy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    doApplyScale(scaleRef.current * factor, fx, fy, rect.width, rect.height);
  }, [enableZoom, doApplyScale]);

  const dragRef = useRef<{ active: boolean; sx: number; sy: number; psx: number; psy: number } | null>(null);
  const pinchRef = useRef<{ sd: number; ss: number; smx: number; smy: number; psx: number; psy: number; scw: number; sch: number } | null>(null);
  const singleTouchRef = useRef<{ sx: number; sy: number; psx: number; psy: number; isPinch: boolean } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const mDown = (e: MouseEvent) => {
      if (!enableZoom) return;
      if (scaleRef.current <= 1.001) return;
      dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, psx: panRef.current.x, psy: panRef.current.y };
      e.preventDefault();
    };
    const mMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !d.active) return;
      const rawX = d.psx + (e.clientX - d.sx);
      const rawY = d.psy + (e.clientY - d.sy);
      const cw = containerSizeRef.current.w;
      const ch = containerSizeRef.current.h;
      const nat = naturalRef.current;
      let rw = cw, rh = ch;
      if (nat.w > 0 && nat.h > 0 && cw > 0 && ch > 0) {
        const rs = getRenderedSize(cw, ch, nat.w, nat.h);
        rw = rs.width; rh = rs.height;
      }
      const clamped = clampPan(rawX, rawY, scaleRef.current, cw, ch, rw, rh);
      setPan(clamped);
    };
    const mUp = () => { if (dragRef.current) dragRef.current.active = false; };

    el.addEventListener('mousedown', mDown);
    window.addEventListener('mousemove', mMove);
    window.addEventListener('mouseup', mUp);

    const onTouchStartNative = (ev: TouchEvent) => {
      if (!enableZoom) return;
      if (ev.touches.length === 2) {
        ev.preventDefault();
        const t1 = ev.touches[0], t2 = ev.touches[1];
        const d = dist(t1, t2);
        const m = mid(t1, t2);
        const rect = el.getBoundingClientRect();
        pinchRef.current = {
          sd: d, ss: scaleRef.current, smx: m.x - rect.left, smy: m.y - rect.top,
          psx: panRef.current.x, psy: panRef.current.y, scw: rect.width, sch: rect.height
        };
        singleTouchRef.current = { sx: 0, sy: 0, psx: 0, psy: 0, isPinch: true };
      } else if (ev.touches.length === 1) {
        if (scaleRef.current > 1.001) {
          const t = ev.touches[0];
          singleTouchRef.current = { sx: t.clientX, sy: t.clientY, psx: panRef.current.x, psy: panRef.current.y, isPinch: false };
        } else {
          singleTouchRef.current = null;
        }
      }
    };
    const onTouchMoveNative = (ev: TouchEvent) => {
      if (!enableZoom) return;
      if (ev.touches.length === 2) {
        ev.preventDefault();
        const p = pinchRef.current;
        if (!p || p.sd <= 0) return;
        const t1 = ev.touches[0], t2 = ev.touches[1];
        const nd = dist(t1, t2);
        const nm = mid(t1, t2);
        const rect = el.getBoundingClientRect();
        const newMidX = nm.x - rect.left;
        const newMidY = nm.y - rect.top;
        const newScale = p.ss * (nd / p.sd);
        const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
        let npx: number, npy: number;
        if (clampedScale <= 1.0001) { npx = 0; npy = 0; }
        else {
          const px0 = p.smx - p.scw / 2;
          const py0 = p.smy - p.sch / 2;
          const px1 = newMidX - rect.width / 2;
          const py1 = newMidY - rect.height / 2;
          const lx = (px0 - p.psx) / (p.ss || 1);
          const ly = (py0 - p.psy) / (p.ss || 1);
          npx = px1 - lx * clampedScale;
          npy = py1 - ly * clampedScale;
        }
        const nat = naturalRef.current;
        let rw = rect.width, rh = rect.height;
        if (nat.w > 0 && nat.h > 0) {
          const rs = getRenderedSize(rect.width, rect.height, nat.w, nat.h);
          rw = rs.width; rh = rs.height;
        }
        const clamped = clampPan(npx, npy, clampedScale, rect.width, rect.height, rw, rh);
        setScale(clampedScale);
        setPan(clamped);
      } else if (ev.touches.length === 1) {
        const s = singleTouchRef.current;
        if (!s || s.isPinch) return;
        if (scaleRef.current <= 1.001) return;
        ev.preventDefault();
        const t = ev.touches[0];
        const rawX = s.psx + (t.clientX - s.sx);
        const rawY = s.psy + (t.clientY - s.sy);
        const cw = containerSizeRef.current.w;
        const ch = containerSizeRef.current.h;
        const nat = naturalRef.current;
        let rw = cw, rh = ch;
        if (nat.w > 0 && nat.h > 0) {
          const rs = getRenderedSize(cw, ch, nat.w, nat.h);
          rw = rs.width; rh = rs.height;
        }
        const clamped = clampPan(rawX, rawY, scaleRef.current, cw, ch, rw, rh);
        setPan(clamped);
      }
    };
    const onTouchEndNative = (ev: TouchEvent) => {
      if (ev.touches.length === 0) {
        pinchRef.current = null;
        if (scaleRef.current <= 1.001) {
          setPan({ x: 0, y: 0 });
        }
        setTimeout(() => { singleTouchRef.current = null; }, 0);
      } else if (ev.touches.length === 1) {
        pinchRef.current = null;
        const t = ev.touches[0];
        singleTouchRef.current = { sx: t.clientX, sy: t.clientY, psx: panRef.current.x, psy: panRef.current.y, isPinch: false };
      }
    };

    el.addEventListener('touchstart', onTouchStartNative, { passive: false } as any);
    el.addEventListener('touchmove', onTouchMoveNative, { passive: false } as any);
    el.addEventListener('touchend', onTouchEndNative as any, { passive: false } as any);
    el.addEventListener('touchcancel', onTouchEndNative as any, { passive: false } as any);

    return () => {
      el.removeEventListener('mousedown', mDown);
      window.removeEventListener('mousemove', mMove);
      window.removeEventListener('mouseup', mUp);
      el.removeEventListener('touchstart', onTouchStartNative as any);
      el.removeEventListener('touchmove', onTouchMoveNative as any);
      el.removeEventListener('touchend', onTouchEndNative as any);
      el.removeEventListener('touchcancel', onTouchEndNative as any);
    };
  }, [enableZoom]);

  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) {
      const w = (img as any).naturalWidth || 0;
      const h = (img as any).naturalHeight || 0;
      if (w && h) {
        setNatural({ w, h });
        naturalRef.current = { w, h };
      }
    }
    setLoading(false);
    setHasError(false);
    onLoad?.();
  }, [onLoad]);

  const handleImgError = useCallback(() => {
    setLoading(false);
    setHasError(true);
    onError?.();
  }, [onError]);

  if (!photo) return null;
  const captionText = getCaptionText(photo.caption);
  const cls = clsx('gallery-media-photo', 'gallery-media-photo--block', 'gallery-media-cover');

  const customPropsStyle: CSSProperties & Record<string, any> = {
    ...(style as any),
    '--rbg-zoom-scale': renderScale,
    '--rbg-photo-scale': renderScale,
    '--rbg-scale': renderScale,
    '--rbg-pan-x': `${renderPan.x}px`,
    '--rbg-pan-y': `${renderPan.y}px`,
    '--rbg-photo-pan-x': `${renderPan.x}px`,
    '--rbg-photo-pan-y': `${renderPan.y}px`,
    transform: `translate(-50%, -50%) translate(${renderPan.x}px, ${renderPan.y}px) scale(${renderScale})`,
    transformOrigin: 'center center',
    left: '50%',
    top: '50%',
    right: 'auto',
    bottom: 'auto',
  };

  const onClickHandler = useCallback(() => {
    if (enableZoom && scaleRef.current > 1.001) return;
    if (dragRef.current?.active) return;
    onPress?.();
  }, [onPress, enableZoom]);

  const hTouchStart = useCallback((e: ReactTouchEvent<HTMLButtonElement>) => {
    if (enableZoom) {
      if (scaleRef.current > 1.001) return;
      if (e.touches && e.touches.length > 1) return;
    }
    onTouchStart?.(e);
  }, [onTouchStart, enableZoom]);

  const hTouchMove = useCallback((e: ReactTouchEvent<HTMLButtonElement>) => {
    if (enableZoom) {
      if (scaleRef.current > 1.001) return;
      if (e.touches && e.touches.length > 1) return;
    }
    onTouchMove?.(e);
  }, [onTouchMove, enableZoom]);

  const hTouchEnd = useCallback((e: ReactTouchEvent<HTMLButtonElement>) => {
    if (enableZoom && scaleRef.current > 1.001) return;
    onTouchEnd?.(e);
  }, [onTouchEnd, enableZoom]);

  return (
    <ul className="gallery-images--ul gallery-photo-list">
      <li className={clsx(cls, 'gallery-photo-item')}>
        <button
          type="button"
          onClick={onClickHandler}
          className="photo-button gallery-photo-button"
          onTouchStart={hTouchStart}
          onTouchMove={hTouchMove}
          onTouchEnd={hTouchEnd}
          onWheel={onWheel as any}
        >
          <div
            ref={containerRef}
            className={clsx('picture', 'gallery-image-wrapper', loading && 'loading', loading && 'is-loading')}
            style={{ position: 'absolute', inset: 0, overflow: 'hidden' } as any}
          >
            {loading && <LoadingSpinner />}
            {!hasError && (
              <img
                ref={imgRef}
                alt={photo.alt || captionText}
                className={clsx('photo', 'gallery-photo-image', 'media-image', 'gallery-image')}
                src={photo.photo || ''}
                onLoad={handleImgLoad}
                onError={handleImgError}
                style={customPropsStyle}
              />
            )}
          </div>
        </button>
      </li>
    </ul>
  );
}

const MemoizedPhoto = memo(Photo);
export { MemoizedPhoto as Photo };
