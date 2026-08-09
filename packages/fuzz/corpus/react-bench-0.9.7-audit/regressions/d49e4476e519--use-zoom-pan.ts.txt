// rule: effect-needs-cleanup
// file-path: src/hooks/use-zoom-pan.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit d49e4476e5194438f37b15c4312560bc08bfaf2df81c5e1f39c5b9ee57ad94ed
import type { CSSProperties, MouseEvent, TouchEvent, TouchList } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Size, ZoomTransform } from '../utils/zoom';
import {
	clampScale,
	clampZoomTransform,
	DRAG_ACTIVATION_DISTANCE,
	IDENTITY_ZOOM_TRANSFORM,
	isIdentityZoomTransform,
	MIN_ZOOM_SCALE,
	WHEEL_ZOOM_SENSITIVITY,
	zoomAtPoint,
} from '../utils/zoom';

interface Point {
	x: number;
	y: number;
}

interface DragState {
	startX: number;
	startY: number;
	startPanX: number;
	startPanY: number;
	moved: boolean;
}

interface PinchState {
	startDistance: number;
	startScale: number;
	startFocal: Point;
	startPanX: number;
	startPanY: number;
}

/** Touch list shape shared by React synthetic and native touch events. */
type AnyTouchList = TouchList | Partial<Touch>[];

interface UseZoomPanOptions {
	/** Whether gesture driven zoom/pan is available. */
	enabled: boolean;
	/** Changing this value clears magnification (used for the active photo). */
	resetKey: string;
	/** Called for a plain, non-gesture press on the photo. */
	onPress?: () => void;
	/** Swipe handlers, only forwarded while the photo is not being zoomed. */
	onSwipeStart?: (event: TouchEvent<HTMLElement>) => void;
	onSwipeMove?: (event: TouchEvent<HTMLElement>) => void;
	onSwipeEnd?: (event: TouchEvent<HTMLElement>) => void;
}

const EMPTY_SIZE: Size = { width: 0, height: 0 };

function measureElement(element: HTMLElement | null): Size {
	if (!element) {
		return EMPTY_SIZE;
	}

	const rect = element.getBoundingClientRect?.();

	return {
		width: Math.max(rect?.width || 0, element.clientWidth || 0),
		height: Math.max(rect?.height || 0, element.clientHeight || 0),
	};
}

function measureNaturalSize(image: HTMLImageElement | null): Size {
	if (!image) {
		return EMPTY_SIZE;
	}

	return {
		width: image.naturalWidth || image.width || 0,
		height: image.naturalHeight || image.height || 0,
	};
}

function getViewportCenter(element: HTMLElement | null): Point | null {
	const rect = element?.getBoundingClientRect?.();

	if (!rect || !(rect.width > 0 && rect.height > 0)) {
		return null;
	}

	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Focal point relative to the viewport centre, or the centre when unknown. */
function getFocalOffset(
	element: HTMLElement | null,
	clientX: number,
	clientY: number,
): Point {
	const center = getViewportCenter(element);

	if (!center || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
		return { x: 0, y: 0 };
	}

	return { x: clientX - center.x, y: clientY - center.y };
}

function getTouchPoints(event: {
	touches?: AnyTouchList | null;
	targetTouches?: AnyTouchList | null;
}): Point[] {
	const list = event.touches?.length ? event.touches : event.targetTouches;

	if (!list) {
		return [];
	}

	return Array.from(list as ArrayLike<Partial<Touch>>).map(getTouchPoint);
}

function firstFinite(...values: Array<number | undefined>): number {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}

	return 0;
}

/** Reads a touch position, tolerating partially populated touch objects. */
function getTouchPoint(touch: {
	clientX?: number;
	clientY?: number;
	pageX?: number;
	pageY?: number;
	screenX?: number;
	screenY?: number;
}): Point {
	return {
		x: firstFinite(touch.clientX, touch.pageX, touch.screenX),
		y: firstFinite(touch.clientY, touch.pageY, touch.screenY),
	};
}

function getTouchDistance(first: Point, second: Point): number {
	return Math.hypot(second.x - first.x, second.y - first.y);
}

/**
 * Gesture driven zoom and pan state for the active photo.
 *
 * Zoom comes from wheel/trackpad and pinch gestures, pan from dragging while
 * magnified. Pan offsets are clamped to the rendered (letterboxed) image bounds
 * so panning never exposes empty background, and navigation gestures (click and
 * swipe) are suppressed while the photo is magnified.
 */
export function useZoomPan({
	enabled,
	resetKey,
	onPress,
	onSwipeStart,
	onSwipeMove,
	onSwipeEnd,
}: UseZoomPanOptions) {
	const [transform, setTransform] = useState<ZoomTransform>(
		IDENTITY_ZOOM_TRANSFORM,
	);
	const [dragging, setDragging] = useState(false);

	const transformRef = useRef<ZoomTransform>(IDENTITY_ZOOM_TRANSFORM);
	const resetKeyRef = useRef(resetKey);
	const suppressNavigationRef = useRef(false);
	const dragRef = useRef<DragState | null>(null);
	const pinchRef = useRef<PinchState | null>(null);
	const forwardTouchRef = useRef(true);

	const containerRef = useRef<HTMLElement | null>(null);
	const viewportRef = useRef<HTMLElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);

	// Clear magnification synchronously (no effect, so no magnified frame is
	// ever painted) when zoom is turned off or the active photo changes.
	const resetKeyChanged = resetKeyRef.current !== resetKey;

	if (resetKeyChanged) {
		resetKeyRef.current = resetKey;
	}

	const needsReset =
		(resetKeyChanged || !enabled) &&
		!isIdentityZoomTransform(transformRef.current);

	if (needsReset) {
		transformRef.current = IDENTITY_ZOOM_TRANSFORM;
		dragRef.current = null;
		pinchRef.current = null;
		suppressNavigationRef.current = false;
		setTransform(IDENTITY_ZOOM_TRANSFORM);
	}

	const active = needsReset || !enabled ? IDENTITY_ZOOM_TRANSFORM : transform;
	const isMagnified = active.scale > MIN_ZOOM_SCALE;

	const applyTransform = useCallback((next: ZoomTransform) => {
		const clamped = clampZoomTransform(
			next,
			measureElement(viewportRef.current || containerRef.current),
			measureNaturalSize(imageRef.current),
		);

		transformRef.current = clamped;
		setTransform(clamped);
	}, []);

	const zoomBy = useCallback(
		(factor: number, clientX: number, clientY: number) => {
			const current = transformRef.current;
			const nextScale = clampScale(current.scale * factor);

			if (nextScale === current.scale) {
				return false;
			}

			const focal = getFocalOffset(
				viewportRef.current || containerRef.current,
				clientX,
				clientY,
			);

			applyTransform(zoomAtPoint(current, nextScale, focal.x, focal.y));
			return true;
		},
		[applyTransform],
	);

	// Wheel/trackpad zoom needs a non-passive listener to keep the page from
	// scrolling, which React's synthetic `onWheel` cannot provide.
	useEffect(() => {
		const node = containerRef.current;

		if (!(enabled && node)) {
			return;
		}

		// Zooming is offered across the whole photo area, and a single wheel event
		// can reach more than one of those nodes, so events are handled once.
		const nodes = [node, node.closest('.gallery-photos')].filter(
			(candidate, index, all): candidate is Element =>
				Boolean(candidate) && all.indexOf(candidate) === index,
		);
		const handledWheelEvents = new WeakSet<WheelEvent>();

		const handleWheel = (event: WheelEvent) => {
			if (event.deltaY === 0 || handledWheelEvents.has(event)) {
				return;
			}

			handledWheelEvents.add(event);

			if (event.cancelable) {
				event.preventDefault();
			}

			// A wheel gesture never produces a click, so navigation suppression is
			// covered by the magnified check in the click handler.
			zoomBy(
				Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
				event.clientX,
				event.clientY,
			);
		};

		const listener = handleWheel as EventListener;

		for (const target of nodes) {
			target.addEventListener('wheel', listener, { passive: false });
		}

		return () => {
			for (const target of nodes) {
				target.removeEventListener('wheel', listener);
			}
		};
	}, [enabled, zoomBy]);

	// Keep the browser from scrolling/pinching the page during our own gestures.
	useEffect(() => {
		const node = containerRef.current;

		if (!(enabled && node)) {
			return;
		}

		const handleTouchMove = (event: globalThis.TouchEvent) => {
			if ((pinchRef.current || dragRef.current) && event.cancelable) {
				event.preventDefault();
			}
		};

		node.addEventListener('touchmove', handleTouchMove, { passive: false });

		return () => {
			node.removeEventListener('touchmove', handleTouchMove);
		};
	}, [enabled]);

	const beginDrag = useCallback((clientX: number, clientY: number) => {
		const current = transformRef.current;

		if (current.scale <= MIN_ZOOM_SCALE) {
			return false;
		}

		dragRef.current = {
			startX: clientX,
			startY: clientY,
			startPanX: current.panX,
			startPanY: current.panY,
			moved: false,
		};

		return true;
	}, []);

	const updateDrag = useCallback(
		(clientX: number, clientY: number) => {
			const drag = dragRef.current;

			if (!drag) {
				return;
			}

			const deltaX = clientX - drag.startX;
			const deltaY = clientY - drag.startY;

			if (
				!drag.moved &&
				Math.hypot(deltaX, deltaY) >= DRAG_ACTIVATION_DISTANCE
			) {
				drag.moved = true;
				suppressNavigationRef.current = true;
			}

			applyTransform({
				scale: transformRef.current.scale,
				panX: drag.startPanX + deltaX,
				panY: drag.startPanY + deltaY,
			});
		},
		[applyTransform],
	);

	const endDrag = useCallback(() => {
		if (dragRef.current?.moved) {
			suppressNavigationRef.current = true;
		}

		dragRef.current = null;
	}, []);

	// Pointer/mouse drag panning is tracked on the window so the gesture keeps
	// working when the cursor leaves the photo.
	useEffect(() => {
		if (!dragging) {
			return;
		}

		const handleMove = (event: globalThis.MouseEvent) => {
			updateDrag(event.clientX, event.clientY);
		};

		const handleUp = () => {
			endDrag();
			setDragging(false);
		};

		window.addEventListener('pointermove', handleMove);
		window.addEventListener('pointerup', handleUp);
		window.addEventListener('pointercancel', handleUp);
		window.addEventListener('mousemove', handleMove);
		window.addEventListener('mouseup', handleUp);

		return () => {
			window.removeEventListener('pointermove', handleMove);
			window.removeEventListener('pointerup', handleUp);
			window.removeEventListener('pointercancel', handleUp);
			window.removeEventListener('mousemove', handleMove);
			window.removeEventListener('mouseup', handleUp);
		};
	}, [dragging, endDrag, updateDrag]);

	const onPointerDown = useCallback(
		(event: MouseEvent<HTMLElement> & { pointerType?: string }) => {
			if (!enabled || event.pointerType === 'touch' || event.button > 0) {
				return;
			}

			if (beginDrag(event.clientX, event.clientY)) {
				setDragging(true);
			}
		},
		[beginDrag, enabled],
	);

	const onClick = useCallback(() => {
		if (suppressNavigationRef.current) {
			suppressNavigationRef.current = false;
			return;
		}

		if (enabled && transformRef.current.scale > MIN_ZOOM_SCALE) {
			return;
		}

		onPress?.();
	}, [enabled, onPress]);

	const startPinch = useCallback((touches: Point[]) => {
		const current = transformRef.current;
		const [first, second] = touches;
		const distance = getTouchDistance(first, second);

		if (distance <= 0) {
			return;
		}

		const focal = getFocalOffset(
			viewportRef.current || containerRef.current,
			(first.x + second.x) / 2,
			(first.y + second.y) / 2,
		);

		pinchRef.current = {
			startDistance: distance,
			startScale: current.scale,
			startFocal: focal,
			startPanX: current.panX,
			startPanY: current.panY,
		};
		dragRef.current = null;
		// A pinch is never a navigation gesture, even if it ends unmagnified.
		suppressNavigationRef.current = true;
	}, []);

	const updatePinch = useCallback(
		(touches: Point[]) => {
			const pinch = pinchRef.current;

			if (!pinch) {
				return;
			}

			const [first, second] = touches;
			const distance = getTouchDistance(first, second);

			if (distance <= 0) {
				return;
			}

			const nextScale = clampScale(
				pinch.startScale * (distance / pinch.startDistance),
			);
			const focal = getFocalOffset(
				viewportRef.current || containerRef.current,
				(first.x + second.x) / 2,
				(first.y + second.y) / 2,
			);
			const ratio = nextScale / pinch.startScale;

			applyTransform({
				scale: nextScale,
				panX: focal.x - (pinch.startFocal.x - pinch.startPanX) * ratio,
				panY: focal.y - (pinch.startFocal.y - pinch.startPanY) * ratio,
			});
		},
		[applyTransform],
	);

	const onTouchStart = useCallback(
		(event: TouchEvent<HTMLElement>) => {
			const touches = getTouchPoints(event);

			if (enabled && touches.length >= 2) {
				forwardTouchRef.current = false;
				startPinch(touches);
				return;
			}

			if (
				enabled &&
				touches.length === 1 &&
				transformRef.current.scale > MIN_ZOOM_SCALE
			) {
				forwardTouchRef.current = false;
				beginDrag(touches[0].x, touches[0].y);
				return;
			}

			forwardTouchRef.current = true;
			onSwipeStart?.(event);
		},
		[beginDrag, enabled, onSwipeStart, startPinch],
	);

	const onTouchMove = useCallback(
		(event: TouchEvent<HTMLElement>) => {
			const touches = getTouchPoints(event);

			if (enabled && touches.length >= 2) {
				forwardTouchRef.current = false;

				if (!pinchRef.current) {
					startPinch(touches);
				}

				updatePinch(touches);
				return;
			}

			if (enabled && dragRef.current && touches.length === 1) {
				updateDrag(touches[0].x, touches[0].y);
				return;
			}

			if (forwardTouchRef.current) {
				onSwipeMove?.(event);
			}
		},
		[enabled, onSwipeMove, startPinch, updateDrag, updatePinch],
	);

	const onTouchEnd = useCallback(
		(event: TouchEvent<HTMLElement>) => {
			const remaining = getTouchPoints(event);

			if (pinchRef.current) {
				pinchRef.current = null;
				suppressNavigationRef.current = true;

				if (remaining.length === 1) {
					beginDrag(remaining[0].x, remaining[0].y);
				}

				return;
			}

			if (dragRef.current) {
				endDrag();
				return;
			}

			if (forwardTouchRef.current) {
				onSwipeEnd?.(event);
			}
		},
		[beginDrag, endDrag, onSwipeEnd],
	);

	const imageStyle = {
		'--rbg-zoom-scale': `${active.scale}`,
		'--rbg-pan-x': `${active.panX}px`,
		'--rbg-pan-y': `${active.panY}px`,
		transform: `translate(${active.panX}px, calc(-50% + ${active.panY}px)) scale(${active.scale})`,
	} as CSSProperties;

	// Callback refs so the hook stays element-type agnostic for consumers.
	const setContainerRef = useCallback((node: HTMLElement | null) => {
		containerRef.current = node;
	}, []);

	const setViewportRef = useCallback((node: HTMLElement | null) => {
		viewportRef.current = node;
	}, []);

	const setImageRef = useCallback((node: HTMLImageElement | null) => {
		imageRef.current = node;
	}, []);

	return {
		setContainerRef,
		setViewportRef,
		setImageRef,
		isMagnified,
		transform: active,
		imageStyle,
		handlers: {
			onClick,
			onPointerDown,
			onMouseDown: onPointerDown,
			onTouchStart,
			onTouchMove,
			onTouchEnd,
		},
	};
}
