// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 6853fc137acb6a9609747b737eb64ecc3b8a71a4ad01a2f3d46293f807587a75
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
	ZOOM_DRAG_CLICK_THRESHOLD,
	ZOOM_MIN_SCALE,
	ZOOM_WHEEL_SENSITIVITY,
} from '../constants';
import { clampPanOffset, clampScale } from '../utils/photo-zoom';

interface ZoomState {
	photoKey: string | null;
	scale: number;
	panX: number;
	panY: number;
}

interface UsePhotoZoomOptions {
	enableZoom: boolean;
	photoKey: string | null;
}

interface TouchPoint {
	clientX: number;
	clientY: number;
}

function createInitialZoomState(photoKey: string | null): ZoomState {
	return { photoKey, scale: ZOOM_MIN_SCALE, panX: 0, panY: 0 };
}

function getTouchList(event: TouchEvent): ArrayLike<TouchPoint> {
	if (event.touches && event.touches.length > 0) {
		return event.touches as unknown as ArrayLike<TouchPoint>;
	}

	return (event.targetTouches || []) as unknown as ArrayLike<TouchPoint>;
}

function getTouchDistance(a: TouchPoint, b: TouchPoint): number {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getTouchMidpoint(a: TouchPoint, b: TouchPoint) {
	return {
		x: (a.clientX + b.clientX) / 2,
		y: (a.clientY + b.clientY) / 2,
	};
}

/**
 * Drives gesture-based zoom/pan for the active lightbox photo: wheel and
 * pinch to zoom, drag to pan, all clamped to the letterboxed image bounds.
 * Scale/pan reset synchronously (during render) when the photo changes or
 * zoom is disabled, so there is never a stray magnified frame.
 */
export function usePhotoZoom({ enableZoom, photoKey }: UsePhotoZoomOptions) {
	const containerRef = useRef<HTMLButtonElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const suppressNextPressRef = useRef(false);

	const [zoomState, setZoomState] = useState<ZoomState>(() =>
		createInitialZoomState(photoKey),
	);

	let renderState = zoomState;
	const needsReset =
		zoomState.photoKey !== photoKey ||
		(!enableZoom &&
			(zoomState.scale !== ZOOM_MIN_SCALE ||
				zoomState.panX !== 0 ||
				zoomState.panY !== 0));

	if (needsReset) {
		renderState = createInitialZoomState(photoKey);
		setZoomState(renderState);
		suppressNextPressRef.current = false;
	}

	const zoomStateRef = useRef(renderState);
	zoomStateRef.current = renderState;

	useEffect(() => {
		const container = containerRef.current;
		if (!(container && enableZoom)) {
			return;
		}

		let isPinching = false;
		let pinchStartDistance = 0;
		let pinchStartState: ZoomState | null = null;

		let isDragPanning = false;
		let didDrag = false;
		let dragOrigin = { x: 0, y: 0, panX: 0, panY: 0 };

		function getViewportSize() {
			const rect = (container as HTMLButtonElement).getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		}

		function getNaturalSize() {
			const img = imageRef.current;
			return {
				width: img?.naturalWidth || 0,
				height: img?.naturalHeight || 0,
			};
		}

		function getFocalOffset(clientX: number, clientY: number) {
			const rect = (container as HTMLButtonElement).getBoundingClientRect();
			return {
				x: clientX - (rect.left + rect.width / 2),
				y: clientY - (rect.top + rect.height / 2),
			};
		}

		function applyZoom(
			nextScaleRaw: number,
			focal: { x: number; y: number },
			base: ZoomState,
		) {
			const nextScale = clampScale(nextScaleRaw);
			const k = nextScale / base.scale;
			const rawPanX = focal.x * (1 - k) + base.panX * k;
			const rawPanY = focal.y * (1 - k) + base.panY * k;
			const clamped = clampPanOffset(
				{ x: rawPanX, y: rawPanY },
				nextScale,
				getNaturalSize(),
				getViewportSize(),
			);

			setZoomState((prev) => ({
				...prev,
				scale: nextScale,
				panX: clamped.x,
				panY: clamped.y,
			}));
		}

		function panBy(dx: number, dy: number) {
			const clamped = clampPanOffset(
				{ x: dragOrigin.panX + dx, y: dragOrigin.panY + dy },
				zoomStateRef.current.scale,
				getNaturalSize(),
				getViewportSize(),
			);

			setZoomState((prev) => ({ ...prev, panX: clamped.x, panY: clamped.y }));
		}

		function onWindowMouseMove(event: MouseEvent) {
			if (!isDragPanning) {
				return;
			}

			const dx = event.clientX - dragOrigin.x;
			const dy = event.clientY - dragOrigin.y;
			if (
				Math.abs(dx) > ZOOM_DRAG_CLICK_THRESHOLD ||
				Math.abs(dy) > ZOOM_DRAG_CLICK_THRESHOLD
			) {
				didDrag = true;
			}
			panBy(dx, dy);
		}

		function onWindowMouseUp() {
			isDragPanning = false;
			if (didDrag) {
				suppressNextPressRef.current = true;
			}
			didDrag = false;
			window.removeEventListener('mousemove', onWindowMouseMove);
			window.removeEventListener('mouseup', onWindowMouseUp);
		}

		function onMouseDown(event: MouseEvent) {
			suppressNextPressRef.current = false;
			if (event.button !== 0 || zoomStateRef.current.scale <= ZOOM_MIN_SCALE) {
				return;
			}

			event.preventDefault();
			isDragPanning = true;
			didDrag = false;
			dragOrigin = {
				x: event.clientX,
				y: event.clientY,
				panX: zoomStateRef.current.panX,
				panY: zoomStateRef.current.panY,
			};
			window.addEventListener('mousemove', onWindowMouseMove);
			window.addEventListener('mouseup', onWindowMouseUp);
		}

		function onTouchStart(event: TouchEvent) {
			suppressNextPressRef.current = false;
			const touches = getTouchList(event);

			if (touches.length >= 2) {
				event.preventDefault();
				event.stopPropagation();
				isPinching = true;
				isDragPanning = false;
				pinchStartDistance = getTouchDistance(touches[0], touches[1]);
				pinchStartState = zoomStateRef.current;
				return;
			}

			if (zoomStateRef.current.scale > ZOOM_MIN_SCALE) {
				event.preventDefault();
				event.stopPropagation();
				isDragPanning = true;
				didDrag = false;
				const touch = touches[0];
				dragOrigin = {
					x: touch.clientX,
					y: touch.clientY,
					panX: zoomStateRef.current.panX,
					panY: zoomStateRef.current.panY,
				};
			}
		}

		function onTouchMove(event: TouchEvent) {
			const touches = getTouchList(event);

			if (isPinching && touches.length >= 2 && pinchStartState) {
				event.preventDefault();
				event.stopPropagation();
				const currentDistance = getTouchDistance(touches[0], touches[1]);
				const ratio =
					pinchStartDistance > 0 ? currentDistance / pinchStartDistance : 1;
				const mid = getTouchMidpoint(touches[0], touches[1]);
				const focal = getFocalOffset(mid.x, mid.y);
				applyZoom(pinchStartState.scale * ratio, focal, zoomStateRef.current);
				return;
			}

			if (isDragPanning) {
				event.preventDefault();
				event.stopPropagation();
				const touch = touches[0];
				const dx = touch.clientX - dragOrigin.x;
				const dy = touch.clientY - dragOrigin.y;
				if (
					Math.abs(dx) > ZOOM_DRAG_CLICK_THRESHOLD ||
					Math.abs(dy) > ZOOM_DRAG_CLICK_THRESHOLD
				) {
					didDrag = true;
				}
				panBy(dx, dy);
			}
		}

		function onTouchEnd(event: TouchEvent) {
			const touches = getTouchList(event);

			if (isPinching) {
				if (touches.length < 2) {
					isPinching = false;
					pinchStartState = null;
					suppressNextPressRef.current = true;
				}
				event.stopPropagation();
				return;
			}

			if (isDragPanning) {
				isDragPanning = false;
				if (didDrag) {
					suppressNextPressRef.current = true;
				}
				didDrag = false;
				event.stopPropagation();
			}
		}

		function onWheel(event: WheelEvent) {
			event.preventDefault();
			const base = zoomStateRef.current;
			const nextScaleRaw =
				base.scale * Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY);
			const focal = getFocalOffset(event.clientX, event.clientY);
			applyZoom(nextScaleRaw, focal, base);
		}

		container.addEventListener('touchstart', onTouchStart, {
			passive: false,
		});
		container.addEventListener('touchmove', onTouchMove, { passive: false });
		container.addEventListener('touchend', onTouchEnd, { passive: false });
		container.addEventListener('touchcancel', onTouchEnd, { passive: false });
		container.addEventListener('wheel', onWheel, { passive: false });
		container.addEventListener('mousedown', onMouseDown);

		return () => {
			container.removeEventListener('touchstart', onTouchStart);
			container.removeEventListener('touchmove', onTouchMove);
			container.removeEventListener('touchend', onTouchEnd);
			container.removeEventListener('touchcancel', onTouchEnd);
			container.removeEventListener('wheel', onWheel);
			container.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('mousemove', onWindowMouseMove);
			window.removeEventListener('mouseup', onWindowMouseUp);
		};
	}, [enableZoom]);

	function allowPress(): boolean {
		if (suppressNextPressRef.current) {
			suppressNextPressRef.current = false;
			return false;
		}

		return zoomStateRef.current.scale <= ZOOM_MIN_SCALE;
	}

	const zoomStyle = {
		'--rbg-zoom-scale': renderState.scale,
		'--rbg-pan-x': `${renderState.panX}px`,
		'--rbg-pan-y': `${renderState.panY}px`,
	} as CSSProperties;

	return { containerRef, imageRef, zoomStyle, allowPress };
}
