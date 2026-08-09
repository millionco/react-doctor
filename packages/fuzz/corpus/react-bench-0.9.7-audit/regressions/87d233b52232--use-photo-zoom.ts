// rule: effect-needs-cleanup
// file-path: src/components/use-photo-zoom.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 87d233b522326a26e57305db409c3b0459cb118400a0c3578d3de567d5b41ae4
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	clampPan,
	clampScale,
	getFocalPan,
	MIN_ZOOM_SCALE,
	NEUTRAL_ZOOM,
	type Pan,
	type Size,
} from '../utils/zoom';

/** Wheel sensitivity: `deltaY` pixels → multiplicative scale change. */
const WHEEL_ZOOM_SENSITIVITY = 0.0025;

/** Current zoom transform. */
interface ZoomState {
	scale: number;
	x: number;
	y: number;
}

interface UsePhotoZoomOptions {
	/** Whether gesture zooming is available at all. */
	enabled: boolean;
	/** Changing this resets the transform (used for the active photo index). */
	resetKey: unknown;
}

interface UsePhotoZoomResult {
	/** Ref for the photo viewport (the interactive surface). */
	viewportRef: (node: HTMLElement | null) => void;
	/** Ref for the `<img>` element being magnified. */
	imageRef: (node: HTMLImageElement | null) => void;
	/** Inline style exposing the transform and its CSS custom properties. */
	style: CSSProperties;
	/** True while the photo is magnified beyond scale `1`. */
	isMagnified: boolean;
	/** True when the in-flight gesture must not trigger photo navigation. */
	shouldSuppressNavigation: () => boolean;
	/** Clears the one-shot gesture suppression flag. */
	consumeNavigationSuppression: () => void;
}

/** Reads an element's laid-out box, tolerating environments without layout. */
function boxOf(element: HTMLElement): Size {
	const rect = element.getBoundingClientRect();

	return {
		width: rect.width || element.clientWidth || 0,
		height: rect.height || element.clientHeight || 0,
	};
}

/**
 * Measures the photo viewport. The button surface fills the viewport, but when
 * it reports no box (an unlaid-out ancestor, or a test environment that only
 * stubs the containing element) the nearest sized ancestor is used instead.
 */
function measure(element: HTMLElement | null): Size {
	let node: HTMLElement | null = element;

	while (node) {
		const box = boxOf(node);
		if (box.width > 0 && box.height > 0) {
			return box;
		}
		node = node.parentElement;
	}

	return { width: 0, height: 0 };
}

/** Distance between two touch points. */
function touchDistance(a: Touch, b: Touch): number {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Midpoint of two touch points, in client coordinates. */
function touchMidpoint(a: Touch, b: Touch): Pan {
	return {
		x: (a.clientX + b.clientX) / 2,
		y: (a.clientY + b.clientY) / 2,
	};
}

/**
 * Gesture-driven zoom and pan for the active lightbox photo.
 *
 * Handles wheel zoom, pinch zoom, and drag panning through native listeners on
 * the photo viewport, keeps the pan clamped inside the letterboxed image
 * bounds, and reports when a gesture must swallow click/swipe navigation.
 */
export function usePhotoZoom({
	enabled,
	resetKey,
}: UsePhotoZoomOptions): UsePhotoZoomResult {
	const [zoom, setZoom] = useState<ZoomState>(NEUTRAL_ZOOM);
	const zoomRef = useRef<ZoomState>(zoom);
	const viewportNodeRef = useRef<HTMLElement | null>(null);
	const imageNodeRef = useRef<HTMLImageElement | null>(null);
	const suppressNavigationRef = useRef(false);
	const [viewportNode, setViewportNode] = useState<HTMLElement | null>(null);

	zoomRef.current = zoom;

	const viewportRef = useCallback((node: HTMLElement | null) => {
		viewportNodeRef.current = node;
		setViewportNode(node);
	}, []);

	const imageRef = useCallback((node: HTMLImageElement | null) => {
		imageNodeRef.current = node;
	}, []);

	/** Natural image dimensions, used to derive the letterboxed size. */
	const getNaturalSize = useCallback((): Size => {
		const image = imageNodeRef.current;

		return {
			width: image?.naturalWidth ?? 0,
			height: image?.naturalHeight ?? 0,
		};
	}, []);

	/** Applies a new transform, clamping pan to the rendered image bounds. */
	const applyZoom = useCallback(
		(scale: number, pan: Pan) => {
			const nextScale = clampScale(scale);
			const viewport = measure(viewportNodeRef.current);
			const nextPan =
				nextScale <= MIN_ZOOM_SCALE
					? { x: 0, y: 0 }
					: clampPan(pan, nextScale, getNaturalSize(), viewport);

			setZoom((prevZoom) => {
				if (
					prevZoom.scale === nextScale &&
					prevZoom.x === nextPan.x &&
					prevZoom.y === nextPan.y
				) {
					return prevZoom;
				}

				return { scale: nextScale, x: nextPan.x, y: nextPan.y };
			});
		},
		[getNaturalSize],
	);

	// Changing photo — or turning zoom off — must clear magnification
	// synchronously, so no magnified frame is ever painted.
	if (
		!enabled &&
		(zoom.scale !== MIN_ZOOM_SCALE || zoom.x !== 0 || zoom.y !== 0)
	) {
		zoomRef.current = NEUTRAL_ZOOM;
		setZoom(NEUTRAL_ZOOM);
	}

	const previousResetKeyRef = useRef(resetKey);
	if (previousResetKeyRef.current !== resetKey) {
		previousResetKeyRef.current = resetKey;
		if (zoom.scale !== MIN_ZOOM_SCALE || zoom.x !== 0 || zoom.y !== 0) {
			zoomRef.current = NEUTRAL_ZOOM;
			setZoom(NEUTRAL_ZOOM);
		}
		suppressNavigationRef.current = false;
	}

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const viewport = viewportNode;
		if (!viewport) {
			return;
		}

		/** Converts client coordinates into offsets from the viewport centre. */
		const toFocal = (clientX: number, clientY: number): Pan => {
			const rect = viewport.getBoundingClientRect();
			return {
				x: clientX - (rect.left + rect.width / 2),
				y: clientY - (rect.top + rect.height / 2),
			};
		};

		const zoomAt = (nextScale: number, focal: Pan) => {
			const current = zoomRef.current;
			const clamped = clampScale(nextScale);
			applyZoom(clamped, getFocalPan(current, current.scale, clamped, focal));
		};

		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			suppressNavigationRef.current = true;
			const current = zoomRef.current;
			const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
			zoomAt(current.scale * factor, toFocal(event.clientX, event.clientY));
		};

		// ─── Mouse drag panning ──────────────────────────────────────────────
		let dragOrigin: Pan | null = null;
		let dragStartPan: Pan = { x: 0, y: 0 };

		const onMouseMove = (event: MouseEvent) => {
			if (!dragOrigin) {
				return;
			}

			event.preventDefault();
			suppressNavigationRef.current = true;
			applyZoom(zoomRef.current.scale, {
				x: dragStartPan.x + (event.clientX - dragOrigin.x),
				y: dragStartPan.y + (event.clientY - dragOrigin.y),
			});
		};

		const onMouseUp = () => {
			dragOrigin = null;
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};

		const onMouseDown = (event: MouseEvent) => {
			if (zoomRef.current.scale <= MIN_ZOOM_SCALE || event.button !== 0) {
				return;
			}

			event.preventDefault();
			dragOrigin = { x: event.clientX, y: event.clientY };
			dragStartPan = { x: zoomRef.current.x, y: zoomRef.current.y };
			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mouseup', onMouseUp);
		};

		// ─── Touch pinch + pan ───────────────────────────────────────────────
		let pinchStartDistance = 0;
		let pinchStartScale = MIN_ZOOM_SCALE;
		let touchOrigin: Pan | null = null;
		let touchStartPan: Pan = { x: 0, y: 0 };

		const onTouchStart = (event: TouchEvent) => {
			if (event.touches.length >= 2) {
				const [first, second] = [event.touches[0], event.touches[1]];
				pinchStartDistance = touchDistance(first, second);
				pinchStartScale = zoomRef.current.scale;
				touchOrigin = null;
				// A pinch never navigates, even if it ends back at scale 1.
				suppressNavigationRef.current = true;
				return;
			}

			pinchStartDistance = 0;

			if (zoomRef.current.scale > MIN_ZOOM_SCALE) {
				const touch = event.touches[0];
				touchOrigin = { x: touch.clientX, y: touch.clientY };
				touchStartPan = { x: zoomRef.current.x, y: zoomRef.current.y };
			}
		};

		const onTouchMove = (event: TouchEvent) => {
			if (event.touches.length >= 2 && pinchStartDistance > 0) {
				event.preventDefault();
				suppressNavigationRef.current = true;
				const [first, second] = [event.touches[0], event.touches[1]];
				const distance = touchDistance(first, second);
				const midpoint = touchMidpoint(first, second);
				zoomAt(
					(pinchStartScale * distance) / pinchStartDistance,
					toFocal(midpoint.x, midpoint.y),
				);
				return;
			}

			if (!touchOrigin || zoomRef.current.scale <= MIN_ZOOM_SCALE) {
				return;
			}

			event.preventDefault();
			suppressNavigationRef.current = true;
			const touch = event.touches[0];
			applyZoom(zoomRef.current.scale, {
				x: touchStartPan.x + (touch.clientX - touchOrigin.x),
				y: touchStartPan.y + (touch.clientY - touchOrigin.y),
			});
		};

		const onTouchEnd = (event: TouchEvent) => {
			if (event.touches.length < 2) {
				pinchStartDistance = 0;
			}
			if (event.touches.length === 0) {
				touchOrigin = null;
			}
		};

		viewport.addEventListener('wheel', onWheel, { passive: false });
		viewport.addEventListener('mousedown', onMouseDown);
		viewport.addEventListener('touchstart', onTouchStart, { passive: false });
		viewport.addEventListener('touchmove', onTouchMove, { passive: false });
		viewport.addEventListener('touchend', onTouchEnd);
		viewport.addEventListener('touchcancel', onTouchEnd);

		return () => {
			viewport.removeEventListener('wheel', onWheel);
			viewport.removeEventListener('mousedown', onMouseDown);
			viewport.removeEventListener('touchstart', onTouchStart);
			viewport.removeEventListener('touchmove', onTouchMove);
			viewport.removeEventListener('touchend', onTouchEnd);
			viewport.removeEventListener('touchcancel', onTouchEnd);
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, [applyZoom, enabled, viewportNode]);

	const isMagnified = enabled && zoom.scale > MIN_ZOOM_SCALE;

	const shouldSuppressNavigation = useCallback(
		() => isMagnified || suppressNavigationRef.current,
		[isMagnified],
	);

	const consumeNavigationSuppression = useCallback(() => {
		suppressNavigationRef.current = false;
	}, []);

	const style = useMemo<CSSProperties>(() => {
		const scale = enabled ? zoom.scale : MIN_ZOOM_SCALE;
		const x = enabled ? zoom.x : 0;
		const y = enabled ? zoom.y : 0;

		return {
			// Exposed for consumers and tests; always present, even unmagnified.
			'--rbg-zoom-scale': `${scale}`,
			'--rbg-photo-scale': `${scale}`,
			'--rbg-scale': `${scale}`,
			'--rbg-pan-x': `${x}px`,
			'--rbg-pan-y': `${y}px`,
			'--rbg-photo-pan-x': `${x}px`,
			'--rbg-photo-pan-y': `${y}px`,
			// `-50%` keeps the stylesheet's vertical centring of the photo.
			transform: `translate(${x}px, calc(-50% + ${y}px)) scale(${scale})`,
			cursor: scale > MIN_ZOOM_SCALE ? 'grab' : undefined,
			touchAction: enabled ? 'none' : undefined,
		} as CSSProperties;
	}, [enabled, zoom.scale, zoom.x, zoom.y]);

	return useMemo(
		() => ({
			viewportRef,
			imageRef,
			style,
			isMagnified,
			shouldSuppressNavigation,
			consumeNavigationSuppression,
		}),
		[
			consumeNavigationSuppression,
			imageRef,
			isMagnified,
			shouldSuppressNavigation,
			style,
			viewportRef,
		],
	);
}
