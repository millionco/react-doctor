// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 3eeb1bb0eafb269811429b19823d2665fbc7c6edb447f08da5a3ff59a51e4e24
import type { CSSProperties, MouseEvent, RefObject, Touch, TouchEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Current magnification (scale) and translation (pan) of the active photo. */
export interface PhotoZoomState {
	scale: number;
	panX: number;
	panY: number;
}

/** Gesture handlers wired onto the photo surface. */
export interface PhotoZoomHandlers {
	onTouchStart: (event: TouchEvent<HTMLButtonElement>) => void;
	onTouchMove: (event: TouchEvent<HTMLButtonElement>) => void;
	onTouchEnd: (event: TouchEvent<HTMLButtonElement>) => void;
	onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export interface UsePhotoZoomOptions {
	enabled: boolean;
	activePhotoIndex: number;
	viewportRef: RefObject<HTMLElement | null>;
	imageRef: RefObject<HTMLImageElement | null>;
	onSwipeNext: () => void;
	onSwipePrev: () => void;
	onActivate: () => void;
}

export interface UsePhotoZoomResult {
	zoom: PhotoZoomState;
	isMagnified: boolean;
	handlers: PhotoZoomHandlers;
	imageStyle: CSSProperties;
	/** Callback ref for the photo viewport element. */
	viewportCallbackRef: (element: HTMLElement | null) => void;
}

/** Minimum magnification — the unmagnified, aspect-fit presentation. */
const MIN_SCALE = 1;
/** Maximum magnification applied by wheel/pinch gestures. */
const MAX_SCALE = 5;
/** Wheel sensitivity — multiplied by `deltaY` inside an exponential scale curve. */
const WHEEL_ZOOM_SPEED = 0.0015;
/** Epsilon used to snap back to the unmagnified state. */
const SCALE_EPSILON = 1e-6;

const RESET_STATE: PhotoZoomState = { scale: 1, panX: 0, panY: 0 };

/**
 * Picks the richer of the two React touch lists so gesture handling works
 * whether tests/engines populate `touches` or `targetTouches`.
 */
function pickTouchList(event: TouchEvent) {
	return event.touches.length >= event.targetTouches.length
		? event.touches
		: event.targetTouches;
}

/**
 * Reads client coordinates from a touch, falling back to screen coordinates so
 * pan/pinch deltas stay usable when an engine only populates `screenX/Y`.
 */
function touchCoords(touch: Touch) {
	return {
		clientX: typeof touch.clientX === 'number' ? touch.clientX : touch.screenX,
		clientY: typeof touch.clientY === 'number' ? touch.clientY : touch.screenY,
	};
}

/**
 * Reads the rendered (aspect-fit) size of the image inside its viewport plus the
 * viewport size. Layout dimensions are used (not bounding rects) so that the
 * CSS `transform: scale()` does not contaminate the measurement.
 */
function getRenderedDimensions(
	viewport: HTMLElement | null,
	image: HTMLImageElement | null,
) {
	const vw = viewport?.clientWidth ?? 0;
	const vh = viewport?.clientHeight ?? 0;
	let rw = image?.clientWidth ?? 0;
	let rh = image?.clientHeight ?? 0;

	// When the image has not been laid out yet (e.g. jsdom), derive the
	// letterboxed size from its natural dimensions and the viewport.
	if ((rw === 0 || rh === 0) && image && vw > 0 && vh > 0) {
		const naturalWidth = image.naturalWidth;
		const naturalHeight = image.naturalHeight;
		if (naturalWidth > 0 && naturalHeight > 0) {
			const fit = Math.min(vw / naturalWidth, vh / naturalHeight);
			rw = naturalWidth * fit;
			rh = naturalHeight * fit;
		}
	}

	return { vw, vh, rw, rh };
}

/**
 * Clamps the pan offset per axis so the magnified image can never expose empty
 * background beyond its rendered bounds. Panning along an axis is only possible
 * when the magnified image overflows the viewport on that axis.
 */
function clampPan(
	scale: number,
	panX: number,
	panY: number,
	vw: number,
	vh: number,
	rw: number,
	rh: number,
): PhotoZoomState {
	const maxX = Math.max(0, (rw * scale - vw) / 2);
	const maxY = Math.max(0, (rh * scale - vh) / 2);
	return {
		scale,
		panX: Math.min(Math.max(panX, -maxX), maxX),
		panY: Math.min(Math.max(panY, -maxY), maxY),
	};
}

/**
 * Gesture-driven zoom/pan for the lightbox photo.
 *
 * Supports wheel zoom (focal), pinch zoom (focal), one-finger drag pan, mouse
 * drag pan, and suppresses photo navigation (click + swipe) while magnified.
 * Pan is clamped to the rendered letterboxed image bounds on every scale change.
 */
export function usePhotoZoom({
	enabled,
	activePhotoIndex,
	viewportRef,
	imageRef,
	onSwipeNext,
	onSwipePrev,
	onActivate,
}: UsePhotoZoomOptions): UsePhotoZoomResult {
	const [zoom, setZoom] = useState<PhotoZoomState>(RESET_STATE);
	const zoomRef = useRef<PhotoZoomState>(RESET_STATE);

	// Gesture tracking refs (mutable, no re-render needed).
	const swipeStartRef = useRef<{ screenX: number } | null>(null);
	const swipeEndRef = useRef<{ screenX: number } | null>(null);
	const touchMovedRef = useRef(false);
	const pinchRef = useRef<{
		distance: number;
		scale: number;
		panX: number;
		panY: number;
	} | null>(null);
	const panStartRef = useRef<{
		clientX: number;
		clientY: number;
		panX: number;
		panY: number;
	} | null>(null);
	const mouseDragRef = useRef(false);
	// Tracks the active native wheel listener so it can be detached precisely.
	const wheelListenerRef = useRef<{
		element: HTMLElement;
		handler: (event: globalThis.WheelEvent) => void;
	} | null>(null);

	const isMagnified = zoom.scale > MIN_SCALE + SCALE_EPSILON;

	const commit = useCallback((next: PhotoZoomState) => {
		zoomRef.current = next;
		setZoom(next);
	}, []);

	const reset = useCallback(() => {
		pinchRef.current = null;
		panStartRef.current = null;
		touchMovedRef.current = false;
		swipeStartRef.current = null;
		swipeEndRef.current = null;
		commit(RESET_STATE);
	}, [commit]);

	// Clear magnification whenever the active photo changes.
	useEffect(() => {
		reset();
	}, [activePhotoIndex, reset]);

	// When zoom is turned off, snap immediately to the unmagnified frame with no
	// delayed/animated transition leaving a magnified frame visible.
	useEffect(() => {
		if (!enabled) {
			reset();
		}
	}, [enabled, reset]);

	const applyScaleChange = useCallback(
		(nextScale: number, focalClientX: number, focalClientY: number) => {
			const current = zoomRef.current;
			const clampedScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);

			if (clampedScale <= MIN_SCALE + SCALE_EPSILON) {
				commit(RESET_STATE);
				return;
			}

			const viewport = viewportRef.current;
			const rect = viewport?.getBoundingClientRect();
			const centerX = rect ? rect.left + rect.width / 2 : 0;
			const centerY = rect ? rect.top + rect.height / 2 : 0;
			const focalX = focalClientX - centerX;
			const focalY = focalClientY - centerY;

			// Keep the content point under the focal point stationary.
			const ratio = clampedScale / current.scale;
			const nextPanX = focalX - (focalX - current.panX) * ratio;
			const nextPanY = focalY - (focalY - current.panY) * ratio;

			const dims = getRenderedDimensions(viewport, imageRef.current);
			commit(
				clampPan(
					clampedScale,
					nextPanX,
					nextPanY,
					dims.vw,
					dims.vh,
					dims.rw,
					dims.rh,
				),
			);
		},
		[commit, imageRef, viewportRef],
	);

	const applyPan = useCallback(
		(deltaX: number, deltaY: number) => {
			const start = panStartRef.current;
			if (!start) {
				return;
			}
			const current = zoomRef.current;
			const nextPanX = start.panX + deltaX;
			const nextPanY = start.panY + deltaY;
			const dims = getRenderedDimensions(viewportRef.current, imageRef.current);
			commit(
				clampPan(
					current.scale,
					nextPanX,
					nextPanY,
					dims.vw,
					dims.vh,
					dims.rw,
					dims.rh,
				),
			);
		},
		[commit, imageRef, viewportRef],
	);

	const attachWheelListener = useCallback(
		(element: HTMLElement | null) => {
			// Detach any previously attached listener first.
			if (wheelListenerRef.current) {
				wheelListenerRef.current.element.removeEventListener(
					'wheel',
					wheelListenerRef.current.handler,
				);
				wheelListenerRef.current = null;
			}

			viewportRef.current = element;

			if (!element || !enabled) {
				return;
			}

			const onWheel = (event: globalThis.WheelEvent) => {
				event.preventDefault();
				const current = zoomRef.current;
				const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED);
				applyScaleChange(current.scale * factor, event.clientX, event.clientY);
			};

			element.addEventListener('wheel', onWheel, { passive: false });
			wheelListenerRef.current = { element, handler: onWheel };
		},
		[applyScaleChange, enabled, viewportRef],
	);

	// --- Touch handlers: swipe (unmagnified) / pinch zoom / one-finger pan ---

	const onTouchStart = useCallback(
		(event: TouchEvent<HTMLButtonElement>) => {
			const list = pickTouchList(event);
			const count = list.length;

			if (count === 0) {
				return;
			}

			touchMovedRef.current = false;
			swipeStartRef.current = { screenX: list[0].screenX };
			swipeEndRef.current = null;
			pinchRef.current = null;
			panStartRef.current = null;

			if (enabled && count >= 2) {
				const c0 = touchCoords(list[0]);
				const c1 = touchCoords(list[1]);
				const current = zoomRef.current;
				pinchRef.current = {
					distance: Math.hypot(c1.clientX - c0.clientX, c1.clientY - c0.clientY),
					scale: current.scale,
					panX: current.panX,
					panY: current.panY,
				};
				return;
			}

			if (
				enabled &&
				count === 1 &&
				zoomRef.current.scale > MIN_SCALE + SCALE_EPSILON
			) {
				const c = touchCoords(list[0]);
				panStartRef.current = {
					clientX: c.clientX,
					clientY: c.clientY,
					panX: zoomRef.current.panX,
					panY: zoomRef.current.panY,
				};
			}
		},
		[enabled],
	);

	const onTouchMove = useCallback(
		(event: TouchEvent<HTMLButtonElement>) => {
			const list = pickTouchList(event);
			const count = list.length;
			touchMovedRef.current = true;

			if (pinchRef.current && count >= 2 && enabled) {
				const c0 = touchCoords(list[0]);
				const c1 = touchCoords(list[1]);
				const distance = Math.hypot(
					c1.clientX - c0.clientX,
					c1.clientY - c0.clientY,
				);
				const start = pinchRef.current;
				if (start.distance > 0) {
					applyScaleChange(
						start.scale * (distance / start.distance),
						(c0.clientX + c1.clientX) / 2,
						(c0.clientY + c1.clientY) / 2,
					);
				}
				event.preventDefault();
				return;
			}

			if (panStartRef.current && count >= 1 && enabled) {
				const c = touchCoords(list[0]);
				applyPan(
					c.clientX - panStartRef.current.clientX,
					c.clientY - panStartRef.current.clientY,
				);
				event.preventDefault();
				return;
			}

			// Unmagnified swipe tracking — record the latest horizontal position.
			if (count >= 1) {
				swipeEndRef.current = { screenX: list[0].screenX };
			}
		},
		[applyPan, applyScaleChange, enabled],
	);

	const onTouchEnd = useCallback(
		(event: TouchEvent<HTMLButtonElement>) => {
			const list = pickTouchList(event);
			const remaining = list.length;

			// A pinch ends once fewer than two fingers remain.
			if (pinchRef.current && remaining < 2) {
				pinchRef.current = null;
				// If a finger remains while magnified, continue as a one-finger pan.
				if (
					enabled &&
					remaining === 1 &&
					zoomRef.current.scale > MIN_SCALE + SCALE_EPSILON
				) {
					const c = touchCoords(list[0]);
					panStartRef.current = {
						clientX: c.clientX,
						clientY: c.clientY,
						panX: zoomRef.current.panX,
						panY: zoomRef.current.panY,
					};
				}
				return;
			}

			// A one-finger pan ends.
			if (panStartRef.current && remaining < 1) {
				panStartRef.current = null;
				return;
			}

			// While magnified, swipes must pan the photo, not navigate the gallery.
			if (zoomRef.current.scale > MIN_SCALE + SCALE_EPSILON) {
				return;
			}

			// Unmagnified swipe → gallery navigation. A swipe is recognised on any
			// horizontal movement (matching the pre-zoom gesture behaviour).
			const start = swipeStartRef.current;
			const end = swipeEndRef.current;
			if (touchMovedRef.current && start && end) {
				if (start.screenX < end.screenX) {
					onSwipePrev();
				} else if (start.screenX > end.screenX) {
					onSwipeNext();
				}
			}
		},
		[enabled, onSwipeNext, onSwipePrev],
	);

	// --- Mouse drag pan (desktop) ---

	const onMouseDown = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			if (!enabled || zoomRef.current.scale <= MIN_SCALE + SCALE_EPSILON) {
				return;
			}
			event.preventDefault();
			mouseDragRef.current = true;
			panStartRef.current = {
				clientX: event.clientX,
				clientY: event.clientY,
				panX: zoomRef.current.panX,
				panY: zoomRef.current.panY,
			};

			const onMove = (moveEvent: globalThis.MouseEvent) => {
				if (!mouseDragRef.current || !panStartRef.current) {
					return;
				}
				applyPan(
					moveEvent.clientX - panStartRef.current.clientX,
					moveEvent.clientY - panStartRef.current.clientY,
				);
			};

			const onUp = () => {
				mouseDragRef.current = false;
				panStartRef.current = null;
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};

			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[applyPan, enabled],
	);

	const onClick = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			// While magnified (incl. immediately after a pinch or wheel zoom),
			// clicks must not advance to the next photo. Pans only ever start while
			// magnified, so the magnified check also covers the click that follows a
			// drag gesture.
			if (zoomRef.current.scale > MIN_SCALE + SCALE_EPSILON) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			onActivate();
		},
		[onActivate],
	);

	const panXCss = `${zoom.panX}px`;
	const panYCss = `${zoom.panY}px`;
	const imageStyle = useMemo<CSSProperties>(
		() =>
			({
				// Scale and pan are exposed under every accepted alias so consumers and
				// tests can read either naming convention.
				'--rbg-photo-scale': zoom.scale,
				'--rbg-zoom-scale': zoom.scale,
				'--rbg-scale': zoom.scale,
				'--rbg-photo-pan-x': panXCss,
				'--rbg-photo-pan-y': panYCss,
				'--rbg-pan-x': panXCss,
				'--rbg-pan-y': panYCss,
			}) as CSSProperties,
		[panXCss, panYCss, zoom.scale],
	);

	return {
		zoom,
		isMagnified,
		handlers: {
			onTouchStart,
			onTouchMove,
			onTouchEnd,
			onMouseDown,
			onClick,
		},
		imageStyle,
		viewportCallbackRef: attachWheelListener,
	};
}
