// rule: effect-needs-cleanup
// file-path: src/hooks/use-zoom-pan.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit b972a1d91a94e7a28d3239f3b4a029c312744ee2a2dfcc0ef25a3fcb51f270a2
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	RefCallback,
	RefObject,
	TouchEvent as ReactTouchEvent,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Minimum magnification (1 = unmagnified, no zoom). */
const MIN_SCALE = 1;
/** Maximum magnification applied by wheel/pinch gestures. */
const MAX_SCALE = 4;
/** Exponential wheel-zoom sensitivity. */
const WHEEL_ZOOM_FACTOR = 0.0016;
/** Minimum pointer movement (px) before a drag is treated as a pan. */
const PAN_MIN_MOVEMENT = 4;

/** Swipe direction reported to the gallery for navigation. */
type SwipeDirection = 'prev' | 'next';

/** A 2D point in viewport (client) coordinates. */
interface Point {
	x: number;
	y: number;
}

/** Mutable zoom/pan transform state. */
interface ZoomPanState {
	scale: number;
	panX: number;
	panY: number;
}

/** Snapshot used to compute pan deltas from a gesture start. */
interface PanStart {
	panX: number;
	panY: number;
	point: Point;
}

/** Snapshot used to compute pinch zoom from a gesture start. */
interface PinchStart {
	scale: number;
	panX: number;
	panY: number;
	distance: number;
}

const INITIAL_STATE: ZoomPanState = { scale: 1, panX: 0, panY: 0 };

/** Euclidean distance between two points. */
function distanceBetween(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint of two points. */
function midpointOf(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Reads the measured viewport box (the letterboxed image container). */
function getViewportBox(element: HTMLElement | null) {
	if (!element) {
		return { left: 0, top: 0, width: 0, height: 0 };
	}

	const rect = element.getBoundingClientRect();
	return {
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height,
	};
}

/**
 * Computes the unmagnified (scale 1) letterboxed render size of the image
 * inside its viewport using the image's natural dimensions (aspect-fit).
 */
function getRenderedSize(
	image: HTMLImageElement | null,
	viewport: { width: number; height: number },
) {
	const naturalWidth = image?.naturalWidth ?? 0;
	const naturalHeight = image?.naturalHeight ?? 0;

	if (
		naturalWidth <= 0 ||
		naturalHeight <= 0 ||
		viewport.width <= 0 ||
		viewport.height <= 0
	) {
		return { width: 0, height: 0 };
	}

	const fitScale = Math.min(
		viewport.width / naturalWidth,
		viewport.height / naturalHeight,
	);
	return {
		width: naturalWidth * fitScale,
		height: naturalHeight * fitScale,
	};
}

/** Clamps pan offsets so the magnified image never exposes empty background. */
function clampPan(
	state: ZoomPanState,
	viewport: { width: number; height: number },
	rendered: { width: number; height: number },
): ZoomPanState {
	const maxX = Math.max(0, (rendered.width * state.scale - viewport.width) / 2);
	const maxY = Math.max(
		0,
		(rendered.height * state.scale - viewport.height) / 2,
	);

	return {
		scale: state.scale,
		panX: Math.min(Math.max(state.panX, -maxX), maxX),
		panY: Math.min(Math.max(state.panY, -maxY), maxY),
	};
}

/**
 * Reads touch points from whichever TouchList is populated by the event.
 * Falls back from `clientX`/`clientY` to `screenX`/`screenY` so that tests
 * (and devices) that only provide one coordinate system still work.
 */
function getTouchPoints(event: TouchEvent | ReactTouchEvent<HTMLElement>): Point[] {
	const list = event.touches?.length ? event.touches : event.targetTouches;
	if (!list) {
		return [];
	}

	const points: Point[] = [];
	for (let i = 0; i < list.length; i += 1) {
		const touch = list[i];
		points.push({
			x: touch.clientX ?? touch.screenX,
			y: touch.clientY ?? touch.screenY,
		});
	}

	return points;
}

interface UseZoomPanOptions {
	enabled: boolean;
	resetKey: unknown;
	viewportRef: RefObject<HTMLElement | null>;
	imageRef: RefObject<HTMLImageElement | null>;
	onSwipe: (direction: SwipeDirection) => void;
}

interface UseZoomPanResult {
	scale: number;
	panX: number;
	panY: number;
	isMagnified: boolean;
	style: CSSProperties;
	/** Ref consulted by the photo click handler to swallow post-gesture clicks. */
	suppressClickRef: RefObject<boolean>;
	/** Attach to the photo button; wires non-passive wheel/touch listeners. */
	buttonRef: RefCallback<HTMLButtonElement>;
	onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
	reset: () => void;
}

/**
 * Gesture-driven zoom/pan for the lightbox photo.
 *
 * Wheel and pinch zoom magnify the image; dragging while magnified pans it.
 * Pan is clamped to the rendered letterboxed image bounds so empty background
 * is never exposed. Click and swipe navigation are suppressed while magnified.
 */
function useZoomPan({
	enabled,
	resetKey,
	viewportRef,
	imageRef,
	onSwipe,
}: UseZoomPanOptions): UseZoomPanResult {
	const [state, setState] = useState<ZoomPanState>(INITIAL_STATE);

	const enabledRef = useRef(enabled);
	const stateRef = useRef(state);
	const onSwipeRef = useRef(onSwipe);

	const touchStartRef = useRef<Point | null>(null);
	const touchLastRef = useRef<Point | null>(null);
	const pinchStartRef = useRef<PinchStart | null>(null);
	const pinchingRef = useRef(false);
	const panningRef = useRef(false);
	const panStartRef = useRef<PanStart | null>(null);
	const draggingRef = useRef(false);
	const suppressClickRef = useRef(false);
	const buttonNodeRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		enabledRef.current = enabled;
	}, [enabled]);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	useEffect(() => {
		onSwipeRef.current = onSwipe;
	}, [onSwipe]);

	const reset = useCallback(() => {
		pinchStartRef.current = null;
		pinchingRef.current = false;
		panningRef.current = false;
		panStartRef.current = null;
		draggingRef.current = false;
		suppressClickRef.current = false;
		touchStartRef.current = null;
		touchLastRef.current = null;
		setState(INITIAL_STATE);
	}, []);

	// Clear magnification whenever the active photo changes.
	useEffect(() => {
		reset();
	}, [resetKey, reset]);

	// When zoom is turned off, present unmagnified immediately (no delayed frame).
	useEffect(() => {
		if (!enabled) {
			reset();
		}
	}, [enabled, reset]);

	const applyClamp = useCallback(
		(next: ZoomPanState): ZoomPanState => {
			const viewport = getViewportBox(viewportRef.current);
			const rendered = getRenderedSize(imageRef.current, viewport);
			return clampPan(next, viewport, rendered);
		},
		[imageRef, viewportRef],
	);

	/**
	 * Zooms toward a focal point, keeping the point under the cursor fixed,
	 * then clamps pan to the rendered image bounds.
	 */
	const zoomAtFocal = useCallback(
		(nextScale: number, focal: Point) => {
			const clampedScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
			setState((prev) => {
				if (clampedScale === prev.scale) {
					return applyClamp(prev);
				}

				const viewport = getViewportBox(viewportRef.current);
				const centerX = viewport.left + viewport.width / 2;
				const centerY = viewport.top + viewport.height / 2;
				const dx = focal.x - centerX;
				const dy = focal.y - centerY;
				const ratio = clampedScale / prev.scale;
				return applyClamp({
					scale: clampedScale,
					panX: dx * (1 - ratio) + ratio * prev.panX,
					panY: dy * (1 - ratio) + ratio * prev.panY,
				});
			});
		},
		[applyClamp, viewportRef],
	);

	const setPanFromDelta = useCallback(
		(start: PanStart, current: Point) => {
			setState((prev) =>
				applyClamp({
					scale: prev.scale,
					panX: start.panX + (current.x - start.point.x),
					panY: start.panY + (current.y - start.point.y),
				}),
			);
		},
		[applyClamp],
	);

	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (!enabledRef.current) {
				return;
			}

			event.preventDefault();
			suppressClickRef.current = true;
			const current = stateRef.current;
			const nextScale =
				current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_FACTOR);
			zoomAtFocal(nextScale, { x: event.clientX, y: event.clientY });
		},
		[zoomAtFocal],
	);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!enabledRef.current || !draggingRef.current || !panStartRef.current) {
				return;
			}

			const dx = event.clientX - panStartRef.current.point.x;
			const dy = event.clientY - panStartRef.current.point.y;
			if (Math.abs(dx) >= PAN_MIN_MOVEMENT || Math.abs(dy) >= PAN_MIN_MOVEMENT) {
				suppressClickRef.current = true;
			}

			setPanFromDelta(panStartRef.current, {
				x: event.clientX,
				y: event.clientY,
			});
		},
		[setPanFromDelta],
	);

	const handleMouseUp = useCallback(() => {
		if (!draggingRef.current) {
			return;
		}

		draggingRef.current = false;
		panStartRef.current = null;
		document.removeEventListener('mousemove', handleMouseMove);
		document.removeEventListener('mouseup', handleMouseUp);
	}, [handleMouseMove]);

	// Ensure document drag listeners can never outlive the component.
	useEffect(
		() => () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		},
		[handleMouseMove, handleMouseUp],
	);

	const onMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			if (!enabledRef.current) {
				return;
			}

			// A new mouse gesture clears any lingering post-gesture click suppression.
			suppressClickRef.current = false;

			// Only start a pan drag while magnified; otherwise the click navigates.
			if (stateRef.current.scale <= MIN_SCALE) {
				return;
			}

			event.preventDefault();
			draggingRef.current = true;
			panStartRef.current = {
				panX: stateRef.current.panX,
				panY: stateRef.current.panY,
				point: { x: event.clientX, y: event.clientY },
			};
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		},
		[handleMouseMove, handleMouseUp],
	);

	const handleTouchStart = useCallback((event: TouchEvent) => {
		if (!enabledRef.current) {
			return;
		}

		suppressClickRef.current = false;
		const points = getTouchPoints(event);
		const current = stateRef.current;

		if (points.length >= 2) {
			pinchingRef.current = true;
			panningRef.current = false;
			panStartRef.current = null;
			pinchStartRef.current = {
				scale: current.scale,
				panX: current.panX,
				panY: current.panY,
				distance: distanceBetween(points[0], points[1]),
			};
			touchStartRef.current = points[0];
			touchLastRef.current = points[0];
			return;
		}

		if (points.length === 1) {
			pinchingRef.current = false;
			pinchStartRef.current = null;
			touchStartRef.current = points[0];
			touchLastRef.current = points[0];

			if (current.scale > MIN_SCALE) {
				panningRef.current = true;
				panStartRef.current = {
					panX: current.panX,
					panY: current.panY,
					point: points[0],
				};
			} else {
				panningRef.current = false;
				panStartRef.current = null;
			}
		}
	}, []);

	const handleTouchMove = useCallback(
		(event: TouchEvent) => {
			if (!enabledRef.current) {
				return;
			}

			const points = getTouchPoints(event);

			if (pinchingRef.current && points.length >= 2 && pinchStartRef.current) {
				event.preventDefault();
				suppressClickRef.current = true;
				const start = pinchStartRef.current;
				const currentDistance = distanceBetween(points[0], points[1]);
				if (start.distance === 0) {
					return;
				}

				const ratio = currentDistance / start.distance;
				const nextScale = Math.min(Math.max(start.scale * ratio, MIN_SCALE), MAX_SCALE);
				const scaleRatio = nextScale / start.scale;
				const midpoint = midpointOf(points[0], points[1]);
				const viewport = getViewportBox(viewportRef.current);
				const centerX = viewport.left + viewport.width / 2;
				const centerY = viewport.top + viewport.height / 2;
				const dx = midpoint.x - centerX;
				const dy = midpoint.y - centerY;
				setState(() =>
					applyClamp({
						scale: nextScale,
						panX: dx * (1 - scaleRatio) + scaleRatio * start.panX,
						panY: dy * (1 - scaleRatio) + scaleRatio * start.panY,
					}),
				);
				return;
			}

			if (points.length >= 1) {
				touchLastRef.current = points[0];
				// Any touch movement swallows the synthesised click that follows.
				suppressClickRef.current = true;

				if (panningRef.current && panStartRef.current) {
					event.preventDefault();
					setPanFromDelta(panStartRef.current, points[0]);
				}
			}
		},
		[applyClamp, setPanFromDelta, viewportRef],
	);

	const handleTouchEnd = useCallback(
		(event: TouchEvent) => {
			if (!enabledRef.current) {
				return;
			}

			const points = getTouchPoints(event);

			// A finger was lifted but at least one remains: re-anchor the gesture.
			if (points.length >= 1) {
				if (pinchingRef.current) {
					pinchingRef.current = false;
					pinchStartRef.current = null;
				}

				const current = stateRef.current;
				touchStartRef.current = points[0];
				touchLastRef.current = points[0];

				if (current.scale > MIN_SCALE) {
					panningRef.current = true;
					panStartRef.current = {
						panX: current.panX,
						panY: current.panY,
						point: points[0],
					};
				} else {
					panningRef.current = false;
					panStartRef.current = null;
				}
				return;
			}

			const wasPinching = pinchingRef.current;
			const wasPanning = panningRef.current;
			pinchingRef.current = false;
			panningRef.current = false;
			panStartRef.current = null;
			pinchStartRef.current = null;

			const start = touchStartRef.current;
			const last = touchLastRef.current;
			touchStartRef.current = null;
			touchLastRef.current = null;

			// While magnified (including after a pinch/pan), never navigate.
			if (wasPinching || wasPanning || stateRef.current.scale > MIN_SCALE) {
				return;
			}

			if (!start || !last) {
				return;
			}

			// Horizontal swipe navigation (matches legacy left/right behaviour).
			if (start.x < last.x) {
				onSwipeRef.current('prev');
			} else if (start.x > last.x) {
				onSwipeRef.current('next');
			}
		},
		[],
	);

	// Attach non-passive wheel/touch listeners via a callback ref so that
	// preventDefault works in browsers and listeners follow the button node
	// across mounts (including empty -> photos transitions).
	const setButtonRef = useCallback(
		(node: HTMLButtonElement | null) => {
			const prev = buttonNodeRef.current;
			if (prev === node) {
				return;
			}

			if (prev) {
				prev.removeEventListener('wheel', handleWheel);
				prev.removeEventListener('touchstart', handleTouchStart);
				prev.removeEventListener('touchmove', handleTouchMove);
				prev.removeEventListener('touchend', handleTouchEnd);
			}

			buttonNodeRef.current = node;

			if (node) {
				node.addEventListener('wheel', handleWheel, { passive: false });
				node.addEventListener('touchstart', handleTouchStart, { passive: false });
				node.addEventListener('touchmove', handleTouchMove, { passive: false });
				node.addEventListener('touchend', handleTouchEnd, { passive: false });
			}
		},
		[handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd],
	);

	const { scale, panX, panY } = state;
	const isMagnified = scale > MIN_SCALE;

	const style = {
		'--rbg-scale': scale,
		'--rbg-zoom-scale': scale,
		'--rbg-photo-scale': scale,
		'--rbg-pan-x': `${panX}px`,
		'--rbg-photo-pan-x': `${panX}px`,
		'--rbg-pan-y': `${panY}px`,
		'--rbg-photo-pan-y': `${panY}px`,
		transform: `translateY(-50%) translate(${panX}px, ${panY}px) scale(${scale})`,
		transformOrigin: 'center center',
	};

	return {
		scale,
		panX,
		panY,
		isMagnified,
		style,
		suppressClickRef,
		buttonRef: setButtonRef,
		onMouseDown,
		reset,
	};
}

export { useZoomPan };
export type { SwipeDirection, UseZoomPanResult };
