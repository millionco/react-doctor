// rule: effect-needs-cleanup
// file-path: src/hooks/use-zoom-pan.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit cfa2a6a9014fabea1339cbc52023a3592b2ca3721331700195ede6f67c1e0a3e
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	TouchEvent as ReactTouchEvent,
	RefObject,
} from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
	MAX_ZOOM,
	MIN_ZOOM,
	PAN_MOVE_THRESHOLD,
	ZOOM_WHEEL_SENSITIVITY,
} from '../constants';

/** Scale + pan applied to the active photo. */
interface Transform {
	scale: number;
	x: number;
	y: number;
}

/** Unmagnified transform used as the reset baseline. */
const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

type GestureMode = 'none' | 'swipe' | 'pan' | 'pinch';

interface UseZoomPanOptions {
	/** When false, the photo is always presented unmagnified. */
	enableZoom: boolean;
	/** Changing this value clears any active magnification (e.g. active index). */
	resetKey: number;
	/** Navigate to the previous photo (swipe right). */
	onNavigatePrev: () => void;
	/** Navigate to the next photo (swipe left). */
	onNavigateNext: () => void;
	/** Activate the photo on a genuine click/tap (not a pan/zoom gesture). */
	onActivate: () => void;
}

interface UseZoomPanResult {
	/** Inline custom properties exposing scale/pan on the image element. */
	imageStyle: CSSProperties;
	/** True when the photo is magnified (scale > 1). */
	isMagnified: boolean;
	/** Callback ref attached to the gesture viewport (the photo button). */
	registerViewport: (node: HTMLElement | null) => void;
	/** Ref attached to the rendered image element (for natural dimensions). */
	imageRef: RefObject<HTMLImageElement | null>;
	onClick: () => void;
	onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => void;
	onTouchMove: (event: ReactTouchEvent<HTMLButtonElement>) => void;
	onTouchEnd: () => void;
	onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onMouseMove: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onMouseUp: () => void;
	onMouseLeave: () => void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

interface Point {
	clientX: number;
	clientY: number;
}

function touchDistance(a: Point, b: Point): number {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Gesture-driven zoom and pan for the active gallery photo.
 *
 * Zoom is controlled with the wheel and pinch, panning with drag; no on-screen
 * controls are used. While the photo is magnified (or immediately after a
 * pinch/wheel zoom) click and swipe navigation are suppressed so the gesture
 * pans instead of changing photos. Pan offsets are clamped to the rendered
 * (letterboxed) image bounds so background is never exposed, and the transform
 * resets to the unmagnified baseline whenever the active photo changes or zoom
 * is turned off — synchronously during render, so no magnified frame lingers.
 */
export function useZoomPan({
	enableZoom,
	resetKey,
	onNavigatePrev,
	onNavigateNext,
	onActivate,
}: UseZoomPanOptions): UseZoomPanResult {
	const [transform, setTransform] = useState<Transform>(IDENTITY);

	// Latest navigation callbacks, read from stable gesture handlers.
	const callbacksRef = useRef({ onNavigatePrev, onNavigateNext, onActivate });
	callbacksRef.current = { onNavigatePrev, onNavigateNext, onActivate };

	// Live mirrors read synchronously inside gesture handlers.
	const transformRef = useRef<Transform>(transform);
	const enableZoomRef = useRef(enableZoom);
	const magnifiedRef = useRef(false);

	// DOM references used for measuring the viewport and image.
	const viewportRef = useRef<HTMLElement | null>(null);
	const imageRef = useRef<HTMLImageElement>(null);

	// Suppresses the click emitted at the end of a drag/pinch gesture.
	const movedRef = useRef(false);

	// Render-phase reset: derive the effective transform without a post-paint
	// effect, so turning zoom off (or switching photos) never leaves a
	// magnified frame on screen.
	const prevResetKeyRef = useRef(resetKey);
	const prevEnableZoomRef = useRef(enableZoom);
	let current = transform;
	if (prevResetKeyRef.current !== resetKey) {
		prevResetKeyRef.current = resetKey;
		current = IDENTITY;
	}
	if (prevEnableZoomRef.current !== enableZoom) {
		prevEnableZoomRef.current = enableZoom;
	}
	if (!enableZoom) {
		current = IDENTITY;
	}
	if (
		current === IDENTITY &&
		(transform.scale !== 1 || transform.x !== 0 || transform.y !== 0)
	) {
		// Persist the reset so the next gesture starts from the baseline.
		setTransform(IDENTITY);
	}

	transformRef.current = current;
	enableZoomRef.current = enableZoom;
	const isMagnified = current.scale > MIN_ZOOM;
	magnifiedRef.current = isMagnified;

	const applyTransform = useCallback((next: Transform) => {
		transformRef.current = next;
		setTransform(next);
	}, []);

	// Clamp a pan offset to the rendered (aspect-fit) image bounds so no
	// background is exposed. Panning is possible on an axis only when the
	// magnified image overflows the viewport on that axis.
	const clampPan = useCallback((x: number, y: number, scale: number) => {
		const viewport = viewportRef.current;
		const image = imageRef.current;
		if (!(viewport && image)) {
			return { x: 0, y: 0 };
		}

		const rect = viewport.getBoundingClientRect();
		const viewportWidth = rect.width;
		const viewportHeight = rect.height;
		const naturalWidth = image.naturalWidth;
		const naturalHeight = image.naturalHeight;
		if (
			!(
				viewportWidth > 0 &&
				viewportHeight > 0 &&
				naturalWidth > 0 &&
				naturalHeight > 0
			)
		) {
			return { x: 0, y: 0 };
		}

		const fit = Math.min(
			viewportWidth / naturalWidth,
			viewportHeight / naturalHeight,
		);
		const renderedWidth = naturalWidth * fit;
		const renderedHeight = naturalHeight * fit;
		const maxX = Math.max(0, (renderedWidth * scale - viewportWidth) / 2);
		const maxY = Math.max(0, (renderedHeight * scale - viewportHeight) / 2);
		return {
			x: clamp(x, -maxX, maxX),
			y: clamp(y, -maxY, maxY),
		};
	}, []);

	// Zoom toward a focal point (in client coordinates), keeping that point
	// anchored under the cursor/fingers, then re-clamp the resulting pan.
	const zoomToFocalPoint = useCallback(
		(rawScale: number, focalClientX: number, focalClientY: number) => {
			const nextScale = clamp(rawScale, MIN_ZOOM, MAX_ZOOM);
			if (nextScale <= MIN_ZOOM) {
				applyTransform(IDENTITY);
				return;
			}

			const previous = transformRef.current;
			let x = previous.x;
			let y = previous.y;
			const viewport = viewportRef.current;
			if (viewport) {
				const rect = viewport.getBoundingClientRect();
				const centerX = rect.left + rect.width / 2;
				const centerY = rect.top + rect.height / 2;
				const focalX = focalClientX - centerX;
				const focalY = focalClientY - centerY;
				const ratio = previous.scale === 0 ? 1 : nextScale / previous.scale;
				x = focalX - (focalX - previous.x) * ratio;
				y = focalY - (focalY - previous.y) * ratio;
			}

			const clamped = clampPan(x, y, nextScale);
			applyTransform({ scale: nextScale, x: clamped.x, y: clamped.y });
		},
		[applyTransform, clampPan],
	);

	// ─── Wheel zoom (native, non-passive so scrolling is prevented) ──────────
	const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
	wheelHandlerRef.current = (event: WheelEvent) => {
		if (!enableZoomRef.current) {
			return;
		}
		event.preventDefault();
		const previous = transformRef.current;
		const nextScale = clamp(
			previous.scale * Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY),
			MIN_ZOOM,
			MAX_ZOOM,
		);
		if (nextScale === previous.scale) {
			return;
		}
		zoomToFocalPoint(nextScale, event.clientX, event.clientY);
	};

	const detachWheelRef = useRef<(() => void) | null>(null);
	const registerViewport = useCallback((node: HTMLElement | null) => {
		detachWheelRef.current?.();
		detachWheelRef.current = null;
		viewportRef.current = node;
		if (node) {
			const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
			node.addEventListener('wheel', listener, { passive: false });
			detachWheelRef.current = () =>
				node.removeEventListener('wheel', listener);
		}
	}, []);

	// ─── Touch: pinch zoom, one-finger pan, swipe navigation ─────────────────
	const touchRef = useRef({
		mode: 'none' as GestureMode,
		startX: 0,
		startY: 0,
		screenStart: 0,
		screenEnd: 0,
		panX: 0,
		panY: 0,
		pinchStartDistance: 0,
		pinchStartScale: 1,
		pinchOccurred: false,
		moved: false,
	});

	const onTouchStart = useCallback(
		(event: ReactTouchEvent<HTMLButtonElement>) => {
			const touches = event.targetTouches;
			const state = touchRef.current;

			if (touches.length >= 2 && enableZoomRef.current) {
				state.mode = 'pinch';
				state.pinchStartDistance = touchDistance(touches[0], touches[1]);
				state.pinchStartScale = transformRef.current.scale;
				state.panX = transformRef.current.x;
				state.panY = transformRef.current.y;
				state.pinchOccurred = true;
				movedRef.current = true;
				return;
			}

			const touch = touches[0];
			if (!touch) {
				return;
			}
			state.screenStart = touch.screenX;
			state.screenEnd = touch.screenX;
			state.startX = touch.clientX;
			state.startY = touch.clientY;
			state.panX = transformRef.current.x;
			state.panY = transformRef.current.y;
			state.pinchOccurred = false;
			state.moved = false;
			movedRef.current = false;
			state.mode =
				enableZoomRef.current && magnifiedRef.current ? 'pan' : 'swipe';
		},
		[],
	);

	const onTouchMove = useCallback(
		(event: ReactTouchEvent<HTMLButtonElement>) => {
			const touches = event.targetTouches;
			const state = touchRef.current;

			if (touches.length >= 2 && enableZoomRef.current) {
				if (state.pinchStartDistance > 0) {
					const distance = touchDistance(touches[0], touches[1]);
					const nextScale =
						state.pinchStartScale * (distance / state.pinchStartDistance);
					const midX = (touches[0].clientX + touches[1].clientX) / 2;
					const midY = (touches[0].clientY + touches[1].clientY) / 2;
					state.mode = 'pinch';
					state.pinchOccurred = true;
					movedRef.current = true;
					zoomToFocalPoint(nextScale, midX, midY);
				}
				return;
			}

			if (state.mode === 'pan') {
				const touch = touches[0];
				if (!touch) {
					return;
				}
				const deltaX = touch.clientX - state.startX;
				const deltaY = touch.clientY - state.startY;
				if (
					Math.abs(deltaX) > PAN_MOVE_THRESHOLD ||
					Math.abs(deltaY) > PAN_MOVE_THRESHOLD
				) {
					state.moved = true;
					movedRef.current = true;
				}
				const clamped = clampPan(
					state.panX + deltaX,
					state.panY + deltaY,
					transformRef.current.scale,
				);
				applyTransform({
					scale: transformRef.current.scale,
					x: clamped.x,
					y: clamped.y,
				});
				return;
			}

			const touch = touches[0];
			if (touch) {
				state.screenEnd = touch.screenX;
				state.moved = true;
				movedRef.current = true;
			}
		},
		[applyTransform, clampPan, zoomToFocalPoint],
	);

	const onTouchEnd = useCallback(() => {
		const state = touchRef.current;
		const { mode, pinchOccurred, moved, screenStart, screenEnd } = state;
		state.mode = 'none';
		state.pinchStartDistance = 0;
		state.pinchOccurred = false;

		if (mode === 'pinch' || mode === 'pan' || pinchOccurred) {
			// Zoom/pan gesture: never navigate.
			return;
		}

		if (mode === 'swipe' && moved) {
			if (screenStart < screenEnd) {
				callbacksRef.current.onNavigatePrev();
			} else if (screenStart > screenEnd) {
				callbacksRef.current.onNavigateNext();
			}
		}
	}, []);

	// ─── Mouse drag pan (desktop, only while magnified) ──────────────────────
	const dragRef = useRef({
		active: false,
		startX: 0,
		startY: 0,
		panX: 0,
		panY: 0,
	});

	const onMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLButtonElement>) => {
			if (!(enableZoomRef.current && magnifiedRef.current)) {
				return;
			}
			event.preventDefault();
			dragRef.current = {
				active: true,
				startX: event.clientX,
				startY: event.clientY,
				panX: transformRef.current.x,
				panY: transformRef.current.y,
			};
			movedRef.current = false;
		},
		[],
	);

	const onMouseMove = useCallback(
		(event: ReactMouseEvent<HTMLButtonElement>) => {
			const drag = dragRef.current;
			if (!drag.active) {
				return;
			}
			const deltaX = event.clientX - drag.startX;
			const deltaY = event.clientY - drag.startY;
			if (
				Math.abs(deltaX) > PAN_MOVE_THRESHOLD ||
				Math.abs(deltaY) > PAN_MOVE_THRESHOLD
			) {
				movedRef.current = true;
			}
			const clamped = clampPan(
				drag.panX + deltaX,
				drag.panY + deltaY,
				transformRef.current.scale,
			);
			applyTransform({
				scale: transformRef.current.scale,
				x: clamped.x,
				y: clamped.y,
			});
		},
		[applyTransform, clampPan],
	);

	const endDrag = useCallback(() => {
		dragRef.current.active = false;
	}, []);

	// ─── Click: navigate only on a genuine tap ───────────────────────────────
	const onClick = useCallback(() => {
		const wasMoved = movedRef.current;
		movedRef.current = false;
		if (wasMoved || magnifiedRef.current) {
			return;
		}
		callbacksRef.current.onActivate();
	}, []);

	const imageStyle = useMemo(
		() =>
			({
				'--rbg-photo-scale': `${current.scale}`,
				'--rbg-photo-pan-x': `${current.x}px`,
				'--rbg-photo-pan-y': `${current.y}px`,
			}) as CSSProperties,
		[current.scale, current.x, current.y],
	);

	return {
		imageStyle,
		isMagnified,
		registerViewport,
		imageRef,
		onClick,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		onMouseDown,
		onMouseMove,
		onMouseUp: endDrag,
		onMouseLeave: endDrag,
	};
}
