// rule: effect-needs-cleanup
// file-path: src/hooks/use-photo-zoom.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 9aadc8e070eb52c67246388e94e8f8476ad5d8dd1a897e72027fd263b518f377
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
	RefObject,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	MAX_ZOOM_SCALE,
	MIN_ZOOM_SCALE,
	WHEEL_DELTA_LINE_PIXELS,
	WHEEL_DELTA_PAGE_PIXELS,
	WHEEL_ZOOM_INTENSITY,
} from '../constants';

/** A point (or offset) in viewport pixel coordinates. */
interface ZoomPoint {
	x: number;
	y: number;
}

/** Committed zoom/pan values for the active photo. */
interface ZoomPanState {
	scale: number;
	panX: number;
	panY: number;
}

/**
 * Minimal coordinate fields read from touch/pointer inputs. Kept loose so the
 * hook accepts native events, React synthetic events, and test-provided
 * objects that only define a subset of the coordinates.
 */
interface InputPointLike {
	clientX?: number;
	clientY?: number;
	screenX?: number;
	screenY?: number;
}

/** A list of touch points (native `TouchList` or plain array in tests). */
interface TouchListLike {
	length: number;
	[index: number]: InputPointLike;
}

/** Touch event shape read defensively across native/synthetic/test events. */
export interface TouchEventLike {
	touches?: TouchListLike;
	targetTouches?: TouchListLike;
	changedTouches?: TouchListLike;
}

/** Tracks an in-flight touch gesture (single-finger pan or pinch). */
interface TouchGesture {
	mode: 'pan' | 'pinch' | null;
	/** True once the gesture involved two fingers, until all fingers lift. */
	pinchOccurred: boolean;
	last: ZoomPoint;
	startDistance: number;
	startScale: number;
	startPan: ZoomPoint;
	startMidpoint: ZoomPoint;
}

/** Tracks an in-flight mouse/pointer pan drag. */
interface DragSession {
	pointerId: number | null;
	last: ZoomPoint;
	cleanup: () => void;
}

interface UsePhotoZoomOptions {
	/** Whether zoom gestures are enabled. When false the photo presents unmagnified. */
	enabled: boolean;
	/** Identity of the active photo; changing it clears magnification. */
	resetKey: string;
}

export interface PhotoZoomController {
	scale: number;
	panX: number;
	panY: number;
	/** True while the photo is zoomed beyond its fitted size. */
	isMagnified: boolean;
	/** Inline CSS custom properties exposing the current scale and pan. */
	imageStyle: CSSProperties;
	/** Ref callback for the photo viewport element (wheel target and clamp bounds). */
	setViewportElement: (element: HTMLElement | null) => void;
	/** Ref for the active photo `<img>` element (natural size for clamp bounds). */
	imageRef: RefObject<HTMLImageElement | null>;
	/** Returns true when the touch event was consumed by a zoom/pan gesture. */
	onTouchStart: (event: TouchEventLike) => boolean;
	onTouchMove: (event: TouchEventLike) => boolean;
	onTouchEnd: (event: TouchEventLike) => boolean;
	onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

const INITIAL_ZOOM_PAN: ZoomPanState = { scale: 1, panX: 0, panY: 0 };
const ZERO_POINT: ZoomPoint = { x: 0, y: 0 };

function createTouchGesture(): TouchGesture {
	return {
		mode: null,
		pinchOccurred: false,
		last: ZERO_POINT,
		startDistance: 1,
		startScale: 1,
		startPan: ZERO_POINT,
		startMidpoint: ZERO_POINT,
	};
}

function isInitialZoomPan(state: ZoomPanState): boolean {
	return state.scale === 1 && state.panX === 0 && state.panY === 0;
}

function clampValue(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, precision: number): number {
	return Math.round(value * precision) / precision;
}

/** Reads x/y from a touch, mouse, or pointer input, tolerating partial objects. */
function getEventPoint(input: InputPointLike | undefined): ZoomPoint {
	if (!input) {
		return ZERO_POINT;
	}
	const x = typeof input.clientX === 'number' ? input.clientX : input.screenX;
	const y = typeof input.clientY === 'number' ? input.clientY : input.screenY;
	return {
		x: typeof x === 'number' ? x : 0,
		y: typeof y === 'number' ? y : 0,
	};
}

/** Returns the touches currently on screen, preferring `touches` over `targetTouches`. */
function getActiveTouches(event: TouchEventLike): InputPointLike[] {
	const source =
		event.touches && event.touches.length > 0
			? event.touches
			: event.targetTouches;
	if (!source) {
		return [];
	}
	const touches: InputPointLike[] = [];
	for (let index = 0; index < source.length; index += 1) {
		touches.push(source[index]);
	}
	return touches;
}

function getDistance(pointA: ZoomPoint, pointB: ZoomPoint): number {
	return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
}

/** Viewport size in CSS pixels, or `null` when layout information is unavailable. */
function readViewportSize(
	element: HTMLElement | null,
): { width: number; height: number } | null {
	if (!element) {
		return null;
	}
	let width = element.clientWidth || 0;
	let height = element.clientHeight || 0;
	if (
		(!width || !height) &&
		typeof element.getBoundingClientRect === 'function'
	) {
		const rect = element.getBoundingClientRect();
		width = width || rect.width || 0;
		height = height || rect.height || 0;
	}
	return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Offset of a client point from the viewport center, or `null` when the
 * viewport has no measurable layout (for example unmocked jsdom).
 */
function getViewportRelativePoint(
	element: HTMLElement | null,
	clientX: number,
	clientY: number,
): ZoomPoint | null {
	if (!element || typeof element.getBoundingClientRect !== 'function') {
		return null;
	}
	const rect = element.getBoundingClientRect();
	if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
		return null;
	}
	return {
		x: clientX - rect.left - rect.width / 2,
		y: clientY - rect.top - rect.height / 2,
	};
}

/**
 * Letterboxed (aspect-fit) size of the photo inside the viewport, computed
 * from its natural dimensions, with the measured layout size as a fallback.
 */
function getRenderedPhotoSize(
	image: HTMLImageElement | null,
	viewport: { width: number; height: number },
): { width: number; height: number } | null {
	if (!image) {
		return null;
	}
	const naturalWidth = image.naturalWidth || 0;
	const naturalHeight = image.naturalHeight || 0;
	if (naturalWidth > 0 && naturalHeight > 0) {
		const fitRatio = Math.min(
			viewport.width / naturalWidth,
			viewport.height / naturalHeight,
		);
		return { width: naturalWidth * fitRatio, height: naturalHeight * fitRatio };
	}
	const offsetWidth = image.offsetWidth || 0;
	const offsetHeight = image.offsetHeight || 0;
	if (offsetWidth > 0 && offsetHeight > 0) {
		return { width: offsetWidth, height: offsetHeight };
	}
	return null;
}

/**
 * Maximum pan offset per axis: `max(0, (renderedSize × scale − viewportSize) / 2)`.
 * Returns `null` when geometry is unavailable and bounds cannot be computed.
 */
function getPanBounds(
	viewportElement: HTMLElement | null,
	imageElement: HTMLImageElement | null,
	scale: number,
): ZoomPoint | null {
	const viewport = readViewportSize(viewportElement);
	if (!viewport) {
		return null;
	}
	const rendered = getRenderedPhotoSize(imageElement, viewport);
	if (!rendered) {
		return null;
	}
	return {
		x: Math.max(0, (rendered.width * scale - viewport.width) / 2),
		y: Math.max(0, (rendered.height * scale - viewport.height) / 2),
	};
}

/**
 * Clamps a candidate zoom/pan state so panning cannot expose background
 * beyond the rendered image bounds. Unmagnified states always reset pan.
 */
function clampZoomPan(
	viewportElement: HTMLElement | null,
	imageElement: HTMLImageElement | null,
	scale: number,
	panX: number,
	panY: number,
): ZoomPanState {
	if (!(scale > MIN_ZOOM_SCALE)) {
		return INITIAL_ZOOM_PAN;
	}
	const bounds = getPanBounds(viewportElement, imageElement, scale);
	if (!bounds) {
		return { scale, panX, panY };
	}
	return {
		scale,
		panX: clampValue(panX, -bounds.x, bounds.x),
		panY: clampValue(panY, -bounds.y, bounds.y),
	};
}

/** Multiplicative zoom factor for a wheel event, normalized across delta modes. */
function getWheelZoomFactor(event: WheelEvent): number {
	const deltaY = typeof event.deltaY === 'number' ? event.deltaY : 0;
	let pixels = deltaY;
	if (event.deltaMode === 1) {
		pixels = deltaY * WHEEL_DELTA_LINE_PIXELS;
	} else if (event.deltaMode === 2) {
		pixels = deltaY * WHEEL_DELTA_PAGE_PIXELS;
	}
	return Math.exp(-pixels * WHEEL_ZOOM_INTENSITY);
}

function isSecondaryButton(button: unknown): boolean {
	return typeof button === 'number' && button !== 0;
}

/**
 * Gesture-driven zoom/pan controller for the active gallery photo.
 *
 * Wheel and pinch gestures adjust the scale about a focal point; dragging
 * (mouse, pointer, or single touch) pans while magnified. Pan offsets are
 * clamped to the rendered letterboxed image bounds on every change. State is
 * cleared synchronously — during render, never in a delayed effect — when the
 * active photo changes or zoom is disabled.
 */
function usePhotoZoom({
	enabled,
	resetKey,
}: UsePhotoZoomOptions): PhotoZoomController {
	const [zoomPan, setZoomPan] = useState<ZoomPanState>(INITIAL_ZOOM_PAN);
	const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
	const [viewportElement, setViewportElementState] =
		useState<HTMLElement | null>(null);

	// Synchronous render-time resets: changing photo or disabling zoom must
	// never paint a magnified frame first.
	if (appliedResetKey !== resetKey) {
		setAppliedResetKey(resetKey);
		if (!isInitialZoomPan(zoomPan)) {
			setZoomPan(INITIAL_ZOOM_PAN);
		}
	}
	if (!enabled && !isInitialZoomPan(zoomPan)) {
		setZoomPan(INITIAL_ZOOM_PAN);
	}

	const effective = enabled ? zoomPan : INITIAL_ZOOM_PAN;
	const isMagnified = effective.scale > MIN_ZOOM_SCALE;

	const viewportRef = useRef<HTMLElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const enabledRef = useRef(enabled);
	const zoomPanRef = useRef(effective);
	const magnifiedRef = useRef(isMagnified);
	const gestureRef = useRef<TouchGesture>(createTouchGesture());
	const dragRef = useRef<DragSession | null>(null);

	enabledRef.current = enabled;
	zoomPanRef.current = effective;
	magnifiedRef.current = isMagnified;

	const setViewportElement = useCallback((element: HTMLElement | null) => {
		viewportRef.current = element;
		setViewportElementState(element);
	}, []);

	const applyPanBy = useCallback((deltaX: number, deltaY: number) => {
		setZoomPan((previous) => {
			if (!(previous.scale > MIN_ZOOM_SCALE)) {
				return previous;
			}
			return clampZoomPan(
				viewportRef.current,
				imageRef.current,
				previous.scale,
				previous.panX + deltaX,
				previous.panY + deltaY,
			);
		});
	}, []);

	// Native non-passive wheel listener: React attaches wheel as passive, which
	// would prevent us from stopping page scroll/zoom while zooming the photo.
	useEffect(() => {
		const element = viewportElement;
		if (!element) {
			return;
		}
		const onWheel = (event: WheelEvent) => {
			if (!enabledRef.current) {
				return;
			}
			event.preventDefault();
			const factor = getWheelZoomFactor(event);
			const point = getEventPoint(event);
			const focal = getViewportRelativePoint(
				viewportRef.current,
				point.x,
				point.y,
			);
			setZoomPan((previous) => {
				const nextScale = clampValue(
					previous.scale * factor,
					MIN_ZOOM_SCALE,
					MAX_ZOOM_SCALE,
				);
				if (nextScale === previous.scale) {
					return previous;
				}
				const anchor = focal || ZERO_POINT;
				const panX =
					anchor.x - ((anchor.x - previous.panX) / previous.scale) * nextScale;
				const panY =
					anchor.y - ((anchor.y - previous.panY) / previous.scale) * nextScale;
				return clampZoomPan(
					viewportRef.current,
					imageRef.current,
					nextScale,
					panX,
					panY,
				);
			});
		};
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			element.removeEventListener('wheel', onWheel);
		};
	}, [viewportElement]);

	const onTouchStart = useCallback((event: TouchEventLike): boolean => {
		if (!enabledRef.current) {
			return false;
		}
		const touches = getActiveTouches(event);
		const gesture = gestureRef.current;
		if (touches.length >= 2) {
			const pointA = getEventPoint(touches[0]);
			const pointB = getEventPoint(touches[1]);
			const midpoint = getViewportRelativePoint(
				viewportRef.current,
				(pointA.x + pointB.x) / 2,
				(pointA.y + pointB.y) / 2,
			);
			const current = zoomPanRef.current;
			gesture.mode = 'pinch';
			gesture.pinchOccurred = true;
			gesture.startDistance = Math.max(getDistance(pointA, pointB), 1);
			gesture.startScale = current.scale;
			gesture.startPan = { x: current.panX, y: current.panY };
			gesture.startMidpoint = midpoint || ZERO_POINT;
			return true;
		}
		if (touches.length === 1) {
			if (magnifiedRef.current) {
				gesture.mode = 'pan';
				gesture.last = getEventPoint(touches[0]);
				return true;
			}
			gesture.mode = null;
			gesture.pinchOccurred = false;
			return false;
		}
		return gesture.pinchOccurred || magnifiedRef.current;
	}, []);

	const onTouchMove = useCallback(
		(event: TouchEventLike): boolean => {
			if (!enabledRef.current) {
				return false;
			}
			const touches = getActiveTouches(event);
			const gesture = gestureRef.current;
			if (gesture.mode === 'pinch' && touches.length >= 2) {
				const pointA = getEventPoint(touches[0]);
				const pointB = getEventPoint(touches[1]);
				const midpoint =
					getViewportRelativePoint(
						viewportRef.current,
						(pointA.x + pointB.x) / 2,
						(pointA.y + pointB.y) / 2,
					) || ZERO_POINT;
				const nextScale = clampValue(
					gesture.startScale *
						(getDistance(pointA, pointB) / gesture.startDistance),
					MIN_ZOOM_SCALE,
					MAX_ZOOM_SCALE,
				);
				const panX =
					midpoint.x -
					((gesture.startMidpoint.x - gesture.startPan.x) /
						gesture.startScale) *
						nextScale;
				const panY =
					midpoint.y -
					((gesture.startMidpoint.y - gesture.startPan.y) /
						gesture.startScale) *
						nextScale;
				setZoomPan(
					clampZoomPan(
						viewportRef.current,
						imageRef.current,
						nextScale,
						panX,
						panY,
					),
				);
				return true;
			}
			if (gesture.mode === 'pan' && touches.length >= 1) {
				const point = getEventPoint(touches[0]);
				const deltaX = point.x - gesture.last.x;
				const deltaY = point.y - gesture.last.y;
				gesture.last = point;
				if (deltaX !== 0 || deltaY !== 0) {
					applyPanBy(deltaX, deltaY);
				}
				return true;
			}
			return gesture.pinchOccurred || magnifiedRef.current;
		},
		[applyPanBy],
	);

	const onTouchEnd = useCallback((event: TouchEventLike): boolean => {
		if (!enabledRef.current) {
			return false;
		}
		const gesture = gestureRef.current;
		const consumed =
			gesture.pinchOccurred || gesture.mode !== null || magnifiedRef.current;
		const touches = getActiveTouches(event);
		if (touches.length === 0) {
			gesture.mode = null;
			gesture.pinchOccurred = false;
		} else if (touches.length === 1) {
			if (magnifiedRef.current) {
				// Pinch collapsed to one finger: continue as a pan from here.
				gesture.mode = 'pan';
				gesture.last = getEventPoint(touches[0]);
			} else {
				gesture.mode = null;
			}
		}
		return consumed;
	}, []);

	const beginDrag = useCallback(
		(
			pointerId: number | null,
			startPoint: ZoomPoint,
			kind: 'mouse' | 'pointer',
		) => {
			if (dragRef.current) {
				return;
			}
			const drag: DragSession = {
				pointerId,
				last: startPoint,
				cleanup: () => undefined,
			};
			const handleMove = (event: MouseEvent) => {
				if (dragRef.current !== drag) {
					return;
				}
				if (drag.pointerId !== null) {
					const eventPointerId = (event as PointerEvent).pointerId;
					if (
						typeof eventPointerId === 'number' &&
						eventPointerId !== drag.pointerId
					) {
						return;
					}
				}
				const point = getEventPoint(event);
				const deltaX = point.x - drag.last.x;
				const deltaY = point.y - drag.last.y;
				drag.last = point;
				if (deltaX !== 0 || deltaY !== 0) {
					applyPanBy(deltaX, deltaY);
				}
			};
			const handleEnd = () => {
				if (dragRef.current === drag) {
					drag.cleanup();
					dragRef.current = null;
				}
			};
			const moveEvent = kind === 'pointer' ? 'pointermove' : 'mousemove';
			const endEvent = kind === 'pointer' ? 'pointerup' : 'mouseup';
			window.addEventListener(moveEvent, handleMove);
			window.addEventListener(endEvent, handleEnd);
			if (kind === 'pointer') {
				window.addEventListener('pointercancel', handleEnd);
			}
			drag.cleanup = () => {
				window.removeEventListener(moveEvent, handleMove);
				window.removeEventListener(endEvent, handleEnd);
				if (kind === 'pointer') {
					window.removeEventListener('pointercancel', handleEnd);
				}
			};
			dragRef.current = drag;
		},
		[applyPanBy],
	);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if (!(enabledRef.current && magnifiedRef.current)) {
				return;
			}
			if (isSecondaryButton(event.button) || dragRef.current) {
				return;
			}
			const pointerId =
				typeof event.pointerId === 'number' ? event.pointerId : null;
			beginDrag(pointerId, getEventPoint(event), 'pointer');
			event.preventDefault?.();
		},
		[beginDrag],
	);

	const onMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			if (!(enabledRef.current && magnifiedRef.current)) {
				return;
			}
			// Skip when a pointer-event drag already handles this press.
			if (isSecondaryButton(event.button) || dragRef.current) {
				return;
			}
			beginDrag(null, getEventPoint(event), 'mouse');
			event.preventDefault?.();
		},
		[beginDrag],
	);

	const cancelDrag = useCallback(() => {
		const drag = dragRef.current;
		if (drag) {
			drag.cleanup();
			dragRef.current = null;
		}
	}, []);

	// A photo change or disable invalidates any in-flight gesture.
	const activeGestureKeyRef = useRef(resetKey);
	useEffect(() => {
		if (activeGestureKeyRef.current !== resetKey || !enabled) {
			activeGestureKeyRef.current = resetKey;
			cancelDrag();
			gestureRef.current = createTouchGesture();
		}
	}, [resetKey, enabled, cancelDrag]);

	// Never leak window drag listeners past unmount.
	useEffect(() => cancelDrag, [cancelDrag]);

	const imageStyle = useMemo(() => {
		const scaleValue = String(roundTo(effective.scale, 10_000));
		const panXValue = `${roundTo(effective.panX, 100)}px`;
		const panYValue = `${roundTo(effective.panY, 100)}px`;
		return {
			'--rbg-zoom-scale': scaleValue,
			'--rbg-pan-x': panXValue,
			'--rbg-pan-y': panYValue,
		} as CSSProperties;
	}, [effective.scale, effective.panX, effective.panY]);

	return {
		scale: effective.scale,
		panX: effective.panX,
		panY: effective.panY,
		isMagnified,
		imageStyle,
		setViewportElement,
		imageRef,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		onMouseDown,
		onPointerDown,
	};
}

export { usePhotoZoom };
