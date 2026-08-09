// rule: effect-needs-cleanup
// file-path: src/hooks/use-photo-zoom.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 73875d2bf9f9c981bcb0f81c3f535841e57afa0832c7bf64ab328bff373874b0
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	TouchEvent as ReactTouchEvent,
	Ref,
} from 'react';
import { useCallback, useRef, useState } from 'react';
import { DIRECTION_NEXT, DIRECTION_PREV } from '../constants';

/** Lowest allowed magnification (unmagnified). */
const MIN_SCALE = 1;
/** Highest allowed magnification. */
const MAX_SCALE = 4;
/**
 * Wheel/trackpad zoom sensitivity. Scale is multiplied by
 * `exp(-deltaY * sensitivity)` so scrolling up (negative deltaY) zooms in and
 * the response stays smooth across large mouse-wheel steps and fine trackpad deltas.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
/** Pixels a pointer must travel before a drag counts as a pan (vs. a click). */
const DRAG_ACTIVATION_DISTANCE = 3;

/** Immutable zoom/pan transform state applied to the active photo. */
export interface PhotoZoomState {
	scale: number;
	panX: number;
	panY: number;
}

const IDENTITY: PhotoZoomState = { scale: 1, panX: 0, panY: 0 };

type GestureMode = 'none' | 'swipe' | 'pan' | 'pinch';

/** Transient per-gesture bookkeeping kept in a ref (never triggers renders). */
interface GestureState {
	mode: GestureMode;
	moved: boolean;
	// Swipe navigation (single finger, unmagnified).
	swipeStartX: number;
	swipeCurrentX: number;
	// Drag pan baseline (single finger/mouse while magnified).
	pointerStartX: number;
	pointerStartY: number;
	// Pinch baseline (two fingers).
	pinchStartDistance: number;
	pinchMidClientX: number;
	pinchMidClientY: number;
	// Transform snapshot captured when the gesture began.
	startScale: number;
	startPanX: number;
	startPanY: number;
}

function createGestureState(): GestureState {
	return {
		mode: 'none',
		moved: false,
		swipeStartX: 0,
		swipeCurrentX: 0,
		pointerStartX: 0,
		pointerStartY: 0,
		pinchStartDistance: 0,
		pinchMidClientX: 0,
		pinchMidClientY: 0,
		startScale: 1,
		startPanX: 0,
		startPanY: 0,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Rounds to a fixed number of decimals to keep inline style values tidy. */
function round(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

interface Metrics {
	centerX: number;
	centerY: number;
	viewportWidth: number;
	viewportHeight: number;
	renderedWidth: number;
	renderedHeight: number;
}

/** A minimal touch shape covering both React and native touch points. */
interface TouchPoint {
	clientX: number;
	clientY: number;
	screenX: number;
}

function getTouchPoints(
	event: ReactTouchEvent<HTMLElement>,
): readonly TouchPoint[] {
	const list =
		event.touches && event.touches.length > 0
			? event.touches
			: event.targetTouches;
	const points: TouchPoint[] = [];
	for (let index = 0; index < (list?.length ?? 0); index += 1) {
		const touch = list[index];
		points.push({
			clientX: touch.clientX,
			clientY: touch.clientY,
			screenX: touch.screenX,
		});
	}
	return points;
}

function distanceBetween(a: TouchPoint, b: TouchPoint): number {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Options for {@link usePhotoZoom}.
 */
interface UsePhotoZoomOptions {
	/** When `false` the photo is always presented unmagnified and gestures are ignored. */
	enableZoom: boolean;
	/** Changing this value (e.g. active photo index) synchronously clears magnification. */
	resetKey: string | number;
	/** Invoked when an unmagnified single-finger swipe should change photos. */
	onSwipe?: (direction: string) => void;
}

/** Everything the gallery needs to render and drive the zoom/pan surface. */
interface UsePhotoZoomResult {
	/** Inline CSS custom properties describing the current transform. */
	imageStyle: CSSProperties;
	/** Whether the photo is currently magnified (scale greater than 1). */
	isMagnified: boolean;
	/** Callback ref for the photo viewport element (the pressable surface). */
	setContainer: (node: HTMLElement | null) => void;
	/** Ref for the rendered image element, used to read natural dimensions. */
	imageRef: Ref<HTMLImageElement>;
	onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
	onTouchMove: (event: ReactTouchEvent<HTMLElement>) => void;
	onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => void;
	onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
	/**
	 * Returns `true` when a tap/click should be swallowed instead of navigating,
	 * consuming any one-shot suppression flag left by a gesture.
	 */
	isNavigationSuppressed: () => boolean;
}

/**
 * Encapsulates the gesture-driven zoom and pan behavior for the active photo.
 *
 * Zoom and pan are driven exclusively by wheel, pinch, and drag gestures — there
 * are no on-screen controls. While magnified (or immediately after a pinch/wheel
 * gesture) taps and swipes pan the image instead of navigating between photos.
 * Pan is clamped per axis to the letterboxed image bounds so panning never
 * exposes empty background.
 */
export function usePhotoZoom({
	enableZoom,
	resetKey,
	onSwipe,
}: UsePhotoZoomOptions): UsePhotoZoomResult {
	const [zoom, setZoom] = useState<PhotoZoomState>(IDENTITY);

	// Synchronously clear magnification when the active photo changes or zoom is
	// toggled. Doing this during render (rather than in an effect) guarantees the
	// next paint is already unmagnified — no lingering magnified frame.
	const previousResetKeyRef = useRef(resetKey);
	if (previousResetKeyRef.current !== resetKey) {
		previousResetKeyRef.current = resetKey;
		setZoom(IDENTITY);
	}

	// When zoom is disabled the transform is forced to identity regardless of any
	// retained state, so there is never a delayed effect leaving a magnified frame.
	const effective = enableZoom ? zoom : IDENTITY;
	const isMagnified = effective.scale > MIN_SCALE;

	// Latest-value refs so the stable gesture callbacks avoid stale closures.
	const containerRef = useRef<HTMLElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const stateRef = useRef<PhotoZoomState>(effective);
	const enableZoomRef = useRef(enableZoom);
	const magnifiedRef = useRef(isMagnified);
	const onSwipeRef = useRef<UsePhotoZoomOptions['onSwipe']>(onSwipe);
	const suppressClickRef = useRef(false);
	const gestureRef = useRef<GestureState>(createGestureState());

	stateRef.current = effective;
	enableZoomRef.current = enableZoom;
	magnifiedRef.current = isMagnified;
	onSwipeRef.current = onSwipe;

	/**
	 * Reads the viewport (container) size and the letterboxed image size derived
	 * from the image's natural dimensions. Returns zeroed rendered sizes when a
	 * measurement is unavailable, which naturally clamps pan to `0`.
	 */
	const readMetrics = useCallback((): Metrics => {
		const container = containerRef.current;
		const rect = container?.getBoundingClientRect();
		const viewportWidth = rect?.width ?? 0;
		const viewportHeight = rect?.height ?? 0;
		const centerX = (rect?.left ?? 0) + viewportWidth / 2;
		const centerY = (rect?.top ?? 0) + viewportHeight / 2;

		const image = imageRef.current;
		const naturalWidth = image?.naturalWidth ?? 0;
		const naturalHeight = image?.naturalHeight ?? 0;

		let renderedWidth = 0;
		let renderedHeight = 0;
		if (
			viewportWidth > 0 &&
			viewportHeight > 0 &&
			naturalWidth > 0 &&
			naturalHeight > 0
		) {
			// Aspect-fit ("contain") the natural image inside the viewport.
			const fit = Math.min(
				viewportWidth / naturalWidth,
				viewportHeight / naturalHeight,
			);
			renderedWidth = naturalWidth * fit;
			renderedHeight = naturalHeight * fit;
		}

		return {
			centerX,
			centerY,
			viewportWidth,
			viewportHeight,
			renderedWidth,
			renderedHeight,
		};
	}, []);

	/**
	 * Clamps a pan offset per axis so the magnified, letterboxed image never
	 * reveals empty background. Panning along an axis is only possible when the
	 * magnified image overflows the viewport on that axis.
	 */
	const clampPan = useCallback(
		(scale: number, panX: number, panY: number, metrics: Metrics) => {
			const maxPanX = Math.max(
				0,
				(metrics.renderedWidth * scale - metrics.viewportWidth) / 2,
			);
			const maxPanY = Math.max(
				0,
				(metrics.renderedHeight * scale - metrics.viewportHeight) / 2,
			);
			return {
				panX: clamp(panX, -maxPanX, maxPanX),
				panY: clamp(panY, -maxPanY, maxPanY),
			};
		},
		[],
	);

	/**
	 * Applies a new scale while keeping the point under `(focalClientX,
	 * focalClientY)` fixed, then clamps the resulting pan. Used by both wheel and
	 * pinch zoom so an off-center zoom re-clamps immediately.
	 */
	const applyFocalZoom = useCallback(
		(
			base: PhotoZoomState,
			nextScaleRaw: number,
			focalClientX: number,
			focalClientY: number,
			metrics: Metrics,
		): PhotoZoomState => {
			const nextScale = clamp(nextScaleRaw, MIN_SCALE, MAX_SCALE);
			const focalX = focalClientX - metrics.centerX;
			const focalY = focalClientY - metrics.centerY;
			const ratio = base.scale === 0 ? 1 : nextScale / base.scale;
			const nextPanX = focalX * (1 - ratio) + base.panX * ratio;
			const nextPanY = focalY * (1 - ratio) + base.panY * ratio;
			const clamped = clampPan(nextScale, nextPanX, nextPanY, metrics);
			return { scale: nextScale, panX: clamped.panX, panY: clamped.panY };
		},
		[clampPan],
	);

	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (!enableZoomRef.current) {
				return;
			}
			// Prevent the modal/page from scrolling while zooming.
			event.preventDefault();
			const metrics = readMetrics();
			const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
			suppressClickRef.current = true;
			setZoom((previous) =>
				applyFocalZoom(
					previous,
					previous.scale * factor,
					event.clientX,
					event.clientY,
					metrics,
				),
			);
		},
		[applyFocalZoom, readMetrics],
	);

	// Attach the wheel listener natively so `preventDefault` works (React binds
	// wheel passively). The callback ref keeps a single stable subscription.
	const setContainer = useCallback(
		(node: HTMLElement | null) => {
			const previous = containerRef.current;
			if (previous) {
				previous.removeEventListener('wheel', handleWheel);
			}
			containerRef.current = node;
			if (node) {
				node.addEventListener('wheel', handleWheel, { passive: false });
			}
		},
		[handleWheel],
	);

	const onTouchStart = useCallback((event: ReactTouchEvent<HTMLElement>) => {
		const points = getTouchPoints(event);
		const gesture = createGestureState();

		if (enableZoomRef.current && points.length >= 2) {
			const base = stateRef.current;
			gesture.mode = 'pinch';
			gesture.pinchStartDistance = distanceBetween(points[0], points[1]) || 1;
			gesture.pinchMidClientX = (points[0].clientX + points[1].clientX) / 2;
			gesture.pinchMidClientY = (points[0].clientY + points[1].clientY) / 2;
			gesture.startScale = base.scale;
			gesture.startPanX = base.panX;
			gesture.startPanY = base.panY;
			// A pinch never navigates; also swallow the trailing synthetic click.
			suppressClickRef.current = true;
			gestureRef.current = gesture;
			return;
		}

		const primary = points[0];
		if (enableZoomRef.current && magnifiedRef.current) {
			const base = stateRef.current;
			gesture.mode = 'pan';
			gesture.pointerStartX = primary?.clientX ?? 0;
			gesture.pointerStartY = primary?.clientY ?? 0;
			gesture.startPanX = base.panX;
			gesture.startPanY = base.panY;
			gestureRef.current = gesture;
			return;
		}

		// Unmagnified single-finger touch: eligible for swipe navigation.
		gesture.mode = 'swipe';
		gesture.swipeStartX = primary?.screenX ?? 0;
		gesture.swipeCurrentX = primary?.screenX ?? 0;
		suppressClickRef.current = false;
		gestureRef.current = gesture;
	}, []);

	const onTouchMove = useCallback(
		(event: ReactTouchEvent<HTMLElement>) => {
			const gesture = gestureRef.current;
			const points = getTouchPoints(event);

			if (gesture.mode === 'pinch') {
				if (points.length < 2) {
					return;
				}
				const distance =
					distanceBetween(points[0], points[1]) || gesture.pinchStartDistance;
				const metrics = readMetrics();
				const ratio = distance / gesture.pinchStartDistance;
				suppressClickRef.current = true;
				gesture.moved = true;
				setZoom(() =>
					applyFocalZoom(
						{
							scale: gesture.startScale,
							panX: gesture.startPanX,
							panY: gesture.startPanY,
						},
						gesture.startScale * ratio,
						gesture.pinchMidClientX,
						gesture.pinchMidClientY,
						metrics,
					),
				);
				return;
			}

			if (gesture.mode === 'pan') {
				const primary = points[0];
				if (!primary) {
					return;
				}
				const deltaX = primary.clientX - gesture.pointerStartX;
				const deltaY = primary.clientY - gesture.pointerStartY;
				gesture.moved = true;
				const metrics = readMetrics();
				suppressClickRef.current = true;
				setZoom((previous) => {
					const clamped = clampPan(
						previous.scale,
						gesture.startPanX + deltaX,
						gesture.startPanY + deltaY,
						metrics,
					);
					return { ...previous, panX: clamped.panX, panY: clamped.panY };
				});
				return;
			}

			if (gesture.mode === 'swipe') {
				const primary = points[0];
				gesture.moved = true;
				if (primary) {
					gesture.swipeCurrentX = primary.screenX;
				}
			}
		},
		[applyFocalZoom, clampPan, readMetrics],
	);

	const onTouchEnd = useCallback((_event: ReactTouchEvent<HTMLElement>) => {
		const gesture = gestureRef.current;
		gestureRef.current = createGestureState();

		if (gesture.mode === 'swipe') {
			if (gesture.moved && gesture.swipeStartX !== gesture.swipeCurrentX) {
				const direction =
					gesture.swipeStartX < gesture.swipeCurrentX
						? DIRECTION_PREV
						: DIRECTION_NEXT;
				onSwipeRef.current?.(direction);
			}
			return;
		}

		// Pinch/pan gestures never navigate; block the click they may synthesize.
		if (gesture.mode === 'pinch' || (gesture.mode === 'pan' && gesture.moved)) {
			suppressClickRef.current = true;
		}
	}, []);

	const onMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			if (!(enableZoomRef.current && magnifiedRef.current)) {
				return;
			}
			// Begin a drag-pan; suppress native image drag / text selection.
			event.preventDefault();
			const startX = event.clientX;
			const startY = event.clientY;
			const base = stateRef.current;
			const startPanX = base.panX;
			const startPanY = base.panY;
			let moved = false;

			const handleMove = (moveEvent: MouseEvent) => {
				const deltaX = moveEvent.clientX - startX;
				const deltaY = moveEvent.clientY - startY;
				if (
					Math.abs(deltaX) > DRAG_ACTIVATION_DISTANCE ||
					Math.abs(deltaY) > DRAG_ACTIVATION_DISTANCE
				) {
					moved = true;
				}
				const metrics = readMetrics();
				setZoom((previous) => {
					const clamped = clampPan(
						previous.scale,
						startPanX + deltaX,
						startPanY + deltaY,
						metrics,
					);
					return { ...previous, panX: clamped.panX, panY: clamped.panY };
				});
			};

			const handleUp = () => {
				window.removeEventListener('mousemove', handleMove);
				window.removeEventListener('mouseup', handleUp);
				if (moved) {
					suppressClickRef.current = true;
				}
			};

			window.addEventListener('mousemove', handleMove);
			window.addEventListener('mouseup', handleUp);
		},
		[clampPan, readMetrics],
	);

	const isNavigationSuppressed = useCallback(() => {
		const suppressed = suppressClickRef.current || magnifiedRef.current;
		suppressClickRef.current = false;
		return suppressed;
	}, []);

	const scaleValue = String(round(effective.scale, 4));
	const panXValue = `${round(effective.panX, 2)}px`;
	const panYValue = `${round(effective.panY, 2)}px`;

	// Expose the transform through inline CSS custom properties. Every supported
	// alias is set so the value is available regardless of which token the CSS or
	// a consumer reads. The properties are always present, including on first
	// paint and while unmagnified (scale `1`, pan `0px`).
	const imageStyle = {
		'--rbg-zoom-scale': scaleValue,
		'--rbg-photo-scale': scaleValue,
		'--rbg-scale': scaleValue,
		'--rbg-pan-x': panXValue,
		'--rbg-pan-y': panYValue,
		'--rbg-photo-pan-x': panXValue,
		'--rbg-photo-pan-y': panYValue,
	} as CSSProperties;

	return {
		imageStyle,
		isMagnified,
		setContainer,
		imageRef,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		onMouseDown,
		isNavigationSuppressed,
	};
}
