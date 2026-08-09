// rule: effect-needs-cleanup
// file-path: src/hooks/use-zoom-pan.ts
// verdict: fail
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit e31ae15e51f07a2e0748f68765d8e14c96dbcb6c5149d39582ebede4bc1737d2
import type { CSSProperties, MouseEvent, TouchEvent, TouchList } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
	clampPan,
	clampScale,
	focalPan,
	IDENTITY_TRANSFORM,
	isTransformMagnified,
	type Size,
	type ZoomTransform,
} from '../utils/zoom';

/** How aggressively a single wheel notch changes the scale. */
const WHEEL_ZOOM_FACTOR = 1.15;

/** Options controlling the gesture-driven zoom/pan behavior. */
export interface UseZoomPanOptions {
	/** When `false`, the image stays unmagnified and gestures do not zoom/pan. */
	enabled: boolean;
	/** Changing this value clears magnification (used to track the active photo). */
	resetKey: number;
	/** Invoked when a horizontal swipe should advance to the next photo. */
	onNavigateNext?: () => void;
	/** Invoked when a horizontal swipe should return to the previous photo. */
	onNavigatePrev?: () => void;
}

/** Gesture handlers attached to the interactive photo surface. */
export interface ZoomPanSurfaceHandlers {
	onTouchStart: (event: TouchEvent<HTMLElement>) => void;
	onTouchMove: (event: TouchEvent<HTMLElement>) => void;
	onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
	onMouseDown: (event: MouseEvent<HTMLElement>) => void;
}

/** Everything a consumer needs to wire up gesture-driven zoom/pan. */
export interface UseZoomPanResult {
	/** Callback ref for the surface element that receives gestures. */
	setSurfaceRef: (node: HTMLElement | null) => void;
	/** Inline CSS custom properties exposing the current scale and pan. */
	imageStyle: CSSProperties;
	/** Whether the image is currently magnified beyond its aspect-fit size. */
	isMagnified: boolean;
	/** Gesture handlers to spread onto the photo surface. */
	surfaceHandlers: ZoomPanSurfaceHandlers;
	/**
	 * Resolves whether a click on the surface should navigate. Returns `false`
	 * (and consumes the one-shot suppression flag) after a zoom/pan gesture or
	 * while magnified, so clicks and swipes never navigate a magnified image.
	 */
	consumeClickNavigation: () => boolean;
}

type TouchMode = 'none' | 'swipe' | 'pan' | 'pinch';

interface Point {
	x: number;
	y: number;
}

interface SurfaceMetrics {
	viewport: Size;
	center: Point;
	natural: Size | null;
}

/** Returns the active touch list, preferring `touches` but tolerating `targetTouches`. */
function getTouchList(event: TouchEvent<HTMLElement>): TouchList {
	if (event.touches && event.touches.length > 0) {
		return event.touches;
	}
	return event.targetTouches;
}

/** Euclidean distance between the first two touches. */
function touchDistance(touches: TouchList): number {
	const dx = touches[0].clientX - touches[1].clientX;
	const dy = touches[0].clientY - touches[1].clientY;
	return Math.hypot(dx, dy);
}

/** Midpoint of the first two touches, expressed relative to the viewport center. */
function touchMidpoint(touches: TouchList, center: Point): Point {
	return {
		x: (touches[0].clientX + touches[1].clientX) / 2 - center.x,
		y: (touches[0].clientY + touches[1].clientY) / 2 - center.y,
	};
}

/**
 * Manages gesture-driven zoom and pan for the active lightbox photo.
 *
 * Wheel and pinch zoom around a focal point; single-finger and mouse drags pan
 * while magnified. Pan is clamped to the rendered letterboxed image bounds, and
 * navigation (click/swipe) is suppressed whenever the image is magnified or a
 * zoom/pan gesture has just occurred.
 */
export function useZoomPan({
	enabled,
	resetKey,
	onNavigateNext,
	onNavigatePrev,
}: UseZoomPanOptions): UseZoomPanResult {
	const [transform, setTransform] = useState<ZoomTransform>(IDENTITY_TRANSFORM);

	// Mirror the latest transform and inputs in refs so gesture handlers can stay
	// stable (empty-dependency callbacks) while still reading current values.
	const transformRef = useRef<ZoomTransform>(transform);
	const enabledRef = useRef(enabled);
	const onNavigateNextRef = useRef(onNavigateNext);
	const onNavigatePrevRef = useRef(onNavigatePrev);

	const surfaceElRef = useRef<HTMLElement | null>(null);
	const metricsRef = useRef<SurfaceMetrics>({
		viewport: { width: 0, height: 0 },
		center: { x: 0, y: 0 },
		natural: null,
	});

	const touchModeRef = useRef<TouchMode>('none');
	const swipeStartXRef = useRef<number | null>(null);
	const swipeLastXRef = useRef<number | null>(null);
	const swipeMovedRef = useRef(false);
	const pinchPrevDistRef = useRef(0);
	const pinchPrevMidRef = useRef<Point>({ x: 0, y: 0 });
	const panLastRef = useRef<Point>({ x: 0, y: 0 });
	const mouseDraggingRef = useRef(false);
	const mouseLastRef = useRef<Point>({ x: 0, y: 0 });
	const suppressClickRef = useRef(false);

	// Reset magnification when the active photo changes so a new photo never
	// inherits a stale zoom/pan frame. Adjusting state during render (guarded by
	// the ref check) re-renders before paint, avoiding a flash of the old zoom.
	const prevResetKeyRef = useRef(resetKey);
	if (prevResetKeyRef.current !== resetKey) {
		prevResetKeyRef.current = resetKey;
		if (transformRef.current !== IDENTITY_TRANSFORM) {
			transformRef.current = IDENTITY_TRANSFORM;
			setTransform(IDENTITY_TRANSFORM);
		}
	}

	// When zoom is turned off, drop any magnification immediately (no post-paint
	// effect) so the image presents unmagnified without a lingering zoomed frame.
	const prevEnabledRef = useRef(enabled);
	if (prevEnabledRef.current !== enabled) {
		prevEnabledRef.current = enabled;
		if (!enabled && transformRef.current !== IDENTITY_TRANSFORM) {
			transformRef.current = IDENTITY_TRANSFORM;
			setTransform(IDENTITY_TRANSFORM);
		}
	}

	// Effective transform: unmagnified whenever zoom is disabled, so both the
	// rendered style and gesture gating reflect the disabled state on first paint.
	const active = enabled ? transform : IDENTITY_TRANSFORM;
	const isMagnified = enabled && isTransformMagnified(active);

	enabledRef.current = enabled;
	onNavigateNextRef.current = onNavigateNext;
	onNavigatePrevRef.current = onNavigatePrev;
	const isMagnifiedRef = useRef(isMagnified);
	isMagnifiedRef.current = isMagnified;

	const commit = useCallback((next: ZoomTransform) => {
		transformRef.current = next;
		setTransform(next);
	}, []);

	const readMetrics = useCallback((): SurfaceMetrics => {
		const el = surfaceElRef.current;
		if (!el) {
			return {
				viewport: { width: 0, height: 0 },
				center: { x: 0, y: 0 },
				natural: null,
			};
		}
		const rect = el.getBoundingClientRect();
		const width = rect.width || el.clientWidth || 0;
		const height = rect.height || el.clientHeight || 0;
		const img = el.querySelector('img');
		let natural: Size | null = null;
		if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
			natural = { width: img.naturalWidth, height: img.naturalHeight };
		}
		return {
			viewport: { width, height },
			center: { x: rect.left + width / 2, y: rect.top + height / 2 },
			natural,
		};
	}, []);

	const applyZoomAt = useCallback(
		(focal: Point, nextScaleRaw: number, metrics: SurfaceMetrics) => {
			const current = transformRef.current;
			const nextScale = clampScale(nextScaleRaw);
			if (nextScale === current.scale) {
				return;
			}
			const candidate = focalPan(current, focal, current.scale, nextScale);
			const clamped = clampPan(
				candidate,
				metrics.viewport,
				metrics.natural,
				nextScale,
			);
			commit({ scale: nextScale, x: clamped.x, y: clamped.y });
		},
		[commit],
	);

	// Wheel handling is attached as a non-passive native listener (below) so it
	// can call preventDefault and stop the page from scrolling while zooming.
	const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
	wheelHandlerRef.current = (event: WheelEvent) => {
		if (!enabledRef.current) {
			return;
		}
		if (event.cancelable) {
			event.preventDefault();
		}
		const metrics = readMetrics();
		metricsRef.current = metrics;
		const focal: Point = {
			x: event.clientX - metrics.center.x,
			y: event.clientY - metrics.center.y,
		};
		const current = transformRef.current;
		const factor =
			event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
		applyZoomAt(focal, current.scale * factor, metrics);
	};

	const onWheelNativeRef = useRef<(event: WheelEvent) => void>((event) => {
		wheelHandlerRef.current(event);
	});

	const setSurfaceRef = useCallback((node: HTMLElement | null) => {
		const previous = surfaceElRef.current;
		if (previous) {
			previous.removeEventListener('wheel', onWheelNativeRef.current);
		}
		surfaceElRef.current = node;
		if (node) {
			node.addEventListener('wheel', onWheelNativeRef.current, {
				passive: false,
			});
		}
	}, []);

	const beginSwipe = useCallback((event: TouchEvent<HTMLElement>) => {
		touchModeRef.current = 'swipe';
		const touch = event.targetTouches?.[0];
		swipeStartXRef.current = touch ? touch.screenX : null;
		swipeLastXRef.current = null;
		swipeMovedRef.current = false;
	}, []);

	const onTouchStart = useCallback(
		(event: TouchEvent<HTMLElement>) => {
			suppressClickRef.current = false;
			if (!enabledRef.current) {
				// Zoom disabled: preserve plain swipe navigation.
				beginSwipe(event);
				return;
			}

			const touches = getTouchList(event);
			if (touches.length >= 2) {
				const metrics = readMetrics();
				metricsRef.current = metrics;
				touchModeRef.current = 'pinch';
				pinchPrevDistRef.current = touchDistance(touches);
				pinchPrevMidRef.current = touchMidpoint(touches, metrics.center);
				// A pinch must never fall through to a tap/click navigation.
				suppressClickRef.current = true;
			} else if (isMagnifiedRef.current) {
				touchModeRef.current = 'pan';
				metricsRef.current = readMetrics();
				panLastRef.current = {
					x: touches[0].clientX,
					y: touches[0].clientY,
				};
			} else {
				beginSwipe(event);
			}
		},
		[beginSwipe, readMetrics],
	);

	const onTouchMove = useCallback(
		(event: TouchEvent<HTMLElement>) => {
			const mode = touchModeRef.current;
			if (mode === 'pinch') {
				const touches = getTouchList(event);
				if (touches.length < 2) {
					return;
				}
				suppressClickRef.current = true;
				const metrics = metricsRef.current;
				const current = transformRef.current;
				const dist = touchDistance(touches);
				const mid = touchMidpoint(touches, metrics.center);
				const prevDist = pinchPrevDistRef.current || dist;
				const ratio = prevDist > 0 ? dist / prevDist : 1;
				const nextScale = clampScale(current.scale * ratio);
				const applied = current.scale > 0 ? nextScale / current.scale : 1;
				const prevMid = pinchPrevMidRef.current;
				const candidate = {
					x: mid.x - applied * (prevMid.x - current.x),
					y: mid.y - applied * (prevMid.y - current.y),
				};
				const clamped = clampPan(
					candidate,
					metrics.viewport,
					metrics.natural,
					nextScale,
				);
				commit({ scale: nextScale, x: clamped.x, y: clamped.y });
				pinchPrevDistRef.current = dist;
				pinchPrevMidRef.current = mid;
				if (event.cancelable) {
					event.preventDefault();
				}
			} else if (mode === 'pan') {
				const touches = getTouchList(event);
				if (touches.length === 0) {
					return;
				}
				suppressClickRef.current = true;
				const metrics = metricsRef.current;
				const current = transformRef.current;
				const touch = touches[0];
				const last = panLastRef.current;
				const dx = touch.clientX - last.x;
				const dy = touch.clientY - last.y;
				panLastRef.current = { x: touch.clientX, y: touch.clientY };
				const clamped = clampPan(
					{ x: current.x + dx, y: current.y + dy },
					metrics.viewport,
					metrics.natural,
					current.scale,
				);
				commit({ scale: current.scale, x: clamped.x, y: clamped.y });
				if (event.cancelable) {
					event.preventDefault();
				}
			} else if (mode === 'swipe') {
				swipeMovedRef.current = true;
				const touch = event.targetTouches?.[0];
				if (touch) {
					swipeLastXRef.current = touch.screenX;
				}
			}
		},
		[commit],
	);

	const onTouchEnd = useCallback(() => {
		const mode = touchModeRef.current;
		if (mode === 'swipe' && swipeMovedRef.current && !isMagnifiedRef.current) {
			const start = swipeStartXRef.current;
			const end = swipeLastXRef.current;
			if (start != null && end != null && start !== end) {
				if (start < end) {
					onNavigatePrevRef.current?.();
				} else {
					onNavigateNextRef.current?.();
				}
				// A moved swipe should not also trigger the trailing click.
				suppressClickRef.current = true;
			}
		}
		touchModeRef.current = 'none';
	}, []);

	// Mouse drag panning uses window-level listeners so the drag continues even
	// when the cursor leaves the surface. Handlers are created once and read refs.
	const mouseHandlersRef = useRef<{
		move: (event: globalThis.MouseEvent) => void;
		up: () => void;
	} | null>(null);
	if (!mouseHandlersRef.current) {
		mouseHandlersRef.current = {
			move: (event: globalThis.MouseEvent) => {
				if (!mouseDraggingRef.current) {
					return;
				}
				suppressClickRef.current = true;
				const metrics = metricsRef.current;
				const current = transformRef.current;
				const last = mouseLastRef.current;
				const dx = event.clientX - last.x;
				const dy = event.clientY - last.y;
				mouseLastRef.current = { x: event.clientX, y: event.clientY };
				const clamped = clampPan(
					{ x: current.x + dx, y: current.y + dy },
					metrics.viewport,
					metrics.natural,
					current.scale,
				);
				transformRef.current = {
					scale: current.scale,
					x: clamped.x,
					y: clamped.y,
				};
				setTransform(transformRef.current);
			},
			up: () => {
				mouseDraggingRef.current = false;
				const handlers = mouseHandlersRef.current;
				if (handlers && typeof window !== 'undefined') {
					window.removeEventListener('mousemove', handlers.move);
					window.removeEventListener('mouseup', handlers.up);
				}
			},
		};
	}

	const onMouseDown = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (!enabledRef.current || !isMagnifiedRef.current) {
				// Leave clicks alone when unmagnified so navigation still works.
				return;
			}
			if (event.button !== 0) {
				return;
			}
			metricsRef.current = readMetrics();
			mouseLastRef.current = { x: event.clientX, y: event.clientY };
			mouseDraggingRef.current = true;
			const handlers = mouseHandlersRef.current;
			if (handlers && typeof window !== 'undefined') {
				window.addEventListener('mousemove', handlers.move);
				window.addEventListener('mouseup', handlers.up);
			}
			// Prevent the browser's native image drag while panning.
			event.preventDefault();
		},
		[readMetrics],
	);

	const consumeClickNavigation = useCallback(() => {
		const suppressed = suppressClickRef.current;
		suppressClickRef.current = false;
		if (suppressed) {
			return false;
		}
		return !isMagnifiedRef.current;
	}, []);

	const imageStyle = useMemo<CSSProperties>(() => {
		const scaleValue = active.scale;
		const panXValue = `${active.x}px`;
		const panYValue = `${active.y}px`;
		return {
			'--rbg-zoom-scale': scaleValue,
			'--rbg-photo-scale': scaleValue,
			'--rbg-scale': scaleValue,
			'--rbg-pan-x': panXValue,
			'--rbg-pan-y': panYValue,
			'--rbg-photo-pan-x': panXValue,
			'--rbg-photo-pan-y': panYValue,
		} as CSSProperties;
	}, [active.scale, active.x, active.y]);

	return {
		setSurfaceRef,
		imageStyle,
		isMagnified,
		surfaceHandlers: { onTouchStart, onTouchMove, onTouchEnd, onMouseDown },
		consumeClickNavigation,
	};
}
