// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit a1ccbf78de79507c8d8ffad1b7fd2d4db5d2f46dabb837882b25b3d4cbcf24f2
import type { CSSProperties, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	areTransformsEqual,
	clampScale,
	clampTransform,
	getFocalPan,
	getNaturalImageSize,
	getPanBounds,
	getRenderedPhotoSize,
	getWheelZoomFactor,
	getZoomStyle,
	IDENTITY_TRANSFORM,
	isMagnifiedTransform,
	PAN_GESTURE_THRESHOLD,
	resolvePhotoViewportSize,
	type Size,
	type ZoomTransform,
} from '../utils/zoom';

/** A single touch point, tolerant of partially populated synthetic events. */
interface TouchPointLike {
	clientX?: number;
	clientY?: number;
	pageX?: number;
	pageY?: number;
	screenX?: number;
	screenY?: number;
}

interface GestureState {
	pinching: boolean;
	pinchStartDistance: number;
	pinchStartScale: number;
	dragging: boolean;
	/** Whether `lastX`/`lastY` hold a real origin for the active drag. */
	hasOrigin: boolean;
	lastX: number;
	lastY: number;
	travelled: number;
}

const initialGestureState: GestureState = {
	pinching: false,
	pinchStartDistance: 0,
	pinchStartScale: 1,
	dragging: false,
	hasOrigin: false,
	lastX: 0,
	lastY: 0,
	travelled: 0,
};

/** A committed transform, tagged with the context that produced it. */
interface CommittedTransform {
	transform: ZoomTransform;
	resetKey: unknown;
	enabled: boolean;
}

/**
 * Options accepted by {@link usePhotoZoom}.
 */
export interface UsePhotoZoomOptions {
	/** Whether zoom/pan gestures are active. */
	enabled?: boolean;
	/** Changing this value clears magnification (e.g. the active photo index). */
	resetKey?: unknown;
}

/**
 * Zoom state and wiring returned by {@link usePhotoZoom}.
 */
export interface PhotoZoom {
	/** Ref for the element the photo is fitted into; gestures are bound here. */
	viewportRef: (node: HTMLElement | null) => void;
	/** Ref for the rendered `<img>`; used to read intrinsic dimensions. */
	imageRef: RefObject<HTMLImageElement | null>;
	/** Inline style exposing the live scale/pan custom properties. */
	style: CSSProperties;
	/** Whether the photo is currently magnified beyond its fitted size. */
	isMagnified: boolean;
	/** True while a zoom/pan gesture must keep navigation from firing. */
	blocksNavigation: () => boolean;
	/** Consumes a pending gesture, reporting whether a press should be ignored. */
	consumeGesture: () => boolean;
	/** Re-applies the pan bounds, e.g. once the image reports its real size. */
	clampToBounds: () => void;
}

function firstFiniteNumber(...values: Array<number | undefined>): number {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}

	return 0;
}

function getPointX(point: TouchPointLike): number {
	return firstFiniteNumber(point.clientX, point.pageX, point.screenX);
}

function getPointY(point: TouchPointLike): number {
	return firstFiniteNumber(point.clientY, point.pageY, point.screenY);
}

/**
 * Extracts touch points from a touch event, accepting whichever touch list the
 * event exposes (browsers populate all of them, synthetic events often not).
 */
function getTouchPoints(event: TouchEvent): TouchPointLike[] {
	const lists = [event.touches, event.targetTouches, event.changedTouches];
	let points: TouchPointLike[] = [];

	for (const list of lists) {
		const length = list?.length ?? 0;
		if (length > points.length) {
			points = Array.from(list as unknown as ArrayLike<TouchPointLike>);
		}
	}

	return points;
}

function getDistance(a: TouchPointLike, b: TouchPointLike): number {
	const deltaX = getPointX(b) - getPointX(a);
	const deltaY = getPointY(b) - getPointY(a);
	return Math.hypot(deltaX, deltaY);
}

function getViewportRect(
	viewport: HTMLElement | null,
	image: HTMLImageElement | null,
): DOMRect | null {
	const candidates: Array<Element | null> = [viewport];
	let ancestor = image?.parentElement ?? null;
	while (ancestor) {
		candidates.push(ancestor);
		ancestor = ancestor.parentElement;
	}

	for (const candidate of candidates) {
		const rect = candidate?.getBoundingClientRect?.();
		if (rect && rect.width > 0 && rect.height > 0) {
			return rect;
		}
	}

	return null;
}

/**
 * Owns gesture-driven zoom and pan for the active photo.
 *
 * Wheel, pinch, and drag gestures update a scale/pan transform that is exposed
 * as inline CSS custom properties. Pan offsets are clamped to the rendered
 * (letterboxed) bounds of the image so panning never reveals empty background,
 * and any gesture marks navigation as suppressed so a magnified photo does not
 * change on click or swipe.
 */
export function usePhotoZoom({
	enabled = true,
	resetKey,
}: UsePhotoZoomOptions = {}): PhotoZoom {
	const imageRef = useRef<HTMLImageElement | null>(null);
	const viewportElementRef = useRef<HTMLElement | null>(null);
	const [viewportElement, setViewportElement] = useState<HTMLElement | null>(
		null,
	);
	const gestureRef = useRef<GestureState>({ ...initialGestureState });
	const pendingGestureRef = useRef(false);
	const pointerDrivenRef = useRef(false);
	// The transform is tagged with the photo/enabled it was produced for, so a
	// stale transform is discarded while rendering instead of in an effect. That
	// keeps a photo change (or a disabled zoom) from ever painting magnified.
	const [committed, setCommitted] = useState<CommittedTransform>(() => ({
		transform: IDENTITY_TRANSFORM,
		resetKey,
		enabled,
	}));
	const committedRef = useRef(committed);
	const contextRef = useRef({ resetKey, enabled });

	const isCurrent = (snapshot: CommittedTransform) =>
		snapshot.resetKey === resetKey && snapshot.enabled === enabled;

	const activeTransform =
		enabled && isCurrent(committed) ? committed.transform : IDENTITY_TRANSFORM;

	useEffect(() => {
		contextRef.current = { resetKey, enabled };
		// A new photo (or a zoom toggle) starts from an unmagnified, idle state.
		Object.assign(gestureRef.current, initialGestureState);
		pendingGestureRef.current = false;
	}, [enabled, resetKey]);

	const readTransform = useCallback((): ZoomTransform => {
		const snapshot = committedRef.current;
		const context = contextRef.current;
		if (
			snapshot.resetKey !== context.resetKey ||
			snapshot.enabled !== context.enabled
		) {
			return IDENTITY_TRANSFORM;
		}

		return snapshot.transform;
	}, []);

	const setViewportRef = useCallback((node: HTMLElement | null) => {
		viewportElementRef.current = node;
		setViewportElement(node);
	}, []);

	const commit = useCallback(
		(next: ZoomTransform) => {
			if (areTransformsEqual(readTransform(), next)) {
				return false;
			}

			const snapshot: CommittedTransform = {
				transform: next,
				resetKey: contextRef.current.resetKey,
				enabled: contextRef.current.enabled,
			};
			committedRef.current = snapshot;
			setCommitted(snapshot);
			return true;
		},
		[readTransform],
	);

	const measure = useCallback((): {
		viewport: Size | null;
		rendered: Size | null;
	} => {
		const image = imageRef.current;
		const viewport = resolvePhotoViewportSize(
			viewportElementRef.current,
			image,
		);
		const rendered = getRenderedPhotoSize(getNaturalImageSize(image), viewport);
		return { viewport, rendered };
	}, []);

	const getFocalOffset = useCallback((clientX: number, clientY: number) => {
		const rect = getViewportRect(viewportElementRef.current, imageRef.current);
		if (!rect) {
			return null;
		}

		return {
			x: clientX - (rect.left + rect.width / 2),
			y: clientY - (rect.top + rect.height / 2),
		};
	}, []);

	const applyScale = useCallback(
		(requestedScale: number, focal: { x: number; y: number } | null) => {
			const current = readTransform();
			const scale = clampScale(requestedScale);
			const { panX, panY } = getFocalPan(current, scale, focal);
			const { viewport, rendered } = measure();

			return commit(
				clampTransform(
					{ scale, panX, panY },
					getPanBounds(rendered, viewport, scale),
				),
			);
		},
		[commit, measure, readTransform],
	);

	const applyPanDelta = useCallback(
		(deltaX: number, deltaY: number) => {
			const current = readTransform();
			if (!isMagnifiedTransform(current)) {
				return false;
			}

			const { viewport, rendered } = measure();

			return commit(
				clampTransform(
					{
						scale: current.scale,
						panX: current.panX + deltaX,
						panY: current.panY + deltaY,
					},
					getPanBounds(rendered, viewport, current.scale),
				),
			);
		},
		[commit, measure, readTransform],
	);

	const clampToBounds = useCallback(() => {
		const current = readTransform();
		if (!isMagnifiedTransform(current)) {
			return;
		}

		const { viewport, rendered } = measure();
		commit(
			clampTransform(current, getPanBounds(rendered, viewport, current.scale)),
		);
	}, [commit, measure, readTransform]);

	useEffect(() => {
		if (!enabled || !viewportElement) {
			return;
		}

		const startPinch = (points: TouchPointLike[]) => {
			const gesture = gestureRef.current;
			gesture.pinching = true;
			gesture.dragging = false;
			gesture.pinchStartDistance = getDistance(points[0], points[1]);
			gesture.pinchStartScale = readTransform().scale;
			// A pinch always owns the tap it is part of, even at unchanged scale.
			pendingGestureRef.current = true;
		};

		const handleWheel = (event: WheelEvent) => {
			if (event.cancelable) {
				event.preventDefault();
			}

			const changed = applyScale(
				readTransform().scale * getWheelZoomFactor(event),
				getFocalOffset(event.clientX, event.clientY),
			);

			if (changed) {
				pendingGestureRef.current = true;
			}
		};

		const handleTouchStart = (event: TouchEvent) => {
			const gesture = gestureRef.current;
			const points = getTouchPoints(event);

			if (points.length >= 2) {
				startPinch(points);
				if (event.cancelable) {
					event.preventDefault();
				}
				return;
			}

			const magnified = isMagnifiedTransform(readTransform());
			if (!magnified) {
				// A fresh single-finger sequence on an unmagnified photo may navigate.
				pendingGestureRef.current = false;
			}

			gesture.pinching = false;
			gesture.dragging = magnified;
			gesture.travelled = 0;
			gesture.hasOrigin = points.length === 1;

			if (points.length === 1) {
				gesture.lastX = getPointX(points[0]);
				gesture.lastY = getPointY(points[0]);
			}
		};

		const handleTouchMove = (event: TouchEvent) => {
			const gesture = gestureRef.current;
			const points = getTouchPoints(event);

			if (points.length >= 2) {
				if (!gesture.pinching) {
					startPinch(points);
					return;
				}

				const distance = getDistance(points[0], points[1]);
				if (gesture.pinchStartDistance > 0 && distance > 0) {
					const focal = getFocalOffset(
						(getPointX(points[0]) + getPointX(points[1])) / 2,
						(getPointY(points[0]) + getPointY(points[1])) / 2,
					);
					applyScale(
						gesture.pinchStartScale * (distance / gesture.pinchStartDistance),
						focal,
					);
				}

				pendingGestureRef.current = true;
				if (event.cancelable) {
					event.preventDefault();
				}
				return;
			}

			if (!(gesture.dragging && points.length === 1)) {
				return;
			}

			const x = getPointX(points[0]);
			const y = getPointY(points[0]);

			if (!gesture.hasOrigin) {
				// The sequence started without usable coordinates; anchor here.
				gesture.lastX = x;
				gesture.lastY = y;
				gesture.hasOrigin = true;
				return;
			}

			const deltaX = x - gesture.lastX;
			const deltaY = y - gesture.lastY;
			gesture.lastX = x;
			gesture.lastY = y;
			gesture.travelled += Math.abs(deltaX) + Math.abs(deltaY);

			const panned = applyPanDelta(deltaX, deltaY);
			if (panned || gesture.travelled > PAN_GESTURE_THRESHOLD) {
				pendingGestureRef.current = true;
			}

			if (event.cancelable) {
				event.preventDefault();
			}
		};

		const handleTouchEnd = () => {
			const gesture = gestureRef.current;
			if (gesture.pinching) {
				pendingGestureRef.current = true;
			}

			gesture.pinching = false;
			gesture.dragging = false;
			gesture.hasOrigin = false;
		};

		const beginDrag = (event: MouseEvent) => {
			const gesture = gestureRef.current;
			if (typeof event.button === 'number' && event.button !== 0) {
				return;
			}

			if (!isMagnifiedTransform(readTransform())) {
				// A fresh press on an unmagnified photo may navigate again.
				pendingGestureRef.current = false;
				return;
			}

			gesture.dragging = true;
			gesture.hasOrigin = true;
			gesture.lastX = event.clientX;
			gesture.lastY = event.clientY;
			gesture.travelled = 0;
			if (event.cancelable) {
				// Suppresses the native image drag while panning.
				event.preventDefault();
			}
		};

		const updateDrag = (event: MouseEvent) => {
			const gesture = gestureRef.current;
			if (!gesture.dragging) {
				return;
			}

			const deltaX = event.clientX - gesture.lastX;
			const deltaY = event.clientY - gesture.lastY;
			gesture.lastX = event.clientX;
			gesture.lastY = event.clientY;
			gesture.travelled += Math.abs(deltaX) + Math.abs(deltaY);

			const panned = applyPanDelta(deltaX, deltaY);
			if (panned || gesture.travelled > PAN_GESTURE_THRESHOLD) {
				pendingGestureRef.current = true;
			}
		};

		const endDrag = () => {
			gestureRef.current.dragging = false;
			gestureRef.current.hasOrigin = false;
		};

		// Touch input is handled through touch events (pinch needs multiple
		// points), so pointer events only drive mouse and pen panning.
		const isTouchPointer = (event: PointerEvent) => event.pointerType === 'touch';

		const handlePointerDown = (event: PointerEvent) => {
			if (isTouchPointer(event)) {
				return;
			}

			// Pointer events are authoritative once seen; the compatibility mouse
			// events that follow them must not pan a second time.
			pointerDrivenRef.current = true;
			beginDrag(event);
		};

		const handlePointerMove = (event: PointerEvent) => {
			if (isTouchPointer(event)) {
				return;
			}

			updateDrag(event);
		};

		const handlePointerUp = (event: PointerEvent) => {
			if (isTouchPointer(event)) {
				return;
			}

			endDrag();
		};

		const handleMouseDown = (event: MouseEvent) => {
			if (pointerDrivenRef.current) {
				return;
			}

			beginDrag(event);
		};

		const handleMouseMove = (event: MouseEvent) => {
			if (pointerDrivenRef.current) {
				return;
			}

			updateDrag(event);
		};

		const handleMouseUp = () => {
			if (pointerDrivenRef.current) {
				return;
			}

			endDrag();
		};

		const handleDragStart = (event: Event) => {
			if (isMagnifiedTransform(readTransform())) {
				event.preventDefault();
			}
		};

		// Gestures aimed at the photo area but not at the photo itself (the
		// letterbox margins around it) still belong to this photo, so the area
		// wrapper listens too. Events are handled once, at the deepest listener.
		const handledEvents = new WeakSet<Event>();
		const once =
			<E extends Event>(handler: (event: E) => void) =>
			(event: Event) => {
				if (handledEvents.has(event)) {
					return;
				}

				handledEvents.add(event);
				handler(event as E);
			};

		const listeners: Array<[string, EventListener, AddEventListenerOptions?]> = [
			['wheel', once<WheelEvent>(handleWheel), { passive: false }],
			['touchstart', once<TouchEvent>(handleTouchStart), { passive: false }],
			['touchmove', once<TouchEvent>(handleTouchMove), { passive: false }],
			['touchend', once<TouchEvent>(handleTouchEnd)],
			['touchcancel', once<TouchEvent>(handleTouchEnd)],
			['pointerdown', once<PointerEvent>(handlePointerDown)],
			['mousedown', once<MouseEvent>(handleMouseDown)],
			['dragstart', once<Event>(handleDragStart)],
		];

		const targets: Element[] = [viewportElement];
		const photoArea = viewportElement.closest?.('.gallery-photos');
		if (photoArea && photoArea !== viewportElement) {
			targets.push(photoArea);
		}

		for (const target of targets) {
			for (const [type, listener, options] of listeners) {
				target.addEventListener(type, listener, options);
			}
		}

		const view = viewportElement.ownerDocument?.defaultView;
		view?.addEventListener('pointermove', handlePointerMove);
		view?.addEventListener('pointerup', handlePointerUp);
		view?.addEventListener('pointercancel', handlePointerUp);
		view?.addEventListener('mousemove', handleMouseMove);
		view?.addEventListener('mouseup', handleMouseUp);
		// A resized viewport changes how far the photo may be panned.
		view?.addEventListener('resize', clampToBounds);

		return () => {
			for (const target of targets) {
				for (const [type, listener] of listeners) {
					target.removeEventListener(type, listener);
				}
			}

			view?.removeEventListener('pointermove', handlePointerMove);
			view?.removeEventListener('pointerup', handlePointerUp);
			view?.removeEventListener('pointercancel', handlePointerUp);
			view?.removeEventListener('mousemove', handleMouseMove);
			view?.removeEventListener('mouseup', handleMouseUp);
			view?.removeEventListener('resize', clampToBounds);
		};
	}, [
		applyPanDelta,
		applyScale,
		clampToBounds,
		enabled,
		getFocalOffset,
		readTransform,
		viewportElement,
	]);

	const isMagnified = enabled && isMagnifiedTransform(activeTransform);

	const blocksNavigation = useCallback(() => {
		if (!enabled) {
			return false;
		}

		return isMagnifiedTransform(readTransform()) || pendingGestureRef.current;
	}, [enabled, readTransform]);

	const consumeGesture = useCallback(() => {
		const pending = pendingGestureRef.current;
		pendingGestureRef.current = false;
		return enabled && pending;
	}, [enabled]);

	const style = useMemo(() => getZoomStyle(activeTransform), [activeTransform]);

	return {
		viewportRef: setViewportRef,
		imageRef,
		style,
		isMagnified,
		blocksNavigation,
		consumeGesture,
		clampToBounds,
	};
}
