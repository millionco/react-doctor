// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 84526bd3eb455ef485e6afd6ec80058905faa7ca80e643f326a68930a633936d
import type { CSSProperties, MouseEvent, TouchEvent, WheelEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	clampZoomPanState,
	getLetterboxedSize,
	getNextScale,
	INITIAL_ZOOM_PAN_STATE,
	isMagnifiedState,
	panBy,
	zoomAtPoint,
} from './zoom-pan';
import type { NaturalSize, ViewportSize, ZoomPanState } from './zoom-pan';

/** Distance (px) a drag must travel before the trailing click is suppressed. */
const CLICK_DRAG_THRESHOLD_PX = 5;

/**
 * Tracks an in-flight pinch gesture between the two active touch points.
 */
interface PinchGestureState {
	initialDistance: number;
	initialScale: number;
}

/**
 * Tracks an in-flight one-finger / mouse pan gesture.
 */
interface PanGestureState {
	lastX: number;
	lastY: number;
	moved: boolean;
}

interface SizeState {
	viewport: ViewportSize;
	natural: NaturalSize;
}

/**
 * Reads the viewport size from the gesture surface element. Falls back to
 * `1×1` when the element has no laid-out size (for example in jsdom) so zoom
 * remains testable; in that degenerate case every pan clamp resolves to `0`.
 */
function readViewportSize(element: HTMLElement | null): ViewportSize {
	if (!element) {
		return { width: 1, height: 1 };
	}

	const rect = element.getBoundingClientRect();
	const width = rect.width || element.clientWidth || element.offsetWidth || 1;
	const height =
		rect.height || element.clientHeight || element.offsetHeight || 1;

	return { width, height };
}

/**
 * Reads the natural image dimensions. `0×0` means "unknown", in which case
 * the letterbox math falls back to the viewport size.
 */
function readNaturalSize(image: HTMLImageElement | null): NaturalSize {
	if (!image) {
		return { width: 0, height: 0 };
	}

	return {
		width: image.naturalWidth || 0,
		height: image.naturalHeight || 0,
	};
}

/**
 * Normalizes the touch list of a React touch event into plain points.
 */
function getTouchPoints(event: TouchEvent): Array<{ x: number; y: number }> {
	const touches = event.targetTouches;
	const points: Array<{ x: number; y: number }> = [];

	for (let index = 0; index < touches.length; index += 1) {
		const touch = touches[index];
		if (touch) {
			points.push({ x: touch.clientX, y: touch.clientY });
		}
	}

	return points;
}

interface UseZoomPanOptions {
	/** Whether wheel/pinch/drag zooming is enabled. */
	enabled: boolean;
	/**
	 * Reset token: any change (active photo, zoom disabled, …) restores the
	 * unmagnified state during render, so no magnified frame is ever painted.
	 */
	resetKey: unknown;
}

/**
 * Gesture-driven zoom/pan state machine for the active lightbox photo.
 *
 * - Wheel zooms around the cursor, pinch zooms around the touch centroid.
 * - Dragging (mouse or single finger) pans while magnified.
 * - Pan is clamped to the letterboxed image bounds on every update.
 * - Click/swipe navigation is suppressed whenever the photo is magnified,
 *   after a pinch, and after a panning drag.
 */
export function useZoomPan({ enabled, resetKey }: UseZoomPanOptions) {
	const viewportRef = useRef<HTMLButtonElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);

	const [state, setState] = useState<ZoomPanState>(INITIAL_ZOOM_PAN_STATE);
	const [sizes, setSizes] = useState<SizeState>({
		viewport: { width: 1, height: 1 },
		natural: { width: 0, height: 0 },
	});
	// Mirrors `state` for use inside gesture handlers without stale closures.
	const stateRef = useRef<ZoomPanState>(INITIAL_ZOOM_PAN_STATE);
	const pinchRef = useRef<PinchGestureState | null>(null);
	const panGestureRef = useRef<PanGestureState | null>(null);
	// Set while any navigation-suppressing condition is active.
	const suppressClickRef = useRef(false);

	// Synchronous reset (during render) when the active photo changes or zoom
	// is turned off, so the magnified state never survives into an effect.
	const [lastResetKey, setLastResetKey] = useState(resetKey);
	if (resetKey !== lastResetKey) {
		setLastResetKey(resetKey);
		setState(INITIAL_ZOOM_PAN_STATE);
		stateRef.current = INITIAL_ZOOM_PAN_STATE;
		suppressClickRef.current = false;
		pinchRef.current = null;
		panGestureRef.current = null;
	}

	// Keep the mutable ref in sync with committed state updates.
	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const magnified = isMagnifiedState(state);

	// While magnified, every click must be swallowed — React synthetic clicks
	// are read before native capture listeners (which use `stopPropagation`,
	// never reaching React's root delegated listener).
	useEffect(() => {
		if (magnified) {
			suppressClickRef.current = true;
		}
	}, [magnified]);

	// Measure the viewport and re-clamp the pan when the layout size changes.
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) {
			return;
		}

		const measure = () => {
			const viewport = readViewportSize(element);
			setSizes((prev) =>
				prev.viewport.width === viewport.width &&
				prev.viewport.height === viewport.height
					? prev
					: { ...prev, viewport },
			);
		};

		measure();

		if (typeof ResizeObserver === 'undefined') {
			return;
		}

		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, []);

	const renderedSize = useMemo(
		() =>
			getLetterboxedSize(
				sizes.viewport.width,
				sizes.viewport.height,
				sizes.natural.width,
				sizes.natural.height,
			),
		[sizes],
	);

	// Latest gesture inputs, kept in a ref so the gesture handlers below keep
	// stable identities across renders (consumers memoize against them).
	// Synced during render so handlers always see the current bounds.
	const gesturesRef = useRef({ enabled, renderedSize, viewport: sizes.viewport });
	gesturesRef.current = { enabled, renderedSize, viewport: sizes.viewport };

	/**
	 * Reads fresh bounds from the DOM (viewport size, natural dimensions) and
	 * updates both the ref and state, so gesture handlers always clamp against
	 * current measurements even when they changed after the last render.
	 */
	const measureNow = useCallback(() => {
		const viewport = readViewportSize(viewportRef.current);
		const natural = readNaturalSize(imageRef.current);
		const rendered = getLetterboxedSize(
			viewport.width,
			viewport.height,
			natural.width,
			natural.height,
		);
		gesturesRef.current = { enabled: gesturesRef.current.enabled, renderedSize: rendered, viewport };
		setSizes((prev) =>
			prev.viewport.width === viewport.width &&
			prev.viewport.height === viewport.height &&
			prev.natural.width === natural.width &&
			prev.natural.height === natural.height
				? prev
				: { viewport, natural },
		);
		return { renderedSize: rendered, viewport };
	}, []);

	// Re-clamp the pan whenever the measured bounds or scale change, so the
	// image can never rest exposing empty background.
	useEffect(() => {
		setState((prev) => {
			const next = clampZoomPanState(prev, renderedSize, sizes.viewport);
			if (next.pan.x === prev.pan.x && next.pan.y === prev.pan.y) {
				return prev;
			}
			stateRef.current = next;
			return next;
		});
	}, [renderedSize, sizes.viewport]);

	const getViewportPoint = useCallback((clientX: number, clientY: number) => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!rect) {
			return { x: 0, y: 0 };
		}

		return { x: clientX - rect.left, y: clientY - rect.top };
	}, []);

	const startPanGesture = useCallback((x: number, y: number) => {
		panGestureRef.current = { lastX: x, lastY: y, moved: false };
	}, []);

	const movePanGesture = useCallback((x: number, y: number) => {
		const gesture = panGestureRef.current;
		if (!gesture || !isMagnifiedState(stateRef.current)) {
			return;
		}

		const deltaX = x - gesture.lastX;
		const deltaY = y - gesture.lastY;
		if (deltaX === 0 && deltaY === 0) {
			return;
		}

		gesture.lastX = x;
		gesture.lastY = y;
		if (
			Math.abs(deltaX) >= CLICK_DRAG_THRESHOLD_PX ||
			Math.abs(deltaY) >= CLICK_DRAG_THRESHOLD_PX
		) {
			gesture.moved = true;
		}

		const { renderedSize: bounds, viewport } = measureNow();
		setState((prev) => {
			const next = panBy(prev, deltaX, deltaY, bounds, viewport);
			stateRef.current = next;
			return next;
		});
	}, [measureNow]);

	const endPanGesture = useCallback(() => {
		const gesture = panGestureRef.current;
		panGestureRef.current = null;
		// A real panning drag must swallow the trailing click so it does not
		// navigate to the next photo.
		if (gesture?.moved) {
			suppressClickRef.current = true;
		}
	}, []);

	const handleWheel = useCallback(
		(event: WheelEvent<HTMLButtonElement>) => {
			if (!gesturesRef.current.enabled) {
				return;
			}

			const delta = event.deltaY ?? 0;
			if (delta === 0) {
				return;
			}

			event.preventDefault();
			// Wheel zoom must suppress the click/swipe that can follow it.
			suppressClickRef.current = true;
			const { renderedSize: bounds, viewport } = measureNow();
			const point = getViewportPoint(event.clientX ?? 0, event.clientY ?? 0);
			setState((prev) => {
				const next = zoomAtPoint(
					prev,
					getNextScale(prev.scale, -delta),
					point,
					bounds,
					viewport,
				);
				stateRef.current = next;
				return next;
			});
		},
		[getViewportPoint, measureNow],
	);

	const handleMouseDown = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			if (!gesturesRef.current.enabled || event.button !== 0) {
				return;
			}
			if (!isMagnifiedState(stateRef.current)) {
				return;
			}

			event.preventDefault();
			startPanGesture(event.clientX, event.clientY);
		},
		[startPanGesture],
	);

	const handleMouseMove = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			movePanGesture(event.clientX, event.clientY);
		},
		[movePanGesture],
	);

	const handleMouseUp = useCallback(() => {
		endPanGesture();
	}, [endPanGesture]);

	const handleTouchStart = useCallback(
		(event: TouchEvent<HTMLButtonElement>) => {
			if (!gesturesRef.current.enabled) {
				return;
			}

			const points = getTouchPoints(event);
			if (points.length >= 2) {
				const [first, second] = points;
				const distance = Math.hypot(second.x - first.x, second.y - first.y);
				pinchRef.current = {
					initialDistance: distance || 1,
					initialScale: stateRef.current.scale,
				};
				panGestureRef.current = null;
				// Pinch zoom must suppress the click/swipe that can follow it.
				suppressClickRef.current = true;
			}
		},
		[],
	);

	const handleTouchMove = useCallback(
		(event: TouchEvent<HTMLButtonElement>) => {
			if (!gesturesRef.current.enabled) {
				return;
			}

			const points = getTouchPoints(event);
			if (points.length >= 2) {
				const [first, second] = points;
				const pinch = pinchRef.current ?? {
					initialDistance: 1,
					initialScale: stateRef.current.scale,
				};
				pinchRef.current = pinch;
				suppressClickRef.current = true;

				const distance = Math.hypot(second.x - first.x, second.y - first.y);
				const center = getViewportPoint(
					(first.x + second.x) / 2,
					(first.y + second.y) / 2,
				);
				const { renderedSize: bounds, viewport } = measureNow();
				setState((prev) => {
					const next = zoomAtPoint(
						prev,
						pinch.initialScale * (distance / pinch.initialDistance),
						center,
						bounds,
						viewport,
					);
					stateRef.current = next;
					return next;
				});
				return;
			}

			if (points.length === 1 && isMagnifiedState(stateRef.current)) {
				if (!panGestureRef.current) {
					startPanGesture(points[0].x, points[0].y);
				}
				movePanGesture(points[0].x, points[0].y);
			}
		},
		[getViewportPoint, measureNow, startPanGesture, movePanGesture],
	);

	const handleTouchEnd = useCallback(
		(event: TouchEvent<HTMLButtonElement>) => {
			if (event.targetTouches.length < 2) {
				pinchRef.current = null;
			}
			if (event.targetTouches.length === 0) {
				endPanGesture();
			}
		},
		[endPanGesture],
	);

	/**
	 * Native capture-phase click swallow. React attaches delegated listeners at
	 * the root container, so `stopPropagation` here prevents synthetic `onClick`
	 * handlers (photo navigation) from ever firing while suppressed.
	 *
	 * After a click has been swallowed, the suppression is released on the next
	 * task (unless the photo is still magnified), so later intentional clicks
	 * navigate again once the photo is back to its unmagnified state.
	 */
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) {
			return;
		}

		const swallowClick = (event: Event) => {
			if (!suppressClickRef.current) {
				return;
			}
			event.stopPropagation();
			event.preventDefault();
			setTimeout(() => {
				suppressClickRef.current = isMagnifiedState(stateRef.current);
			}, 0);
		};

		element.addEventListener('click', swallowClick, true);
		return () => {
			element.removeEventListener('click', swallowClick, true);
		};
	}, []);

	// Records natural dimensions so letterboxed pan bounds can be computed.
	const handleImageLoad = useCallback(() => {
		const natural = readNaturalSize(imageRef.current);
		setSizes((prev) =>
			prev.natural.width === natural.width &&
			prev.natural.height === natural.height
				? prev
				: { ...prev, natural },
		);
	}, []);

	const setViewportRef = useCallback((node: HTMLButtonElement | null) => {
		viewportRef.current = node;
	}, []);

	const setImageRef = useCallback(
		(node: HTMLImageElement | null) => {
			imageRef.current = node;
			if (node?.complete && (node.naturalWidth || 0) > 0) {
				handleImageLoad();
			}
		},
		[handleImageLoad],
	);

	// Keep the zoom/pan custom properties present even when unmagnified
	// (scale `1`, pan `0px`), including on first paint.
	const imageStyle = useMemo(
		() =>
			({
				'--rbg-zoom-scale': String(state.scale),
				'--rbg-pan-x': `${state.pan.x}px`,
				'--rbg-pan-y': `${state.pan.y}px`,
				transform: `translateY(-50%) translate3d(${state.pan.x}px, ${state.pan.y}px, 0) scale(${state.scale})`,
				transformOrigin: '50% 50%',
				willChange: 'transform',
				touchAction: magnified ? 'none' : 'pan-y',
				cursor: magnified ? 'grab' : undefined,
			}) as CSSProperties,
		[state, magnified],
	);

	return {
		setViewportRef,
		setImageRef,
		handleImageLoad,
		handleWheel,
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
		handleTouchStart,
		handleTouchMove,
		handleTouchEnd,
		imageStyle,
		magnified,
		scale: state.scale,
		pan: state.pan,
	};
}
