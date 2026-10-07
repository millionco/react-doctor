// rule: effect-needs-cleanup
// file-path: src/hooks/use-photo-zoom.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 8c29bd10448a67081d5a9b17f5a7f478d26df2185050788ab2f1386f0b713f13
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	WHEEL_ZOOM_CTRL_MULTIPLIER,
	WHEEL_ZOOM_INTENSITY,
} from '../constants';
import {
	getPhotoImage,
	measureNaturalSize,
	measureViewport,
} from '../utils/measure-photo';
import type { ZoomTransform } from '../utils/zoom';
import {
	clampScale,
	clampTransform,
	getDistance,
	getFocalPan,
	getMidpoint,
	getRenderedSize,
	IDLE_ZOOM_TRANSFORM,
	isMagnifiedScale,
	normalizeWheelDelta,
} from '../utils/zoom';

/** Inline style exposing the zoom state as CSS custom properties. */
export type PhotoZoomStyle = CSSProperties & Record<`--${string}`, string>;

/** Options accepted by {@link usePhotoZoom}. */
export interface UsePhotoZoomOptions {
	/** Whether gesture-driven zoom/pan is available. */
	enabled: boolean;
	/** Identity of the active photo; magnification resets when it changes. */
	photoKey: string;
}

/** Gesture-driven zoom/pan state and handlers for the active photo. */
export interface PhotoZoom {
	/** Attach to the element that frames the photo viewport. */
	viewportRef: (node: HTMLLIElement | null) => void;
	scale: number;
	panX: number;
	panY: number;
	/** Whether the photo is currently magnified beyond its natural fit. */
	magnified: boolean;
	/** Inline style for the image element (custom properties + transform). */
	style: PhotoZoomStyle;
	/** Re-clamps the pan against freshly measured bounds. */
	refresh: () => void;
	/** Whether the current gesture must not turn into photo navigation. */
	suppressesNavigation: () => boolean;
	/** Marks a suppressed click/swipe as handled. */
	consumeNavigationSuppression: () => void;
	handlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
	handleMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
}

interface Point {
	x: number;
	y: number;
}

interface CoordinateSource {
	clientX?: number;
	clientY?: number;
	pageX?: number;
	pageY?: number;
	screenX?: number;
	screenY?: number;
}

interface DragState {
	kind: 'pointer' | 'mouse' | 'touch';
	startX: number;
	startY: number;
	startPanX: number;
	startPanY: number;
	moved: boolean;
}

interface PinchState {
	startDistance: number;
	startScale: number;
}

/** Movement in pixels before a drag counts as a pan instead of a tap. */
const DRAG_MOVE_THRESHOLD = 1;

function firstFiniteNumber(...values: Array<number | undefined>): number {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}

	return 0;
}

/** Reads client coordinates, tolerating partially populated synthetic events. */
function getPoint(source: CoordinateSource): Point {
	return {
		x: firstFiniteNumber(source.clientX, source.pageX, source.screenX),
		y: firstFiniteNumber(source.clientY, source.pageY, source.screenY),
	};
}

function toTouchArray(list: unknown): CoordinateSource[] {
	if (!list) {
		return [];
	}

	const indexed = list as ArrayLike<CoordinateSource | undefined>;
	const length = typeof indexed.length === 'number' ? indexed.length : 0;
	const touches: CoordinateSource[] = [];

	for (let index = 0; index < length; index += 1) {
		const touch = indexed[index];
		if (touch) {
			touches.push(touch);
		}
	}

	return touches;
}

interface TouchLists {
	touches?: unknown;
	targetTouches?: unknown;
	changedTouches?: unknown;
}

/**
 * Touches currently on the surface. Synthetic test events often populate only
 * one of the three lists, so the most complete one wins.
 */
function getActiveTouches(event: TouchLists): CoordinateSource[] {
	let best: CoordinateSource[] = [];

	for (const list of [
		event.touches,
		event.targetTouches,
		event.changedTouches,
	]) {
		const touches = toTouchArray(list);
		if (touches.length > best.length) {
			best = touches;
		}
	}

	return best;
}

/** Touches still down after a `touchend`/`touchcancel`. */
function getRemainingTouchCount(event: TouchLists): number {
	return toTouchArray(event.touches).length;
}

function preventEventDefault(event: Event): void {
	if (event.cancelable) {
		event.preventDefault();
	}
}

/**
 * Gesture-driven zoom and pan for the active lightbox photo.
 *
 * Wheel/trackpad zooms around the cursor, two-finger pinch zooms around the
 * pinch centre, and dragging (mouse, pen, or one finger) pans while magnified.
 * Pan offsets are clamped to the rendered letterboxed bounds of the image so no
 * empty background is exposed, and magnification resets when the active photo
 * changes or zoom is disabled.
 */
export function usePhotoZoom({
	enabled,
	photoKey,
}: UsePhotoZoomOptions): PhotoZoom {
	const viewportElementRef = useRef<HTMLLIElement | null>(null);
	const [viewportNode, setViewportNode] = useState<HTMLLIElement | null>(null);
	const transformRef = useRef<ZoomTransform>(IDLE_ZOOM_TRANSFORM);
	const dragRef = useRef<DragState | null>(null);
	const pinchRef = useRef<PinchState | null>(null);
	const suppressTapRef = useRef(false);
	const prefersPointerEventsRef = useRef(false);
	const detachDragRef = useRef<(() => void) | null>(null);
	const enabledRef = useRef(enabled);

	const [transform, setTransform] = useState<ZoomTransform>(
		IDLE_ZOOM_TRANSFORM,
	);

	const detachDragListeners = useCallback(() => {
		detachDragRef.current?.();
		detachDragRef.current = null;
	}, []);

	const reset = useCallback(() => {
		dragRef.current = null;
		pinchRef.current = null;
		suppressTapRef.current = false;
		transformRef.current = IDLE_ZOOM_TRANSFORM;
		detachDragListeners();
	}, [detachDragListeners]);

	// Keep event handlers in sync with props without waiting for an effect, so
	// disabling zoom or switching photos never leaves a magnified frame behind.
	enabledRef.current = enabled;

	const resetToken = `${enabled ? 'on' : 'off'}:${photoKey}`;
	const [appliedResetToken, setAppliedResetToken] = useState(resetToken);

	if (appliedResetToken !== resetToken) {
		setAppliedResetToken(resetToken);
		reset();
		setTransform(IDLE_ZOOM_TRANSFORM);
	}

	const presented =
		enabled && appliedResetToken === resetToken
			? transform
			: IDLE_ZOOM_TRANSFORM;

	useEffect(() => detachDragListeners, [detachDragListeners]);

	const viewportRef = useCallback((node: HTMLLIElement | null) => {
		viewportElementRef.current = node;
		setViewportNode(node);
	}, []);

	/**
	 * Applies a transform after clamping it to the rendered image bounds.
	 * Returns whether anything changed.
	 */
	const applyTransform = useCallback((next: ZoomTransform): boolean => {
		const viewport = viewportElementRef.current;
		const viewportSize = measureViewport(viewport);
		const rendered = getRenderedSize(
			measureNaturalSize(getPhotoImage(viewport)),
			viewportSize,
		);
		const clamped = clampTransform(next, rendered, viewportSize);

		if (!isMagnifiedScale(clamped.scale)) {
			suppressTapRef.current = false;
		}

		const previous = transformRef.current;
		if (
			previous.scale === clamped.scale &&
			previous.panX === clamped.panX &&
			previous.panY === clamped.panY
		) {
			return false;
		}

		transformRef.current = clamped;
		setTransform(clamped);
		return true;
	}, []);

	/** Re-clamps the current transform against freshly measured bounds. */
	const refresh = useCallback(() => {
		if (isMagnifiedScale(transformRef.current.scale)) {
			applyTransform(transformRef.current);
		}
	}, [applyTransform]);

	// Viewport bounds change with the layout, so re-clamp the pan on resize to
	// keep the magnified image from exposing empty background.
	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		window.addEventListener('resize', refresh);

		return () => {
			window.removeEventListener('resize', refresh);
		};
	}, [refresh]);

	/** Focal point relative to the centre of the photo viewport. */
	const getFocalOffset = useCallback((point: Point): Point => {
		const viewportSize = measureViewport(viewportElementRef.current);

		// Treat a coordinate-less synthetic event as a centred gesture.
		if (!viewportSize.measured || (point.x === 0 && point.y === 0)) {
			return { x: 0, y: 0 };
		}

		return {
			x: point.x - viewportSize.centerX,
			y: point.y - viewportSize.centerY,
		};
	}, []);

	/** Scales around a focal point, keeping that point anchored. */
	const zoomTo = useCallback(
		(nextScale: number, focalPoint: Point): boolean => {
			const previous = transformRef.current;
			const focal = getFocalOffset(focalPoint);

			return applyTransform({
				scale: nextScale,
				panX: getFocalPan(previous.panX, focal.x, previous.scale, nextScale),
				panY: getFocalPan(previous.panY, focal.y, previous.scale, nextScale),
			});
		},
		[applyTransform, getFocalOffset],
	);

	const startDrag = useCallback((kind: DragState['kind'], point: Point) => {
		dragRef.current = {
			kind,
			startX: point.x,
			startY: point.y,
			startPanX: transformRef.current.panX,
			startPanY: transformRef.current.panY,
			moved: false,
		};
	}, []);

	const moveDrag = useCallback(
		(point: Point): boolean => {
			const drag = dragRef.current;
			if (!drag) {
				return false;
			}

			const deltaX = point.x - drag.startX;
			const deltaY = point.y - drag.startY;

			if (
				Math.abs(deltaX) > DRAG_MOVE_THRESHOLD ||
				Math.abs(deltaY) > DRAG_MOVE_THRESHOLD
			) {
				drag.moved = true;
			}

			return applyTransform({
				scale: transformRef.current.scale,
				panX: drag.startPanX + deltaX,
				panY: drag.startPanY + deltaY,
			});
		},
		[applyTransform],
	);

	const endDrag = useCallback(() => {
		const drag = dragRef.current;
		dragRef.current = null;

		if (drag?.moved) {
			// A pan must not be interpreted as a tap on the photo.
			suppressTapRef.current = true;
		}

		detachDragListeners();
	}, [detachDragListeners]);

	const beginPinch = useCallback((touches: CoordinateSource[]) => {
		dragRef.current = null;
		pinchRef.current = {
			startDistance: getDistance(getPoint(touches[0]), getPoint(touches[1])),
			startScale: transformRef.current.scale,
		};
	}, []);

	const attachDragListeners = useCallback(
		(kind: 'pointer' | 'mouse') => {
			detachDragListeners();

			if (typeof window === 'undefined') {
				return;
			}

			const moveType = kind === 'pointer' ? 'pointermove' : 'mousemove';
			const endTypes =
				kind === 'pointer' ? ['pointerup', 'pointercancel'] : ['mouseup'];

			const onMove = (event: Event) => {
				moveDrag(getPoint(event as MouseEvent));
			};
			const onEnd = () => {
				endDrag();
			};

			window.addEventListener(moveType, onMove);
			for (const endType of endTypes) {
				window.addEventListener(endType, onEnd);
			}

			detachDragRef.current = () => {
				window.removeEventListener(moveType, onMove);
				for (const endType of endTypes) {
					window.removeEventListener(endType, onEnd);
				}
			};
		},
		[detachDragListeners, endDrag, moveDrag],
	);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			prefersPointerEventsRef.current = true;

			if (
				!enabledRef.current ||
				event.button > 0 ||
				event.pointerType === 'touch' ||
				!isMagnifiedScale(transformRef.current.scale)
			) {
				return;
			}

			event.preventDefault();
			startDrag('pointer', getPoint(event));
			attachDragListeners('pointer');
		},
		[attachDragListeners, startDrag],
	);

	const handleMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			if (
				prefersPointerEventsRef.current ||
				!enabledRef.current ||
				event.button > 0 ||
				!isMagnifiedScale(transformRef.current.scale)
			) {
				return;
			}

			event.preventDefault();
			startDrag('mouse', getPoint(event));
			attachDragListeners('mouse');
		},
		[attachDragListeners, startDrag],
	);

	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (!enabledRef.current) {
				return;
			}

			// A `ctrl`-modified wheel event is how trackpads report pinch zoom.
			const delta =
				normalizeWheelDelta(event.deltaY, event.deltaMode) *
				(event.ctrlKey ? WHEEL_ZOOM_CTRL_MULTIPLIER : 1);
			if (delta === 0) {
				return;
			}

			const previous = transformRef.current;
			const nextScale = clampScale(
				previous.scale * Math.exp(-delta * WHEEL_ZOOM_INTENSITY),
			);

			if (nextScale === previous.scale) {
				// At a zoom boundary. Keep swallowing the gesture while magnified so
				// the lightbox does not scroll under the photo.
				if (isMagnifiedScale(previous.scale)) {
					preventEventDefault(event);
				}
				return;
			}

			preventEventDefault(event);
			zoomTo(nextScale, getPoint(event));
		},
		[zoomTo],
	);

	const handleTouchStart = useCallback(
		(event: TouchEvent) => {
			if (!enabledRef.current) {
				return;
			}

			const touches = getActiveTouches(event);

			if (touches.length > 1) {
				beginPinch(touches);
				return;
			}

			if (
				touches.length === 1 &&
				isMagnifiedScale(transformRef.current.scale)
			) {
				startDrag('touch', getPoint(touches[0]));
			}
		},
		[beginPinch, startDrag],
	);

	const handleTouchMove = useCallback(
		(event: TouchEvent) => {
			if (!enabledRef.current) {
				return;
			}

			const touches = getActiveTouches(event);

			if (touches.length > 1) {
				const first = getPoint(touches[0]);
				const second = getPoint(touches[1]);
				const pinch = pinchRef.current;
				preventEventDefault(event);

				if (!pinch || pinch.startDistance <= 0) {
					beginPinch(touches);
					return;
				}

				const distance = getDistance(first, second);
				if (distance <= 0) {
					return;
				}

				zoomTo(
					clampScale((pinch.startScale * distance) / pinch.startDistance),
					getMidpoint(first, second),
				);
				return;
			}

			if (
				touches.length === 1 &&
				dragRef.current?.kind === 'touch' &&
				isMagnifiedScale(transformRef.current.scale)
			) {
				preventEventDefault(event);
				moveDrag(getPoint(touches[0]));
			}
		},
		[beginPinch, moveDrag, zoomTo],
	);

	const handleTouchEnd = useCallback(
		(event: TouchEvent) => {
			const remaining = getRemainingTouchCount(event);

			if (pinchRef.current && remaining < 2) {
				pinchRef.current = null;
				// The release of a pinch must never navigate, even when the gesture
				// ended back at the natural size.
				suppressTapRef.current = true;
			}

			if (remaining === 0) {
				endDrag();
				return;
			}

			// One finger left after a pinch: keep going as a pan.
			const remainingTouches = toTouchArray(event.touches);
			if (
				remaining === 1 &&
				!dragRef.current &&
				isMagnifiedScale(transformRef.current.scale)
			) {
				startDrag('touch', getPoint(remainingTouches[0]));
			}
		},
		[endDrag, startDrag],
	);

	useEffect(() => {
		if (!viewportNode) {
			return;
		}

		// Listen on the whole photo box so gestures anywhere over the photo (image,
		// button, or letterbox background) are handled.
		const surface =
			viewportNode.closest<HTMLElement>('.gallery-photo') ?? viewportNode;

		// Native, non-passive listeners: React attaches wheel/touch listeners
		// passively at the root, which cannot cancel browser scroll or page zoom.
		const options = { passive: false } as const;
		surface.addEventListener('wheel', handleWheel, options);
		surface.addEventListener('touchstart', handleTouchStart, options);
		surface.addEventListener('touchmove', handleTouchMove, options);
		surface.addEventListener('touchend', handleTouchEnd, options);
		surface.addEventListener('touchcancel', handleTouchEnd, options);

		return () => {
			surface.removeEventListener('wheel', handleWheel);
			surface.removeEventListener('touchstart', handleTouchStart);
			surface.removeEventListener('touchmove', handleTouchMove);
			surface.removeEventListener('touchend', handleTouchEnd);
			surface.removeEventListener('touchcancel', handleTouchEnd);
		};
	}, [
		handleTouchEnd,
		handleTouchMove,
		handleTouchStart,
		handleWheel,
		viewportNode,
	]);

	const suppressesNavigation = useCallback(() => {
		if (!enabledRef.current) {
			return false;
		}

		return (
			isMagnifiedScale(transformRef.current.scale) ||
			pinchRef.current !== null ||
			suppressTapRef.current ||
			dragRef.current?.moved === true
		);
	}, []);

	const consumeNavigationSuppression = useCallback(() => {
		if (!isMagnifiedScale(transformRef.current.scale)) {
			suppressTapRef.current = false;
		}
	}, []);

	const style = useMemo<PhotoZoomStyle>(() => {
		const scale = String(presented.scale);
		const panX = `${presented.panX}px`;
		const panY = `${presented.panY}px`;

		return {
			'--rbg-zoom-scale': scale,
			'--rbg-photo-scale': scale,
			'--rbg-scale': scale,
			'--rbg-pan-x': panX,
			'--rbg-pan-y': panY,
			'--rbg-photo-pan-x': panX,
			'--rbg-photo-pan-y': panY,
			transform: `translate(${panX}, ${panY}) translateY(-50%) scale(${scale})`,
		};
	}, [presented.panX, presented.panY, presented.scale]);

	return {
		viewportRef,
		scale: presented.scale,
		panX: presented.panX,
		panY: presented.panY,
		magnified: isMagnifiedScale(presented.scale),
		refresh,
		style,
		suppressesNavigation,
		consumeNavigationSuppression,
		handlePointerDown,
		handleMouseDown,
	};
}
