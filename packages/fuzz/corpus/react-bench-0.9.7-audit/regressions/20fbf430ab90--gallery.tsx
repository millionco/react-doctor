// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 20fbf430ab90e9e1a65eb31ee7e85aaddf9950c28faf8562ea9a3675dbab0e64
import type { TouchEvent as ReactTouchEvent, WheelEvent as ReactWheelEvent } from 'react';
import {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';

import { DIRECTION_NEXT, DIRECTION_PREV } from '../constants';
import { defaultPhrases } from '../default-phrases';
import type {
	GalleryController,
	GalleryPhoto,
	GalleryPhrases,
} from '../types/gallery';
import { Caption } from './caption';
import { NextButton } from './next-button';
import { Photo } from './photo';
import { PrevButton } from './prev-button';

/**
 * Props for the internal gallery viewport, controls, and caption panel.
 */
interface GalleryProps {
	activePhotoIndex?: number;
	activePhotoPressed?: () => void;
	direction?: string;
	light?: boolean;
	nextButtonPressed?: () => void;
	onActivePhotoIndexChange?: (index: number) => void;
	phrases?: GalleryPhrases;
	photos?: GalleryPhoto[];
	preloadSize?: number;
	prevButtonPressed?: () => void;
	showThumbnails?: boolean;
	wrap?: boolean;
	enableZoom?: boolean;
}

interface TouchInfo {
	screenX: number;
}

interface GalleryState {
	activePhotoIndex: number;
	hidePrevButton: boolean;
	hideNextButton: boolean;
	controlsDisabled: boolean;
	touchStartInfo: TouchInfo | null;
	touchEndInfo: TouchInfo | null;
	touchMoved: boolean;
}

const EMPTY_PHOTOS: GalleryPhoto[] = [];
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;

function getNormalizedActivePhotoIndex(
	activePhotoIndex: number,
	totalPhotos: number,
): number {
	if (totalPhotos === 0) {
		return 0;
	}
	return Math.min(Math.max(activePhotoIndex, 0), totalPhotos - 1);
}

function getWrapControlState(
	activePhotoIndex: number,
	totalPhotos: number,
	wrap: boolean,
) {
	if (wrap || totalPhotos <= 1) {
		return {
			hidePrevButton: false,
			hideNextButton: false,
		};
	}
	return {
		hidePrevButton: activePhotoIndex === 0,
		hideNextButton: activePhotoIndex === totalPhotos - 1,
	};
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(Math.max(v, min), max);
}

function computeRenderedSize(
	naturalW: number,
	naturalH: number,
	viewportW: number,
	viewportH: number,
): { width: number; height: number } {
	if (!naturalW || !naturalH || !viewportW || !viewportH) {
		return { width: viewportW, height: viewportH };
	}
	const naturalAspect = naturalW / naturalH;
	const viewportAspect = viewportW / viewportH;
	if (naturalAspect > viewportAspect) {
		// width constrained
		const width = viewportW;
		const height = width / naturalAspect;
		return { width, height };
	} else {
		const height = viewportH;
		const width = height * naturalAspect;
		return { width, height };
	}
}

const Gallery = forwardRef<GalleryController, GalleryProps>(function Gallery(
	{
		activePhotoIndex = 0,
		activePhotoPressed,
		light = false,
		nextButtonPressed,
		onActivePhotoIndexChange,
		phrases = defaultPhrases,
		photos = EMPTY_PHOTOS,
		preloadSize = 5,
		prevButtonPressed,
		showThumbnails = true,
		wrap = false,
		enableZoom = true,
	},
	ref,
) {
	const [state, setState] = useState<GalleryState>(() => {
		const normalizedActivePhotoIndex = getNormalizedActivePhotoIndex(
			activePhotoIndex,
			photos.length,
		);
		const { hidePrevButton, hideNextButton } = getWrapControlState(
			normalizedActivePhotoIndex,
			photos.length,
			wrap,
		);
		return {
			activePhotoIndex: normalizedActivePhotoIndex,
			hidePrevButton,
			hideNextButton,
			controlsDisabled: true,
			touchStartInfo: null,
			touchEndInfo: null,
			touchMoved: false,
		};
	});

	// zoom/pan state
	const [zoomScale, setZoomScale] = useState(1);
	const [panX, setPanX] = useState(0);
	const [panY, setPanY] = useState(0);
	const zoomScaleRef = useRef(zoomScale);
	const panRef = useRef({ x: panX, y: panY });
	useEffect(() => {
		zoomScaleRef.current = zoomScale;
	}, [zoomScale]);
	useEffect(() => {
		panRef.current = { x: panX, y: panY };
	}, [panX, panY]);

	const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
	const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

	const containerRef = useRef<HTMLDivElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const suppressClickRef = useRef(false);
	const suppressSwipeRef = useRef(false);

	const gestureRef = useRef<{
		pinchStartDist: number;
		pinchStartScale: number;
		pinchStartPan: { x: number; y: number };
		pinchMid: { x: number; y: number };
		dragStart: { x: number; y: number } | null;
		dragStartPan: { x: number; y: number } | null;
		isPinching: boolean;
		isDragging: boolean;
		isMouseDragging: boolean;
		mouseStart: { x: number; y: number } | null;
		mouseStartPan: { x: number; y: number } | null;
	}>({
		pinchStartDist: 0,
		pinchStartScale: 1,
		pinchStartPan: { x: 0, y: 0 },
		pinchMid: { x: 0, y: 0 },
		dragStart: null,
		dragStartPan: null,
		isPinching: false,
		isDragging: false,
		isMouseDragging: false,
		mouseStart: null,
		mouseStartPan: null,
	});

	const resetZoom = useCallback(() => {
		setZoomScale(1);
		setPanX(0);
		setPanY(0);
		zoomScaleRef.current = 1;
		panRef.current = { x: 0, y: 0 };
		gestureRef.current.isPinching = false;
		gestureRef.current.isDragging = false;
		gestureRef.current.isMouseDragging = false;
		gestureRef.current.dragStart = null;
		gestureRef.current.dragStartPan = null;
		gestureRef.current.mouseStart = null;
		gestureRef.current.mouseStartPan = null;
	}, []);

	const getRendered = useCallback(() => {
		const vw = viewportSize.w;
		const vh = viewportSize.h;
		if (!naturalSize) {
			return { width: vw, height: vh };
		}
		return computeRenderedSize(naturalSize.w, naturalSize.h, vw, vh);
	}, [naturalSize, viewportSize]);

	const getMaxPanForScale = useCallback((scale: number, rendered?: { width: number; height: number }, viewport?: { w: number; h: number }) => {
		const r = rendered || getRendered();
		const vp = viewport || viewportSize;
		if (!vp.w || !vp.h) {
			return { x: 0, y: 0 };
		}
		const maxX = Math.max(0, (r.width * scale - vp.w) / 2);
		const maxY = Math.max(0, (r.height * scale - vp.h) / 2);
		return { x: maxX, y: maxY };
	}, [getRendered, viewportSize]);

	const clampPan = useCallback((x: number, y: number, scale: number, rendered?: { width: number; height: number }) => {
		const { x: maxX, y: maxY } = getMaxPanForScale(scale, rendered);
		return {
			x: maxX === 0 ? 0 : clamp(x, -maxX, maxX),
			y: maxY === 0 ? 0 : clamp(y, -maxY, maxY),
		};
	}, [getMaxPanForScale]);

	// measure viewport
	useEffect(() => {
		if (!containerRef.current) return;
		const el = containerRef.current;
		const measure = () => {
			const rect = el.getBoundingClientRect();
			// rect may be 0 in jsdom, fallback to non-zero default to allow logic
			const w = rect.width || el.clientWidth || 0;
			const h = rect.height || el.clientHeight || 0;
			if (w || h) {
				setViewportSize((prev) => {
					if (prev.w === w && prev.h === h) return prev;
					return { w, h };
				});
			}
		};
		measure();
		const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
		if (ro) {
			ro.observe(el);
		} else {
			window.addEventListener('resize', measure);
		}
		return () => {
			if (ro) {
				ro.disconnect();
			} else {
				window.removeEventListener('resize', measure);
			}
		};
	}, [state.activePhotoIndex]);

	// when natural size or viewport changes, re-clamp pan
	useEffect(() => {
		if (zoomScaleRef.current <= 1) {
			// ensure pan is zero
			if (panRef.current.x !== 0 || panRef.current.y !== 0) {
				setPanX(0);
				setPanY(0);
			}
			return;
		}
		const rendered = getRendered();
		const clamped = clampPan(panRef.current.x, panRef.current.y, zoomScaleRef.current, rendered);
		if (clamped.x !== panRef.current.x || clamped.y !== panRef.current.y) {
			setPanX(clamped.x);
			setPanY(clamped.y);
		}
	}, [naturalSize, viewportSize, getRendered, clampPan]);

	// reset zoom on photo change
	useEffect(() => {
		resetZoom();
		setNaturalSize(null);
		// try to read natural size from image element if already loaded
		// will be set via onNaturalSize callback
	}, [state.activePhotoIndex, resetZoom]);

	// reset zoom when enableZoom turned off
	useEffect(() => {
		if (!enableZoom) {
			resetZoom();
		}
	}, [enableZoom, resetZoom]);

	useEffect(() => {
		const normalizedActivePhotoIndex = getNormalizedActivePhotoIndex(
			activePhotoIndex,
			photos.length,
		);
		const { hidePrevButton, hideNextButton } = getWrapControlState(
			normalizedActivePhotoIndex,
			photos.length,
			wrap,
		);

		setState((prevState) => {
			if (
				prevState.activePhotoIndex === normalizedActivePhotoIndex &&
				prevState.hidePrevButton === hidePrevButton &&
				prevState.hideNextButton === hideNextButton
			) {
				return prevState;
			}
			return {
				...prevState,
				activePhotoIndex: normalizedActivePhotoIndex,
				hidePrevButton,
				hideNextButton,
			};
		});
	}, [activePhotoIndex, photos, wrap]);

	useEffect(() => {
		onActivePhotoIndexChange?.(state.activePhotoIndex);
	}, [onActivePhotoIndexChange, state.activePhotoIndex]);

	const getItemByDirection = useCallback(
		(direction: string, activeIndex: number) => {
			if (photos.length === 0) {
				return 0;
			}
			const isNextDirection = direction === DIRECTION_NEXT;
			const isPrevDirection = direction === DIRECTION_PREV;
			const lastItemIndex = photos.length - 1;
			const isGoingToWrap =
				(isPrevDirection && activeIndex === 0) ||
				(isNextDirection && activeIndex === lastItemIndex);

			if (isGoingToWrap && !wrap) {
				return activeIndex;
			}

			const delta = isPrevDirection ? -1 : 1;
			const itemIndex = (activeIndex + delta) % photos.length;
			return itemIndex === -1 ? photos.length - 1 : itemIndex;
		},
		[photos, wrap],
	);

	const move = useCallback(
		(direction: string, index: number | false = false) => {
			// clear zoom immediately to avoid magnified frame on next photo
			setZoomScale(1);
			setPanX(0);
			setPanY(0);
			zoomScaleRef.current = 1;
			panRef.current = { x: 0, y: 0 };
			gestureRef.current.isPinching = false;
			gestureRef.current.isDragging = false;
			gestureRef.current.isMouseDragging = false;
			gestureRef.current.dragStart = null;
			gestureRef.current.dragStartPan = null;
			gestureRef.current.mouseStart = null;
			gestureRef.current.mouseStartPan = null;
			setState((prevState) => {
				const nextElementIndex =
					index !== false
						? index
						: getItemByDirection(direction, prevState.activePhotoIndex);

				const { hidePrevButton, hideNextButton } = getWrapControlState(
					nextElementIndex,
					photos.length,
					wrap,
				);

				return {
					...prevState,
					activePhotoIndex: nextElementIndex,
					hidePrevButton,
					hideNextButton,
				};
			});
		},
		[getItemByDirection, photos.length, wrap],
	);

	const prev = useCallback(() => {
		move(DIRECTION_PREV);
	}, [move]);

	const next = useCallback(() => {
		move(DIRECTION_NEXT);
	}, [move]);

	useImperativeHandle(
		ref,
		() => ({
			prev,
			next,
		}),
		[prev, next],
	);

	const onNextButtonPress = useCallback(() => {
		next();
		nextButtonPressed?.();
	}, [next, nextButtonPressed]);

	const onPrevButtonPress = useCallback(() => {
		prev();
		prevButtonPressed?.();
	}, [prev, prevButtonPressed]);

	const onPhotoLoad = useCallback(() => {
		setState((prevState) => ({ ...prevState, controlsDisabled: false }));
		// attempt to read natural size
		const img = imageRef.current;
		if (img && img.naturalWidth && img.naturalHeight) {
			setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
		}
	}, []);

	const onNaturalSize = useCallback((w: number, h: number) => {
		if (w && h) {
			setNaturalSize({ w, h });
		}
	}, []);

	const onPhotoError = useCallback(() => {
		setState((prevState) => ({ ...prevState, controlsDisabled: false }));
	}, []);

	const onPhotoPress = useCallback(() => {
		if (suppressClickRef.current) {
			suppressClickRef.current = false;
			return;
		}
		if (enableZoom && zoomScaleRef.current > 1.01) {
			// while magnified, block navigation
			return;
		}
		move(DIRECTION_NEXT);
		activePhotoPressed?.();
	}, [activePhotoPressed, move, enableZoom]);

	// wheel zoom
	const onWheel = useCallback((e: ReactWheelEvent) => {
		if (!enableZoom) return;
		// avoid interfering when not focused? always zoom
		const delta = e.deltaY;
		if (delta === 0) return;
		// prevent page scroll
		e.preventDefault();

		const currentScale = zoomScaleRef.current;
		const factor = delta < 0 ? 1.15 : 0.85;
		let newScale = currentScale * factor;
		newScale = clamp(newScale, MIN_ZOOM, MAX_ZOOM);

		const container = containerRef.current;
		if (!container) {
			if (newScale <= 1.01) {
				setZoomScale(1);
				setPanX(0);
				setPanY(0);
			} else {
				setZoomScale(newScale);
			}
			suppressClickRef.current = true;
			suppressSwipeRef.current = true;
			return;
		}
		const rect = container.getBoundingClientRect();
		const vw = viewportSize.w || rect.width;
		const vh = viewportSize.h || rect.height;
		const rendered = naturalSize ? computeRenderedSize(naturalSize.w, naturalSize.h, vw, vh) : { width: vw, height: vh };

		if (newScale <= 1.01) {
			setZoomScale(1);
			setPanX(0);
			setPanY(0);
			zoomScaleRef.current = 1;
			panRef.current = { x: 0, y: 0 };
			suppressClickRef.current = true;
			suppressSwipeRef.current = true;
			return;
		}

		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const cursorOffsetX = e.clientX - centerX;
		const cursorOffsetY = e.clientY - centerY;

		const newPanXRaw = cursorOffsetX - (cursorOffsetX - panRef.current.x) * (newScale / currentScale);
		const newPanYRaw = cursorOffsetY - (cursorOffsetY - panRef.current.y) * (newScale / currentScale);

		const maxX = Math.max(0, (rendered.width * newScale - vw) / 2);
		const maxY = Math.max(0, (rendered.height * newScale - vh) / 2);
		const clampedX = maxX === 0 ? 0 : clamp(newPanXRaw, -maxX, maxX);
		const clampedY = maxY === 0 ? 0 : clamp(newPanYRaw, -maxY, maxY);

		setZoomScale(newScale);
		setPanX(clampedX);
		setPanY(clampedY);
		zoomScaleRef.current = newScale;
		panRef.current = { x: clampedX, y: clampedY };
		suppressClickRef.current = true;
		suppressSwipeRef.current = true;
		// reset suppress after short delay to avoid click
	}, [enableZoom, viewportSize, naturalSize]);

	const getTouchDistance = (t1: { clientX?: number; clientY?: number }, t2: { clientX?: number; clientY?: number }) => {
		const dx = (t1.clientX || 0) - (t2.clientX || 0);
		const dy = (t1.clientY || 0) - (t2.clientY || 0);
		return Math.hypot(dx, dy);
	};

	function getTouchesFromEvent(e: ReactTouchEvent<HTMLButtonElement> | any): any[] {
		const t = (e.touches && e.touches.length ? e.touches : e.targetTouches) || [];
		return t as any[];
	}

	const onTouchStart = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
		const touches = getTouchesFromEvent(event);
		if (enableZoom && touches.length === 2) {
			const t1 = touches[0];
			const t2 = touches[1];
			const dist = getTouchDistance(t1, t2);
			const midX = ((t1.clientX || 0) + (t2.clientX || 0)) / 2;
			const midY = ((t1.clientY || 0) + (t2.clientY || 0)) / 2;
			gestureRef.current.isPinching = true;
			gestureRef.current.pinchStartDist = dist;
			gestureRef.current.pinchStartScale = zoomScaleRef.current;
			gestureRef.current.pinchStartPan = { ...panRef.current };
			gestureRef.current.pinchMid = { x: midX, y: midY };
			gestureRef.current.isDragging = false;
			suppressSwipeRef.current = true;
			setState((prevState) => ({
				...prevState,
				touchStartInfo: null,
				touchEndInfo: null,
			}));
			return;
		}
		if (touches.length === 1) {
			const t = touches[0];
			if (enableZoom && zoomScaleRef.current > 1.01) {
				gestureRef.current.isDragging = true;
				gestureRef.current.dragStart = { x: (t.clientX ?? (t as any).screenX ?? 0), y: (t.clientY ?? (t as any).screenY ?? 0) };
				gestureRef.current.dragStartPan = { ...panRef.current };
				suppressSwipeRef.current = true;
				setState((prevState) => ({
					...prevState,
					touchMoved: false,
					touchStartInfo: null,
					touchEndInfo: null,
				}));
				return;
			}
			// not zoomed, proceed with swipe logic
			setState((prevState) => ({
				...prevState,
				touchStartInfo: { screenX: (t as any).screenX ?? t.clientX },
				touchMoved: false,
				touchEndInfo: null,
			}));
		}
	}, [enableZoom]);

	const onTouchMove = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
		const touches = getTouchesFromEvent(event);
		if (enableZoom && gestureRef.current.isPinching && touches.length === 2) {
			// pinch zoom
			const t1 = touches[0];
			const t2 = touches[1];
			const currDist = getTouchDistance(t1, t2);
			const midX = ((t1.clientX || 0) + (t2.clientX || 0)) / 2;
			const midY = ((t1.clientY || 0) + (t2.clientY || 0)) / 2;
			const startDist = gestureRef.current.pinchStartDist || currDist;
			if (startDist === 0) return;
			let newScale = gestureRef.current.pinchStartScale * (currDist / startDist);
			newScale = clamp(newScale, MIN_ZOOM, MAX_ZOOM);

			const container = containerRef.current;
			if (!container) {
				setZoomScale(newScale);
				return;
			}
			const rect = container.getBoundingClientRect();
			const vw = viewportSize.w || rect.width;
			const vh = viewportSize.h || rect.height;
			const rendered = naturalSize ? computeRenderedSize(naturalSize.w, naturalSize.h, vw, vh) : { width: vw, height: vh };

			if (newScale <= 1.01) {
				setZoomScale(1);
				setPanX(0);
				setPanY(0);
				zoomScaleRef.current = 1;
				panRef.current = { x: 0, y: 0 };
				return;
			}

			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			// use current mid as focal, but also need to account for midpoint shift? Simpler use mid as cursor focal.
			// Use formula with pinchMid? We'll use delta of midpoint relative to start? Use straightforward focal based on current mid and start pan/scale ratio.
			// To keep stable, compute pan based on initial mid focal.
			const initialMid = gestureRef.current.pinchMid;
			const initialMidOffsetX = initialMid.x - centerX;
			const initialMidOffsetY = initialMid.y - centerY;

			// q = (initialMidOffset - startPan)/startScale
			const qX = (initialMidOffsetX - gestureRef.current.pinchStartPan.x) / gestureRef.current.pinchStartScale;
			const qY = (initialMidOffsetY - gestureRef.current.pinchStartPan.y) / gestureRef.current.pinchStartScale;

			const currMidOffsetX = midX - centerX;
			const currMidOffsetY = midY - centerY;

			// We want image point q to map to current mid position
			const newPanXRaw = currMidOffsetX - qX * newScale;
			const newPanYRaw = currMidOffsetY - qY * newScale;

			const maxX = Math.max(0, (rendered.width * newScale - vw) / 2);
			const maxY = Math.max(0, (rendered.height * newScale - vh) / 2);
			const clampedX = maxX === 0 ? 0 : clamp(newPanXRaw, -maxX, maxX);
			const clampedY = maxY === 0 ? 0 : clamp(newPanYRaw, -maxY, maxY);

			setZoomScale(newScale);
			setPanX(clampedX);
			setPanY(clampedY);
			zoomScaleRef.current = newScale;
			panRef.current = { x: clampedX, y: clampedY };
			suppressClickRef.current = true;
			suppressSwipeRef.current = true;
			return;
		}
		if (enableZoom && gestureRef.current.isDragging && touches.length === 1) {
			const t = touches[0];
			const start = gestureRef.current.dragStart;
			const startPan = gestureRef.current.dragStartPan;
			if (!start || !startPan) return;
			const cx = (t.clientX ?? (t as any).screenX ?? 0);
			const cy = (t.clientY ?? (t as any).screenY ?? 0);
			const dx = cx - start.x;
			const dy = cy - start.y;

			const container = containerRef.current;
			let rendered = { width: viewportSize.w, height: viewportSize.h };
			if (container) {
				const vw = viewportSize.w || container.getBoundingClientRect().width;
				const vh = viewportSize.h || container.getBoundingClientRect().height;
				rendered = naturalSize ? computeRenderedSize(naturalSize.w, naturalSize.h, vw, vh) : { width: vw, height: vh };
			}
			const scale = zoomScaleRef.current;
			const rawX = startPan.x + dx;
			const rawY = startPan.y + dy;
			const vw = viewportSize.w || rendered.width;
			const vh = viewportSize.h || rendered.height;
			const maxX = Math.max(0, (rendered.width * scale - vw) / 2);
			const maxY = Math.max(0, (rendered.height * scale - vh) / 2);
			const clampedX = maxX === 0 ? 0 : clamp(rawX, -maxX, maxX);
			const clampedY = maxY === 0 ? 0 : clamp(rawY, -maxY, maxY);
			setPanX(clampedX);
			setPanY(clampedY);
			panRef.current = { x: clampedX, y: clampedY };
			suppressClickRef.current = true;
			suppressSwipeRef.current = true;
			return;
		}
		// swipe path
		if (touches.length === 1 && !gestureRef.current.isDragging && !gestureRef.current.isPinching) {
			const t = touches[0];
			setState((prevState) => ({
				...prevState,
				touchMoved: true,
				touchEndInfo: { screenX: (t as any).screenX ?? t.clientX } as any,
			}));
		}
	}, [enableZoom, viewportSize, naturalSize]);

	const onTouchEnd = useCallback(() => {
		if (gestureRef.current.isPinching) {
			gestureRef.current.isPinching = false;
			// after pinch, if scale <=1 reset pan
			if (zoomScaleRef.current <= 1.01) {
				setZoomScale(1);
				setPanX(0);
				setPanY(0);
			}
			// suppress click for next tap
			suppressClickRef.current = true;
			suppressSwipeRef.current = true;
			return;
		}
		if (gestureRef.current.isDragging) {
			gestureRef.current.isDragging = false;
			gestureRef.current.dragStart = null;
			gestureRef.current.dragStartPan = null;
			suppressClickRef.current = true;
			suppressSwipeRef.current = true;
			// do not trigger swipe navigation
			setState((prevState) => ({
				...prevState,
				touchMoved: false,
				touchStartInfo: null,
				touchEndInfo: null,
			}));
			return;
		}
		setState((prevState) => {
			const { touchStartInfo, touchEndInfo, touchMoved } = prevState;
			if (suppressSwipeRef.current) {
				suppressSwipeRef.current = false;
				return {
					...prevState,
					touchMoved: false,
					touchStartInfo: null,
					touchEndInfo: null,
				};
			}
			if (enableZoom && zoomScaleRef.current > 1.01) {
				return {
					...prevState,
					touchMoved: false,
					touchStartInfo: null,
					touchEndInfo: null,
				};
			}
			if (touchMoved && touchStartInfo && touchEndInfo) {
				if (touchStartInfo.screenX < touchEndInfo.screenX) {
					onPrevButtonPress();
				} else if (touchStartInfo.screenX > touchEndInfo.screenX) {
					onNextButtonPress();
				}
			}
			return {
				...prevState,
				touchMoved: false,
				touchStartInfo: null,
				touchEndInfo: null,
			};
		});
	}, [onNextButtonPress, onPrevButtonPress, enableZoom]);

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		if (!enableZoom) return;
		if (zoomScaleRef.current <= 1.01) return;
		if (e.button !== 0) return;
		gestureRef.current.isMouseDragging = true;
		gestureRef.current.mouseStart = { x: e.clientX, y: e.clientY };
		gestureRef.current.mouseStartPan = { ...panRef.current };
		// prevent text selection
		e.preventDefault();
	}, [enableZoom]);

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!gestureRef.current.isMouseDragging) return;
			const start = gestureRef.current.mouseStart;
			const startPan = gestureRef.current.mouseStartPan;
			if (!start || !startPan) return;
			const dx = e.clientX - start.x;
			const dy = e.clientY - start.y;
			const container = containerRef.current;
			let rendered = { width: viewportSize.w, height: viewportSize.h };
			if (container) {
				const vw = viewportSize.w || container.getBoundingClientRect().width;
				const vh = viewportSize.h || container.getBoundingClientRect().height;
				rendered = naturalSize ? computeRenderedSize(naturalSize.w, naturalSize.h, vw, vh) : { width: vw, height: vh };
			}
			const scale = zoomScaleRef.current;
			const rawX = startPan.x + dx;
			const rawY = startPan.y + dy;
			const vw = viewportSize.w || rendered.width;
			const vh = viewportSize.h || rendered.height;
			const maxX = Math.max(0, (rendered.width * scale - vw) / 2);
			const maxY = Math.max(0, (rendered.height * scale - vh) / 2);
			const clampedX = maxX === 0 ? 0 : clamp(rawX, -maxX, maxX);
			const clampedY = maxY === 0 ? 0 : clamp(rawY, -maxY, maxY);
			setPanX(clampedX);
			setPanY(clampedY);
			panRef.current = { x: clampedX, y: clampedY };
			suppressClickRef.current = true;
		};
		const handleMouseUp = () => {
			if (gestureRef.current.isMouseDragging) {
				gestureRef.current.isMouseDragging = false;
				gestureRef.current.mouseStart = null;
				gestureRef.current.mouseStartPan = null;
				// keep suppressClick for next click
				setTimeout(() => {
					// keep suppressed for the click event that follows mouseup
				}, 0);
			}
		};
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [viewportSize, naturalSize]);

	const to = useCallback(
		(index: number) => {
			if (
				index > photos.length - 1 ||
				index < 0 ||
				state.activePhotoIndex === index
			) {
				return;
			}
			const direction =
				index > state.activePhotoIndex ? DIRECTION_NEXT : DIRECTION_PREV;
			move(direction, index);
		},
		[move, photos.length, state.activePhotoIndex],
	);

	const onThumbnailPress = useCallback(
		(index: number) => {
			to(index);
		},
		[to],
	);

	const controls = useMemo(() => {
		const hasMultiplePhotos = photos.length > 1;
		if (!hasMultiplePhotos) {
			return null;
		}
		const ui = [];
		if (!state.hidePrevButton) {
			ui.push(
				<PrevButton
					key=".prevControl"
					disabled={state.controlsDisabled}
					onPress={onPrevButtonPress}
					light={light}
				/>,
			);
		}
		if (!state.hideNextButton) {
			ui.push(
				<NextButton
					key=".nextControl"
					disabled={state.controlsDisabled}
					onPress={onNextButtonPress}
					light={light}
				/>,
			);
		}
		return ui;
	}, [
		light,
		onNextButtonPress,
		onPrevButtonPress,
		photos.length,
		state.controlsDisabled,
		state.hideNextButton,
		state.hidePrevButton,
	]);

	const galleryModalPreloadPhotos = useMemo(() => {
		let counter = 1;
		let index = state.activePhotoIndex;
		const preloadPhotos = [];

		while (index < photos.length && counter <= preloadSize) {
			const photo = photos[index];
			preloadPhotos.push(
				<img key={photo.photo} alt={photo.photo} src={photo.photo} />,
			);
			index += 1;
			counter += 1;
		}

		return preloadPhotos;
	}, [photos, preloadSize, state.activePhotoIndex]);

	const hasPhotos = photos.length > 0;
	const current = photos[state.activePhotoIndex];
	const { noPhotosProvided: emptyMessage } = phrases;

	// style for image – effective values respect enableZoom to avoid delayed magnified frame
	const effectiveScale = enableZoom ? zoomScale : 1;
	const effectivePanX = enableZoom ? panX : 0;
	const effectivePanY = enableZoom ? panY : 0;
	const imageStyle: any = {
		top: '50%',
		left: '50%',
		right: 'auto',
		bottom: 'auto',
		transform: `translate(-50%, -50%) translate(${effectivePanX}px, ${effectivePanY}px) scale(${effectiveScale})`,
		transformOrigin: 'center center',
		'--rbg-zoom-scale': `${effectiveScale}`,
		'--rbg-scale': `${effectiveScale}`,
		'--rbg-photo-scale': `${effectiveScale}`,
		'--rbg-pan-x': `${effectivePanX}px`,
		'--rbg-pan-y': `${effectivePanY}px`,
		'--rbg-photo-pan-x': `${effectivePanX}px`,
		'--rbg-photo-pan-y': `${effectivePanY}px`,
	};

	return (
		<div className="gallery">
			<div className="gallery-modal--preload">{galleryModalPreloadPhotos}</div>
			<div className="gallery-main">
				{controls}
				<div className="gallery-photos">
					{hasPhotos ? (
						<div className="gallery-photo">
							<div className="gallery-photo--current" ref={containerRef} onWheel={onWheel} onMouseDown={onMouseDown}>
								<Photo
									photo={current}
									onLoad={onPhotoLoad}
									onError={onPhotoError}
									onPress={onPhotoPress}
									onTouchStart={onTouchStart}
									onTouchMove={onTouchMove}
									onTouchEnd={onTouchEnd}
									style={imageStyle}
									imageRef={imageRef}
									onNaturalSize={onNaturalSize}
								/>
							</div>
						</div>
					) : (
						<div className="gallery-empty">{emptyMessage}</div>
					)}
				</div>
			</div>
			{showThumbnails && current && (
				<Caption
					phrases={phrases}
					current={state.activePhotoIndex}
					photos={photos}
					onPress={onThumbnailPress}
				/>
			)}
		</div>
	);
});

const MemoizedGallery = memo(Gallery);

export { MemoizedGallery as Gallery };
