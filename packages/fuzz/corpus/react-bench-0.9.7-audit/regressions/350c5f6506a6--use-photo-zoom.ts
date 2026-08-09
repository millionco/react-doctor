// rule: effect-needs-cleanup
// file-path: src/hooks/use-photo-zoom.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 350c5f6506a6f3271eeb88e73054130858d0311cca7d05310bcd48ce4ea22491
import type {
	MouseEvent as ReactMouseEvent,
	TouchEvent as ReactTouchEvent,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	MAX_ZOOM_SCALE,
	MIN_ZOOM_SCALE,
	WHEEL_ZOOM_SENSITIVITY,
	ZOOM_PRESS_MOVE_THRESHOLD,
} from '../constants';

/**
 * Current zoom transform for the active photo. `panX`/`panY` are the
 * screen-space offsets of the rendered image center from the viewport center.
 */
interface ZoomTransform {
	scale: number;
	panX: number;
	panY: number;
}

/** Minimal touch shape used by the gesture handlers (mock-friendly). */
interface TouchLike {
	clientX: number;
	clientY: number;
}

/** In-flight gesture bookkeeping (kept in a ref, never re-renders). */
interface GestureState {
	type: 'none' | 'pan' | 'pinch';
	startX: number;
	startY: number;
	basePanX: number;
	basePanY: number;
	baseScale: number;
	baseDistance: number;
	baseMidX: number;
	baseMidY: number;
}

interface UsePhotoZoomOptions {
	/** Whether zoom gestures are enabled at all. */
	enabled: boolean;
	/** Identity of the active photo; magnification resets when it changes. */
	resetKey: string;
}

/** Gesture handlers and state exposed to the gallery. */
interface PhotoZoomApi {
	scale: number;
	panX: number;
	panY: number;
	isMagnified: boolean;
	/** Callback ref for the photo viewport (attaches the wheel listener). */
	setViewport: (node: HTMLElement | null) => void;
	/** Each returns `true` when the event was consumed by a zoom gesture. */
	onTouchStart: (event: ReactTouchEvent<Element>) => boolean;
	onTouchMove: (event: ReactTouchEvent<Element>) => boolean;
	onTouchEnd: (event: ReactTouchEvent<Element>) => boolean;
	onMouseDown: (event: ReactMouseEvent<Element>) => void;
	/** Whether an activation press should be ignored (magnified or gesturing). */
	shouldSuppressPress: () => boolean;
}

const IDENTITY_TRANSFORM: ZoomTransform = { scale: 1, panX: 0, panY: 0 };

function createIdleGesture(): GestureState {
	return {
		type: 'none',
		startX: 0,
		startY: 0,
		basePanX: 0,
		basePanY: 0,
		baseScale: 1,
		baseDistance: 0,
		baseMidX: 0,
		baseMidY: 0,
	};
}

function clampValue(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, precision: number): number {
	const factor = 10 ** precision;
	return Math.round(value * factor) / factor;
}

/**
 * Returns the touches involved in a touch event, tolerating test
 * environments that only populate `targetTouches`.
 */
function getEventTouches(
	event: ReactTouchEvent<Element>,
): ArrayLike<TouchLike> {
	const targetTouches = event.targetTouches as ArrayLike<TouchLike> | undefined;
	if (targetTouches && targetTouches.length > 0) {
		return targetTouches;
	}
	return (event.touches as ArrayLike<TouchLike> | undefined) ?? [];
}

function getTouchDistance(a: TouchLike, b: TouchLike): number {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Wheel/pinch/drag zoom-and-pan state for the active gallery photo.
 *
 * The pan offset is clamped per axis to the letterboxed (aspect-fit) bounds
 * of the rendered image so panning never exposes empty background: an axis
 * can only pan when the magnified image overflows the viewport on that axis.
 *
 * Magnification resets synchronously (render-time, no delayed effect) when
 * `resetKey` changes or `enabled` is turned off.
 */
function usePhotoZoom({
	enabled,
	resetKey,
}: UsePhotoZoomOptions): PhotoZoomApi {
	const [transform, setTransform] = useState<ZoomTransform>(IDENTITY_TRANSFORM);
	const [resetMarker, setResetMarker] = useState({ enabled, resetKey });

	const transformRef = useRef<ZoomTransform>(transform);
	const gestureRef = useRef<GestureState>(createIdleGesture());
	const suppressPressRef = useRef(false);
	const viewportRef = useRef<HTMLElement | null>(null);
	const detachMousePanRef = useRef<(() => void) | null>(null);
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	// Reset synchronously during render so a disabled or photo-changed frame
	// never paints magnified.
	if (resetMarker.enabled !== enabled || resetMarker.resetKey !== resetKey) {
		setResetMarker({ enabled, resetKey });
		transformRef.current = IDENTITY_TRANSFORM;
		gestureRef.current = createIdleGesture();
		suppressPressRef.current = false;
		setTransform(IDENTITY_TRANSFORM);
	}

	const commitTransform = useCallback((next: ZoomTransform) => {
		const rounded: ZoomTransform = {
			scale: roundTo(next.scale, 4),
			panX: roundTo(next.panX, 2),
			panY: roundTo(next.panY, 2),
		};
		transformRef.current = rounded;
		setTransform((previous) => {
			if (
				previous.scale === rounded.scale &&
				previous.panX === rounded.panX &&
				previous.panY === rounded.panY
			) {
				return previous;
			}
			return rounded;
		});
	}, []);

	/**
	 * Clamps the pan offset so the image never reveals background: per axis,
	 * at most `max(0, (renderedSize × scale − viewportSize) / 2)`, where the
	 * rendered size is the aspect-fit size of the image inside the viewport.
	 */
	const clampToBounds = useCallback((next: ZoomTransform): ZoomTransform => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return { scale: next.scale, panX: 0, panY: 0 };
		}

		const rect = viewport.getBoundingClientRect();
		const image = viewport.querySelector('img');
		let renderedWidth = rect.width;
		let renderedHeight = rect.height;
		const naturalWidth = image?.naturalWidth ?? 0;
		const naturalHeight = image?.naturalHeight ?? 0;
		if (
			naturalWidth > 0 &&
			naturalHeight > 0 &&
			rect.width > 0 &&
			rect.height > 0
		) {
			const fitRatio = Math.min(
				rect.width / naturalWidth,
				rect.height / naturalHeight,
			);
			renderedWidth = naturalWidth * fitRatio;
			renderedHeight = naturalHeight * fitRatio;
		}

		const maxPanX = Math.max(0, (renderedWidth * next.scale - rect.width) / 2);
		const maxPanY = Math.max(
			0,
			(renderedHeight * next.scale - rect.height) / 2,
		);

		return {
			scale: next.scale,
			panX: clampValue(next.panX, -maxPanX, maxPanX),
			panY: clampValue(next.panY, -maxPanY, maxPanY),
		};
	}, []);

	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (!enabledRef.current) {
				return;
			}

			const viewport = viewportRef.current;
			if (!viewport) {
				return;
			}

			event.preventDefault();

			const current = transformRef.current;
			const nextScale = clampValue(
				current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
				MIN_ZOOM_SCALE,
				MAX_ZOOM_SCALE,
			);
			if (nextScale === current.scale) {
				return;
			}

			// Focal zoom: keep the image point under the cursor stationary.
			const rect = viewport.getBoundingClientRect();
			const focalX = event.clientX - rect.left - rect.width / 2;
			const focalY = event.clientY - rect.top - rect.height / 2;
			const ratio = nextScale / current.scale;

			commitTransform(
				clampToBounds({
					scale: nextScale,
					panX: focalX - (focalX - current.panX) * ratio,
					panY: focalY - (focalY - current.panY) * ratio,
				}),
			);
		},
		[clampToBounds, commitTransform],
	);

	const setViewport = useCallback(
		(node: HTMLElement | null) => {
			const previous = viewportRef.current;
			if (previous === node) {
				return;
			}
			previous?.removeEventListener('wheel', handleWheel);
			viewportRef.current = node;
			// Native non-passive listener: React attaches wheel passively, which
			// would forbid preventDefault().
			node?.addEventListener('wheel', handleWheel, { passive: false });
		},
		[handleWheel],
	);

	const onTouchStart = useCallback(
		(event: ReactTouchEvent<Element>): boolean => {
			if (!enabledRef.current) {
				return false;
			}

			const touches = getEventTouches(event);
			const current = transformRef.current;

			if (touches.length >= 2) {
				const [first, second] = [touches[0], touches[1]];
				gestureRef.current = {
					type: 'pinch',
					startX: 0,
					startY: 0,
					basePanX: current.panX,
					basePanY: current.panY,
					baseScale: current.scale,
					baseDistance: getTouchDistance(first, second),
					baseMidX: (first.clientX + second.clientX) / 2,
					baseMidY: (first.clientY + second.clientY) / 2,
				};
				suppressPressRef.current = true;
				return true;
			}

			if (current.scale > 1 && touches.length === 1) {
				const touch = touches[0];
				gestureRef.current = {
					...createIdleGesture(),
					type: 'pan',
					startX: touch.clientX,
					startY: touch.clientY,
					basePanX: current.panX,
					basePanY: current.panY,
					baseScale: current.scale,
				};
				return true;
			}

			gestureRef.current = createIdleGesture();
			return false;
		},
		[],
	);

	const onTouchMove = useCallback(
		(event: ReactTouchEvent<Element>): boolean => {
			const gesture = gestureRef.current;
			if (!enabledRef.current || gesture.type === 'none') {
				return false;
			}

			const touches = getEventTouches(event);

			if (gesture.type === 'pinch') {
				if (touches.length >= 2 && gesture.baseDistance > 0) {
					const [first, second] = [touches[0], touches[1]];
					const nextScale = clampValue(
						(gesture.baseScale * getTouchDistance(first, second)) /
							gesture.baseDistance,
						MIN_ZOOM_SCALE,
						MAX_ZOOM_SCALE,
					);

					// Focal pinch: pin the image point under the initial midpoint to
					// the current midpoint (zoom + two-finger pan combined).
					const rect = viewportRef.current?.getBoundingClientRect();
					const centerX = rect ? rect.left + rect.width / 2 : 0;
					const centerY = rect ? rect.top + rect.height / 2 : 0;
					const midX = (first.clientX + second.clientX) / 2 - centerX;
					const midY = (first.clientY + second.clientY) / 2 - centerY;
					const baseMidX = gesture.baseMidX - centerX;
					const baseMidY = gesture.baseMidY - centerY;
					const ratio = nextScale / gesture.baseScale;

					commitTransform(
						clampToBounds({
							scale: nextScale,
							panX: midX - (baseMidX - gesture.basePanX) * ratio,
							panY: midY - (baseMidY - gesture.basePanY) * ratio,
						}),
					);
					suppressPressRef.current = true;
				}
				return true;
			}

			// Pan gesture (single finger while magnified).
			const touch = touches[0];
			if (touch) {
				const deltaX = touch.clientX - gesture.startX;
				const deltaY = touch.clientY - gesture.startY;
				if (
					Math.abs(deltaX) > ZOOM_PRESS_MOVE_THRESHOLD ||
					Math.abs(deltaY) > ZOOM_PRESS_MOVE_THRESHOLD
				) {
					suppressPressRef.current = true;
				}
				commitTransform(
					clampToBounds({
						scale: transformRef.current.scale,
						panX: gesture.basePanX + deltaX,
						panY: gesture.basePanY + deltaY,
					}),
				);
			}
			return true;
		},
		[clampToBounds, commitTransform],
	);

	const onTouchEnd = useCallback((event: ReactTouchEvent<Element>): boolean => {
		const gesture = gestureRef.current;
		if (!enabledRef.current || gesture.type === 'none') {
			return false;
		}

		suppressPressRef.current = true;

		const remaining = getEventTouches(event);
		if (remaining.length >= 2) {
			return true;
		}

		if (remaining.length === 1 && transformRef.current.scale > 1) {
			// One finger lifted after a pinch: continue as a pan gesture.
			const touch = remaining[0];
			gestureRef.current = {
				...createIdleGesture(),
				type: 'pan',
				startX: touch.clientX,
				startY: touch.clientY,
				basePanX: transformRef.current.panX,
				basePanY: transformRef.current.panY,
				baseScale: transformRef.current.scale,
			};
			return true;
		}

		gestureRef.current = createIdleGesture();
		return true;
	}, []);

	const onMouseDown = useCallback(
		(event: ReactMouseEvent<Element>) => {
			if (!enabledRef.current || event.button !== 0) {
				return;
			}
			if (transformRef.current.scale <= 1) {
				return;
			}

			event.preventDefault();

			const start = {
				x: event.clientX,
				y: event.clientY,
				panX: transformRef.current.panX,
				panY: transformRef.current.panY,
			};

			const handleMove = (moveEvent: MouseEvent) => {
				const deltaX = moveEvent.clientX - start.x;
				const deltaY = moveEvent.clientY - start.y;
				if (
					Math.abs(deltaX) > ZOOM_PRESS_MOVE_THRESHOLD ||
					Math.abs(deltaY) > ZOOM_PRESS_MOVE_THRESHOLD
				) {
					suppressPressRef.current = true;
				}
				commitTransform(
					clampToBounds({
						scale: transformRef.current.scale,
						panX: start.panX + deltaX,
						panY: start.panY + deltaY,
					}),
				);
			};

			const detach = () => {
				window.removeEventListener('mousemove', handleMove);
				window.removeEventListener('mouseup', detach);
				detachMousePanRef.current = null;
			};

			detachMousePanRef.current?.();
			detachMousePanRef.current = detach;
			window.addEventListener('mousemove', handleMove);
			window.addEventListener('mouseup', detach);
		},
		[clampToBounds, commitTransform],
	);

	useEffect(() => () => detachMousePanRef.current?.(), []);

	const shouldSuppressPress = useCallback((): boolean => {
		if (!enabledRef.current) {
			return false;
		}
		if (transformRef.current.scale > 1) {
			return true;
		}
		if (suppressPressRef.current) {
			suppressPressRef.current = false;
			return true;
		}
		return false;
	}, []);

	const effective = enabled ? transform : IDENTITY_TRANSFORM;

	return {
		scale: effective.scale,
		panX: effective.panX,
		panY: effective.panY,
		isMagnified: effective.scale > 1,
		setViewport,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		onMouseDown,
		shouldSuppressPress,
	};
}

export { usePhotoZoom };
export type { PhotoZoomApi, UsePhotoZoomOptions };
