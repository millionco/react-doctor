// rule: effect-needs-cleanup
// file-path: src/hooks/use-photo-zoom.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit b55b3105b5c8eebcd8c193cb2b03a6e1ad7db590a39a8aedaf0ce636e1b148b7
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	PAN_CLICK_THRESHOLD,
	POINTER_TYPE_TOUCH,
	TRACKPAD_ZOOM_INTENSITY,
	WHEEL_ZOOM_INTENSITY,
} from '../constants';
import type {
	PhotoZoomStyle,
	ZoomBounds,
	ZoomTransform,
} from '../utils/zoom';
import {
	clampZoomScale,
	clampZoomTransform,
	constrainRenderedSize,
	getPhotoZoomStyle,
	getRenderedPhotoSize,
	IDENTITY_ZOOM_TRANSFORM,
	isZoomed,
	zoomAroundPoint,
} from '../utils/zoom';

/** `WheelEvent.deltaMode` values, normalized to pixels before zooming. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** Approximate pixel size of one line/page of wheel delta. */
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 100;
/** Number of touches that turns a touch gesture into a pinch. */
const PINCH_TOUCHES = 2;

/** A point in client coordinates. */
interface Point {
	x: number;
	y: number;
}

/**
 * Coordinates carried by a touch. Engines and test environments do not all
 * populate the same set, so every reader falls back through them.
 */
interface TouchCoordinates {
	clientX?: number;
	clientY?: number;
	pageX?: number;
	pageY?: number;
	screenX?: number;
	screenY?: number;
}

/** Gesture currently driving the photo, if any. */
interface Gesture {
	kind: 'none' | 'drag' | 'pinch';
	/** Input driving the gesture; mouse drags are tracked on the window. */
	pointer: 'mouse' | 'touch';
	/** Where the gesture started, in client coordinates. */
	origin: Point;
	/** Transform when the gesture started; deltas are applied to it. */
	originTransform: ZoomTransform;
	/** Distance between the pinching touches when the gesture started. */
	originDistance: number;
	/** Whether the gesture moved the photo, which swallows the trailing click. */
	moved: boolean;
}

/** Photo viewport measurement, including its centre when layout is available. */
interface ViewportMeasurement {
	size: { width: number; height: number };
	/** Viewport centre in client coordinates, or `null` when unmeasurable. */
	center: Point | null;
}

/** Options accepted by {@link usePhotoZoom}. */
interface UsePhotoZoomOptions {
	/** Whether zoom gestures are available. */
	enabled?: boolean;
	/**
	 * Identity of the active photo. Magnification is cleared as soon as it
	 * changes, so a new photo is never shown zoomed or panned.
	 */
	resetKey: string;
}

/** Gesture-driven zoom state for the active photo. */
interface PhotoZoom {
	/** Ref for the photo viewport that receives zoom and pan gestures. */
	viewportRef: (element: HTMLDivElement | null) => void;
	/** Ref for the photo image; its natural size bounds the pannable area. */
	imageRef: RefObject<HTMLImageElement | null>;
	/** Whether the photo is currently magnified. */
	isMagnified: boolean;
	/** Inline custom properties exposing the current scale and pan. */
	style: PhotoZoomStyle;
	/**
	 * Whether a zoom gesture owns the interaction. Clicks and swipes must not
	 * navigate while it is `true`.
	 */
	isNavigationSuppressed: () => boolean;
}

/** State kept for one photo while zoom stays enabled. */
interface ZoomSession {
	key: string;
	enabled: boolean;
	transform: ZoomTransform;
}

/** A fresh idle gesture; gestures are mutated in place, so they are never shared. */
function createIdleGesture(): Gesture {
	return {
		kind: 'none',
		pointer: 'mouse',
		origin: { x: 0, y: 0 },
		originTransform: IDENTITY_ZOOM_TRANSFORM,
		originDistance: 0,
		moved: false,
	};
}

/** Reads a point from a touch or mouse event, whichever coordinates it carries. */
function getPoint(source: TouchCoordinates | MouseEvent): Point {
	return {
		x: source.clientX ?? source.pageX ?? source.screenX ?? 0,
		y: source.clientY ?? source.pageY ?? source.screenY ?? 0,
	};
}

function toPoints(
	touches: ArrayLike<TouchCoordinates> | null | undefined,
): TouchCoordinates[] {
	return touches ? Array.from(touches) : [];
}

/**
 * Touches driving the gesture. `touches` covers every finger on screen, which is
 * what pinches need; the other lists are fallbacks for engines and test
 * environments that only populate one of them.
 */
function getGestureTouches(event: TouchEvent): TouchCoordinates[] {
	if (event.touches?.length) {
		return toPoints(event.touches as ArrayLike<TouchCoordinates>);
	}

	if (event.targetTouches?.length) {
		return toPoints(event.targetTouches as ArrayLike<TouchCoordinates>);
	}

	return toPoints(event.changedTouches as ArrayLike<TouchCoordinates>);
}

/**
 * Touches still on screen once one has been lifted. `changedTouches` is never
 * consulted here: it holds the touches that just ended.
 */
function getRemainingTouches(event: TouchEvent): TouchCoordinates[] {
	if (event.touches?.length) {
		return toPoints(event.touches as ArrayLike<TouchCoordinates>);
	}

	return toPoints(event.targetTouches as ArrayLike<TouchCoordinates>);
}

function getDistance(from: Point, to: Point): number {
	return Math.hypot(to.x - from.x, to.y - from.y);
}

function getMidpoint(from: Point, to: Point): Point {
	return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/** Normalizes a wheel delta to pixels regardless of the reported delta mode. */
function getWheelDelta(event: WheelEvent): number {
	const delta = event.deltaY || 0;

	if (event.deltaMode === DOM_DELTA_LINE) {
		return delta * LINE_HEIGHT_PX;
	}

	if (event.deltaMode === DOM_DELTA_PAGE) {
		return delta * PAGE_HEIGHT_PX;
	}

	return delta;
}

function measureElement(element: HTMLElement): ViewportMeasurement | null {
	const rect = element.getBoundingClientRect();

	if (rect.width > 0 && rect.height > 0) {
		return {
			size: { width: rect.width, height: rect.height },
			center: {
				x: rect.left + rect.width / 2,
				y: rect.top + rect.height / 2,
			},
		};
	}

	const width = element.clientWidth || element.offsetWidth;
	const height = element.clientHeight || element.offsetHeight;

	if (width > 0 && height > 0) {
		return { size: { width, height }, center: null };
	}

	return null;
}

/**
 * Measures the photo viewport. Every wrapper between the image and the photo
 * frame covers the same box, so the closest ancestor reporting a size measures
 * the viewport. Environments without layout report zero-sized boxes; the window
 * is the last resort so pan bounds stay resolvable.
 */
function measureViewport(
	image: HTMLImageElement | null,
	frame: HTMLElement,
): ViewportMeasurement {
	let element: HTMLElement | null = image?.parentElement ?? frame;

	while (element) {
		const measurement = measureElement(element);

		if (measurement) {
			return measurement;
		}

		element = element.parentElement;
	}

	return {
		size: { width: window.innerWidth, height: window.innerHeight },
		center: null,
	};
}

/** Viewport and letterboxed photo size that bound panning. */
function getZoomBounds(
	image: HTMLImageElement | null,
	frame: HTMLElement,
): ZoomBounds & { center: Point | null } {
	const { size: viewport, center } = measureViewport(image, frame);
	const rendered = constrainRenderedSize(
		getRenderedPhotoSize(
			{ width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 },
			viewport,
		),
		// Offset sizes describe the untransformed layout box, so they stay correct
		// while the photo is magnified.
		{ width: image?.offsetWidth ?? 0, height: image?.offsetHeight ?? 0 },
	);

	return { viewport, rendered, center };
}

/**
 * Drives zoom and pan on the active photo from wheel, pinch, and drag gestures.
 *
 * The transform is published as inline custom properties instead of a composed
 * `transform`, so the stylesheet keeps ownership of how the photo is positioned.
 */
export function usePhotoZoom({
	enabled = true,
	resetKey,
}: UsePhotoZoomOptions): PhotoZoom {
	const imageRef = useRef<HTMLImageElement | null>(null);
	const [frame, setFrame] = useState<HTMLDivElement | null>(null);
	const viewportRef = useCallback((element: HTMLDivElement | null) => {
		setFrame(element);
	}, []);

	const [session, setSession] = useState<ZoomSession>(() => ({
		key: resetKey,
		enabled,
		transform: IDENTITY_ZOOM_TRANSFORM,
	}));

	// Reset while rendering rather than from an effect: an effect lands a frame
	// late, painting the next photo — or a gallery with zoom turned off — still
	// magnified.
	const isSessionStale =
		session.key !== resetKey || session.enabled !== enabled;

	if (isSessionStale) {
		setSession({ key: resetKey, enabled, transform: IDENTITY_ZOOM_TRANSFORM });
	}

	const transform =
		enabled && !isSessionStale ? session.transform : IDENTITY_ZOOM_TRANSFORM;
	const transformRef = useRef(transform);
	transformRef.current = transform;

	const gestureRef = useRef<Gesture>(createIdleGesture());
	const suppressClickRef = useRef(false);

	const applyTransform = useCallback((next: ZoomTransform) => {
		const current = transformRef.current;

		if (
			next.scale === current.scale &&
			next.panX === current.panX &&
			next.panY === current.panY
		) {
			return;
		}

		transformRef.current = next;
		setSession((previous) => ({ ...previous, transform: next }));
	}, []);

	// An in-flight gesture never survives a photo change or zoom being disabled.
	useEffect(() => {
		gestureRef.current = createIdleGesture();
		suppressClickRef.current = false;
	}, [enabled, resetKey]);

	useEffect(() => {
		if (!(enabled && frame)) {
			return;
		}

		const getBounds = () => getZoomBounds(imageRef.current, frame);

		const applyClamped = (next: ZoomTransform, bounds = getBounds()) => {
			applyTransform(clampZoomTransform(next, bounds));
		};

		/** Scales towards `focal`, keeping the content under it in place. */
		const zoomTo = (scale: number, focal: Point | null): boolean => {
			const current = transformRef.current;
			const nextScale = clampZoomScale(scale);

			if (nextScale === current.scale) {
				return false;
			}

			const bounds = getBounds();
			// Anchor on the gesture point when layout is measurable, on the centre
			// otherwise.
			const anchor =
				focal && bounds.center
					? { x: focal.x - bounds.center.x, y: focal.y - bounds.center.y }
					: { x: 0, y: 0 };

			applyClamped(
				zoomAroundPoint(current, nextScale, anchor.x, anchor.y),
				bounds,
			);

			return true;
		};

		const startDrag = (pointer: Gesture['pointer'], origin: Point) => {
			gestureRef.current = {
				kind: 'drag',
				pointer,
				origin,
				originTransform: transformRef.current,
				originDistance: 0,
				moved: false,
			};
		};

		const continueDrag = (point: Point) => {
			const gesture = gestureRef.current;
			const deltaX = point.x - gesture.origin.x;
			const deltaY = point.y - gesture.origin.y;

			if (
				Math.abs(deltaX) > PAN_CLICK_THRESHOLD ||
				Math.abs(deltaY) > PAN_CLICK_THRESHOLD
			) {
				gesture.moved = true;
			}

			applyClamped({
				scale: gesture.originTransform.scale,
				panX: gesture.originTransform.panX + deltaX,
				panY: gesture.originTransform.panY + deltaY,
			});
		};

		const endGesture = () => {
			if (gestureRef.current.moved) {
				// Browsers emit a click after a drag or pinch; it belongs to the
				// gesture, not to photo navigation.
				suppressClickRef.current = true;
			}

			gestureRef.current = createIdleGesture();
		};

		/** A fresh press starts a new interaction, so past gestures stop counting. */
		const beginInteraction = () => {
			suppressClickRef.current = false;
		};

		const onWheel = (event: WheelEvent) => {
			const current = transformRef.current;
			const intensity = event.ctrlKey
				? TRACKPAD_ZOOM_INTENSITY
				: WHEEL_ZOOM_INTENSITY;
			const zoomed = zoomTo(
				current.scale * Math.exp(-getWheelDelta(event) * intensity),
				getPoint(event),
			);

			if (zoomed || isZoomed(current)) {
				// Keep the wheel from scrolling the page under the zoom gesture.
				event.preventDefault();
			}
		};

		const onTouchStart = (event: TouchEvent) => {
			const touches = getGestureTouches(event);
			beginInteraction();

			if (touches.length >= PINCH_TOUCHES) {
				const first = getPoint(touches[0]);
				const second = getPoint(touches[1]);

				gestureRef.current = {
					kind: 'pinch',
					pointer: 'touch',
					origin: getMidpoint(first, second),
					originTransform: transformRef.current,
					originDistance: getDistance(first, second),
					// A pinch is never a tap, so it always swallows the trailing click.
					moved: true,
				};
			} else if (touches.length === 1 && isZoomed(transformRef.current)) {
				startDrag('touch', getPoint(touches[0]));
			} else {
				// Nothing to zoom or pan: leave the touch to swipe navigation.
				return;
			}

			// Zoom gestures never reach the swipe handlers, and never scroll the page.
			event.stopPropagation();

			if (event.cancelable) {
				event.preventDefault();
			}
		};

		const onTouchMove = (event: TouchEvent) => {
			const gesture = gestureRef.current;
			const touches = getGestureTouches(event);

			if (gesture.kind === 'pinch' && touches.length >= PINCH_TOUCHES) {
				const first = getPoint(touches[0]);
				const second = getPoint(touches[1]);
				const distance = getDistance(first, second);

				if (gesture.originDistance > 0 && distance > 0) {
					const midpoint = getMidpoint(first, second);
					const bounds = getBounds();
					const anchor = bounds.center
						? {
								x: midpoint.x - bounds.center.x,
								y: midpoint.y - bounds.center.y,
							}
						: { x: 0, y: 0 };
					// The midpoint drags the photo, the spread scales it around itself.
					const panned = {
						scale: gesture.originTransform.scale,
						panX:
							gesture.originTransform.panX + (midpoint.x - gesture.origin.x),
						panY:
							gesture.originTransform.panY + (midpoint.y - gesture.origin.y),
					};

					applyClamped(
						zoomAroundPoint(
							panned,
							clampZoomScale(
								gesture.originTransform.scale *
									(distance / gesture.originDistance),
							),
							anchor.x,
							anchor.y,
						),
						bounds,
					);
				}
			} else if (
				gesture.kind === 'drag' &&
				gesture.pointer === 'touch' &&
				touches.length >= 1
			) {
				continueDrag(getPoint(touches[0]));
			} else {
				return;
			}

			event.stopPropagation();

			if (event.cancelable) {
				event.preventDefault();
			}
		};

		const onTouchEnd = (event: TouchEvent) => {
			if (gestureRef.current.kind === 'none') {
				return;
			}

			event.stopPropagation();
			const touches = getRemainingTouches(event);

			if (
				gestureRef.current.kind === 'pinch' &&
				touches.length >= PINCH_TOUCHES
			) {
				// Fingers left on screen keep the pinch alive.
				return;
			}

			if (touches.length >= 1 && isZoomed(transformRef.current)) {
				// Hand the remaining finger over to panning instead of jumping.
				suppressClickRef.current = true;
				startDrag('touch', getPoint(touches[0]));
				return;
			}

			endGesture();
		};

		const startMouseDrag = (event: MouseEvent) => {
			beginInteraction();

			if (event.button > 0 || !isZoomed(transformRef.current)) {
				return;
			}

			startDrag('mouse', getPoint(event));
			// Stops the native image drag and text selection while panning.
			event.preventDefault();
		};

		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === POINTER_TYPE_TOUCH) {
				// Touches are already handled as pinch or pan gestures.
				return;
			}

			startMouseDrag(event);
		};

		const onMouseDown = (event: MouseEvent) => {
			// Only reached in engines without pointer events; a live drag wins.
			if (gestureRef.current.kind !== 'none') {
				return;
			}

			startMouseDrag(event);
		};

		const onDragMove = (event: MouseEvent) => {
			const gesture = gestureRef.current;

			if (gesture.kind !== 'drag' || gesture.pointer !== 'mouse') {
				return;
			}

			continueDrag(getPoint(event));
		};

		const onDragEnd = () => {
			const gesture = gestureRef.current;

			if (gesture.kind === 'drag' && gesture.pointer === 'mouse') {
				endGesture();
			}
		};

		const onResize = () => {
			if (isZoomed(transformRef.current)) {
				// A smaller viewport shrinks the pannable area.
				applyClamped(transformRef.current);
			}
		};

		const cleanups: Array<() => void> = [];
		const listen = (
			target: EventTarget,
			type: string,
			listener: EventListener,
			options?: AddEventListenerOptions,
		) => {
			target.addEventListener(type, listener, options);
			cleanups.push(() => {
				target.removeEventListener(type, listener, options);
			});
		};

		listen(frame, 'wheel', onWheel as EventListener, { passive: false });
		listen(frame, 'touchstart', onTouchStart as EventListener, {
			passive: false,
		});
		listen(frame, 'touchmove', onTouchMove as EventListener, { passive: false });
		listen(frame, 'touchend', onTouchEnd as EventListener);
		listen(frame, 'touchcancel', onTouchEnd as EventListener);
		listen(frame, 'pointerdown', onPointerDown as EventListener);
		listen(frame, 'mousedown', onMouseDown as EventListener);
		// Drags continue and finish outside the photo.
		listen(window, 'pointermove', onDragMove as EventListener);
		listen(window, 'pointerup', onDragEnd);
		listen(window, 'pointercancel', onDragEnd);
		listen(window, 'mousemove', onDragMove as EventListener);
		listen(window, 'mouseup', onDragEnd);
		listen(window, 'resize', onResize);

		return () => {
			for (const cleanup of cleanups) {
				cleanup();
			}

			gestureRef.current = createIdleGesture();
		};
	}, [applyTransform, enabled, frame]);

	const isNavigationSuppressed = useCallback(
		() =>
			isZoomed(transformRef.current) ||
			gestureRef.current.kind !== 'none' ||
			suppressClickRef.current,
		[],
	);

	const style = useMemo(() => getPhotoZoomStyle(transform), [transform]);

	return useMemo(
		() => ({
			viewportRef,
			imageRef,
			isMagnified: isZoomed(transform),
			style,
			isNavigationSuppressed,
		}),
		[isNavigationSuppressed, style, transform, viewportRef],
	);
}
