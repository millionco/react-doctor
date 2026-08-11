// rule: effect-needs-cleanup
// file-path: src/components/gallery.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 89fbe92123afb9c44d3d11494ce0ff286bb3bd8310b347f92017e301da31fba4
import type {
	CSSProperties,
	PointerEvent as ReactPointerEvent,
	TouchEvent as ReactTouchEvent,
	WheelEvent as ReactWheelEvent,
} from 'react';
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
import {
	ZOOM_MIN_SCALE,
	ZOOM_PAN_THRESHOLD,
	ZOOM_PINCH_WHEEL_STEP,
	ZOOM_WHEEL_STEP,
} from '../constants';
import { defaultPhrases } from '../default-phrases';
import type {
	GalleryController,
	GalleryPhoto,
	GalleryPhrases,
} from '../types/gallery';
import {
	clampPan,
	clampScale,
	distance,
	midpoint,
} from '../utils/zoom';
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
	enableZoom?: boolean;
	light?: boolean;
	nextButtonPressed?: () => void;
	onActivePhotoIndexChange?: (index: number) => void;
	phrases?: GalleryPhrases;
	photos?: GalleryPhoto[];
	preloadSize?: number;
	prevButtonPressed?: () => void;
	showThumbnails?: boolean;
	wrap?: boolean;
}

interface TouchInfo {
	screenX: number;
}

interface NaturalSize {
	width: number;
	height: number;
}

interface PinchState {
	startDistance: number;
	startScale: number;
	startPanX: number;
	startPanY: number;
	startMidX: number;
	startMidY: number;
}

interface GalleryState {
	activePhotoIndex: number;
	hidePrevButton: boolean;
	hideNextButton: boolean;
	controlsDisabled: boolean;
	touchStartInfo: TouchInfo | null;
	touchEndInfo: TouchInfo | null;
	touchMoved: boolean;
	zoomScale: number;
	zoomPanX: number;
	zoomPanY: number;
	naturalSize: NaturalSize;
}

const EMPTY_PHOTOS: GalleryPhoto[] = [];
const EMPTY_NATURAL_SIZE: NaturalSize = { width: 0, height: 0 };

const ZOOM_STYLE_BASE = {
	'--rbg-scale': 1,
	'--rbg-zoom-scale': 1,
	'--rbg-photo-scale': 1,
	'--rbg-pan-x': '0px',
	'--rbg-pan-y': '0px',
	'--rbg-photo-pan-x': '0px',
	'--rbg-photo-pan-y': '0px',
} as CSSProperties;

/**
 * Clamps a requested active index to available photo bounds.
 */
function getNormalizedActivePhotoIndex(
	activePhotoIndex: number,
	totalPhotos: number,
): number {
	if (totalPhotos === 0) {
		return 0;
	}

	return Math.min(Math.max(activePhotoIndex, 0), totalPhotos - 1);
}

/**
 * Computes control visibility based on boundary and wrap mode.
 */
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

/**
 * Reads a touch point (client coordinates) from a `TouchList`-like value.
 */
function touchPoint(touch?: { clientX?: number; clientY?: number } | null) {
	return {
		x: touch?.clientX ?? 0,
		y: touch?.clientY ?? 0,
	};
}

/**
 * Core carousel component responsible for image navigation and touch gestures.
 */
const Gallery = forwardRef<GalleryController, GalleryProps>(function Gallery(
	{
		activePhotoIndex = 0,
		activePhotoPressed,
		enableZoom = true,
		light = false,
		nextButtonPressed,
		onActivePhotoIndexChange,
		phrases = defaultPhrases,
		photos = EMPTY_PHOTOS,
		preloadSize = 5,
		prevButtonPressed,
		showThumbnails = true,
		wrap = false,
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
			zoomScale: ZOOM_MIN_SCALE,
			zoomPanX: 0,
			zoomPanY: 0,
			naturalSize: EMPTY_NATURAL_SIZE,
		};
	});

	const viewportRef = useRef<HTMLDivElement | null>(null);
	const surfaceRef = useRef<HTMLButtonElement | null>(null);

	// `enableZoom` is read inside a native (non-passive) wheel listener that is
	// bound once per surface node, so it is mirrored into a ref to always observe
	// the latest value without re-binding the listener.
	const enableZoomRef = useRef(enableZoom);
	enableZoomRef.current = enableZoom;

	// Gesture tracking refs. Refs (not state) are used because they are read
	// inside event handlers that must observe the latest values synchronously
	// without triggering a re-render on every pointer move.
	const draggingRef = useRef(false);
	const panningRef = useRef(false);
	const movedRef = useRef(false);
	const pinchingRef = useRef(false);
	const pinchRef = useRef<PinchState | null>(null);
	const pointerStartRef = useRef({
		x: 0,
		y: 0,
		panX: 0,
		panY: 0,
	});
	const wheelHandlerRef = useRef<(event: ReactWheelEvent) => void>(
		() => {},
	);

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

			const indexChanged =
				prevState.activePhotoIndex !== normalizedActivePhotoIndex;
			if (indexChanged) {
				draggingRef.current = false;
				panningRef.current = false;
				pinchingRef.current = false;
				pinchRef.current = null;
				movedRef.current = false;
			}

			return {
				...prevState,
				activePhotoIndex: normalizedActivePhotoIndex,
				hidePrevButton,
				hideNextButton,
				// Changing the active photo clears magnification immediately so a
				// magnified frame is never left behind on the new photo.
				zoomScale: ZOOM_MIN_SCALE,
				zoomPanX: 0,
				zoomPanY: 0,
				naturalSize: indexChanged
					? EMPTY_NATURAL_SIZE
					: prevState.naturalSize,
			};
		});
	}, [activePhotoIndex, photos, wrap]);

	// When zoom is turned off, reset magnification synchronously so the image
	// presents unmagnified on the same frame (no delayed magnified frame).
	useEffect(() => {
		if (enableZoom) {
			return;
		}

		setState((prevState) => {
			if (
				prevState.zoomScale === ZOOM_MIN_SCALE &&
				prevState.zoomPanX === 0 &&
				prevState.zoomPanY === 0
			) {
				return prevState;
			}

			draggingRef.current = false;
				panningRef.current = false;
				pinchingRef.current = false;
				pinchRef.current = null;
				movedRef.current = false;
				return {
				...prevState,
				zoomScale: ZOOM_MIN_SCALE,
				zoomPanX: 0,
				zoomPanY: 0,
			};
		});
	}, [enableZoom]);

	// Re-clamp pan when the viewport size changes (window resize) so a changed
	// viewport never exposes empty background beyond the rendered image.
	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		const onResize = () => {
			setState((prevState) => {
				if (prevState.zoomScale <= ZOOM_MIN_SCALE) {
					return prevState;
				}

				const viewport = viewportRef.current?.getBoundingClientRect();
				if (!viewport) {
					return prevState;
				}

				const { x, y } = clampPan(
					prevState.zoomPanX,
					prevState.zoomPanY,
					prevState.zoomScale,
					prevState.naturalSize.width,
					prevState.naturalSize.height,
					viewport.width,
					viewport.height,
				);

				if (
					x === prevState.zoomPanX &&
					y === prevState.zoomPanY
				) {
					return prevState;
				}

				return {
					...prevState,
					zoomPanX: x,
					zoomPanY: y,
				};
			});
		};

		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

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
			// Navigating clears any in-progress gesture state so a pan/pinch that
			// was in flight cannot suppress the next interaction on the new photo.
			draggingRef.current = false;
			panningRef.current = false;
			pinchingRef.current = false;
			pinchRef.current = null;
			movedRef.current = false;
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

				const indexChanged =
					prevState.activePhotoIndex !== nextElementIndex;

				return {
					...prevState,
					activePhotoIndex: nextElementIndex,
					hidePrevButton,
					hideNextButton,
					// Navigating to another photo clears magnification immediately.
					zoomScale: ZOOM_MIN_SCALE,
					zoomPanX: 0,
					zoomPanY: 0,
					naturalSize: indexChanged
						? EMPTY_NATURAL_SIZE
						: prevState.naturalSize,
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

	const onPhotoLoad = useCallback(
		(event: { currentTarget?: { naturalWidth?: number; naturalHeight?: number } }) => {
			const target = event.currentTarget;
			const width = target?.naturalWidth ?? 0;
			const height = target?.naturalHeight ?? 0;
			setState((prevState) => ({
				...prevState,
				controlsDisabled: false,
				naturalSize: { width, height },
			}));
		},
		[],
	);

	const onPhotoError = useCallback(() => {
		setState((prevState) => ({
			...prevState,
			controlsDisabled: false,
			naturalSize: EMPTY_NATURAL_SIZE,
		}));
	}, []);

	const isMagnified = state.zoomScale > ZOOM_MIN_SCALE;

	// While magnified (including after a pinch or wheel zoom) click and swipe
	// must not navigate to another photo. A completed pan/pinch also suppresses
	// the next click so an accidental tap does not advance the gallery.
	const onPhotoPress = useCallback(() => {
		if (!enableZoom) {
			move(DIRECTION_NEXT);
			activePhotoPressed?.();
			return;
		}

		if (isMagnified || movedRef.current || pinchingRef.current) {
			movedRef.current = false;
			return;
		}

		move(DIRECTION_NEXT);
		activePhotoPressed?.();
	}, [activePhotoPressed, enableZoom, isMagnified, move]);

	const readViewport = useCallback(() => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!rect) {
			return { width: 0, height: 0, left: 0, top: 0 };
		}
		return {
			width: rect.width,
			height: rect.height,
			left: rect.left,
			top: rect.top,
		};
	}, []);

	/**
	 * Applies a new scale + pan, clamping the pan to the rendered image bounds
	 * for the new scale (so focal wheel zoom at an off-center point and pinch
	 * zoom never expose empty background).
	 */
	const applyZoom = useCallback(
		(nextScale: number, nextPanX: number, nextPanY: number) => {
			const scale = clampScale(nextScale);
			const viewport = readViewport();
			const { x, y } = clampPan(
				nextPanX,
				nextPanY,
				scale,
				state.naturalSize.width,
				state.naturalSize.height,
				viewport.width,
				viewport.height,
			);

			// Returning to the unmagnified state clears any pending gesture-
			// suppression flag so subsequent clicks/swipes navigate normally again.
			if (scale <= ZOOM_MIN_SCALE) {
				movedRef.current = false;
			}

			setState((prevState) => {
				if (
					prevState.zoomScale === scale &&
					prevState.zoomPanX === x &&
					prevState.zoomPanY === y
				) {
					return prevState;
				}
				return {
					...prevState,
					zoomScale: scale,
					zoomPanX: x,
					zoomPanY: y,
				};
			});
		},
		[readViewport, state.naturalSize.height, state.naturalSize.width],
	);

	// ─── Wheel zoom (focal) ────────────────────────────────────────────────
	// React attaches `wheel` as a passive listener, so `preventDefault` would
	// be ignored. A native non-passive listener is attached to the photo
	// surface to cancel the browser scroll/zoom default; the actual zoom logic
	// runs here via a ref that always closes over the latest state.
	const handleWheel = useCallback(
		(event: ReactWheelEvent) => {
			if (!enableZoom) {
				return;
			}

			const step = event.ctrlKey ? ZOOM_PINCH_WHEEL_STEP : ZOOM_WHEEL_STEP;
			const factor = Math.exp(-event.deltaY * step);
			const nextScale = clampScale(state.zoomScale * factor);
			if (nextScale === state.zoomScale && state.zoomScale === ZOOM_MIN_SCALE) {
				return;
			}

			const viewport = readViewport();
			const cursorRelX =
				(event.clientX ?? 0) - (viewport.left + viewport.width / 2);
			const cursorRelY =
				(event.clientY ?? 0) - (viewport.top + viewport.height / 2);
			const ratio =
				state.zoomScale > 0 ? nextScale / state.zoomScale : 1;
			const nextPanX =
				state.zoomPanX * ratio + cursorRelX * (1 - ratio);
			const nextPanY =
				state.zoomPanY * ratio + cursorRelY * (1 - ratio);

			applyZoom(nextScale, nextPanX, nextPanY);
		},
		[
			applyZoom,
			enableZoom,
			readViewport,
			state.zoomPanX,
			state.zoomPanY,
			state.zoomScale,
		],
	);

	wheelHandlerRef.current = handleWheel;

	// Native, non-passive wheel listener bound via a callback ref so the browser
	// scroll/page-zoom default can be cancelled and so the listener follows the
	// surface node across mounts (for example when photos go from empty to
	// populated). The zoom logic itself runs through `wheelHandlerRef`, which
	// always closes over the latest state.
	const handleNativeWheel = useCallback((event: WheelEvent) => {
		if (!enableZoomRef.current) {
			return;
		}
		event.preventDefault();
		wheelHandlerRef.current?.(event as unknown as ReactWheelEvent);
	}, []);

	const setSurfaceRef = useCallback(
		(node: HTMLButtonElement | null) => {
			if (surfaceRef.current && surfaceRef.current !== node) {
				surfaceRef.current.removeEventListener('wheel', handleNativeWheel);
			}
			surfaceRef.current = node;
			if (node) {
				node.addEventListener('wheel', handleNativeWheel, { passive: false });
			}
		},
		[handleNativeWheel],
	);

	// ─── Pointer drag pan (mouse + single-finger touch) ─────────────────────
	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			if (!enableZoom || pinchingRef.current) {
				return;
			}
			// Only pan while magnified; when unmagnified the surface falls back to
			// click/swipe navigation.
			if (state.zoomScale <= ZOOM_MIN_SCALE) {
				return;
			}

			draggingRef.current = true;
			panningRef.current = false;
			movedRef.current = false;
			pointerStartRef.current = {
				x: event.clientX,
				y: event.clientY,
				panX: state.zoomPanX,
				panY: state.zoomPanY,
			};

			if (typeof event.pointerId === 'number') {
				event.currentTarget.setPointerCapture?.(event.pointerId);
			}
		},
		[enableZoom, state.zoomPanX, state.zoomPanY, state.zoomScale],
	);

	const onPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			if (!draggingRef.current) {
				return;
			}

			const dx = event.clientX - pointerStartRef.current.x;
			const dy = event.clientY - pointerStartRef.current.y;

			if (
				!panningRef.current &&
				(Math.abs(dx) > ZOOM_PAN_THRESHOLD ||
					Math.abs(dy) > ZOOM_PAN_THRESHOLD)
			) {
				panningRef.current = true;
				movedRef.current = true;
			}

			if (!panningRef.current) {
				return;
			}

			applyZoom(
				state.zoomScale,
				pointerStartRef.current.panX + dx,
				pointerStartRef.current.panY + dy,
			);
		},
		[applyZoom, state.zoomScale],
	);

	const endPointerPan = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			if (!draggingRef.current) {
				return;
			}
			draggingRef.current = false;
			panningRef.current = false;

			if (typeof event.pointerId === 'number') {
				event.currentTarget.releasePointerCapture?.(event.pointerId);
			}
		},
		[],
	);

	const onPointerUp = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			endPointerPan(event);
		},
		[endPointerPan],
	);

	// ─── Touch: swipe navigation (when unmagnified) + pinch zoom ─────────────
	const onTouchStart = useCallback(
		(event: ReactTouchEvent<HTMLButtonElement>) => {
			const touches = event.targetTouches;
			if (enableZoom && touches && touches.length >= 2) {
				const a = touchPoint(touches[0]);
				const b = touchPoint(touches[1]);
				const mid = midpoint(a, b);
				const viewport = readViewport();
				pinchRef.current = {
					startDistance: distance(a, b),
					startScale: state.zoomScale,
					startPanX: state.zoomPanX,
					startPanY: state.zoomPanY,
					startMidX: mid.x - (viewport.left + viewport.width / 2),
					startMidY: mid.y - (viewport.top + viewport.height / 2),
				};
				pinchingRef.current = true;
				movedRef.current = true;
				return;
			}

			setState((prevState) => ({
				...prevState,
				touchStartInfo: touches?.[0]
					? { screenX: touches[0].screenX }
					: null,
			}));
		},
		[enableZoom, readViewport, state.zoomPanX, state.zoomPanY, state.zoomScale],
	);

	const onTouchMove = useCallback(
		(event: ReactTouchEvent<HTMLButtonElement>) => {
			const touches = event.targetTouches;

			if (pinchingRef.current && pinchRef.current && touches) {
				if (touches.length < 2) {
					return;
				}
				const a = touchPoint(touches[0]);
				const b = touchPoint(touches[1]);
				const mid = midpoint(a, b);
				const viewport = readViewport();
				const midRelX = mid.x - (viewport.left + viewport.width / 2);
				const midRelY = mid.y - (viewport.top + viewport.height / 2);
				const ratio =
					pinchRef.current.startDistance > 0
						? distance(a, b) / pinchRef.current.startDistance
						: 1;
				const nextScale = clampScale(pinchRef.current.startScale * ratio);
				const ratioEff =
					pinchRef.current.startScale > 0
						? nextScale / pinchRef.current.startScale
						: 1;
				// Pinch combines focal zoom with two-finger pan: the image point
				// under the start midpoint stays under the current midpoint.
				const nextPanX =
					pinchRef.current.startPanX * ratioEff +
					midRelX -
					pinchRef.current.startMidX * ratioEff;
				const nextPanY =
					pinchRef.current.startPanY * ratioEff +
					midRelY -
					pinchRef.current.startMidY * ratioEff;
				applyZoom(nextScale, nextPanX, nextPanY);
				return;
			}

			setState((prevState) => ({
				...prevState,
				touchMoved: true,
				touchEndInfo: touches?.[0]
					? { screenX: touches[0].screenX }
					: null,
			}));
		},
		[applyZoom, readViewport],
	);

	const onTouchEnd = useCallback(
		(event: ReactTouchEvent<HTMLButtonElement>) => {
			const touches = event.targetTouches;

			if (pinchingRef.current) {
				if (!touches || touches.length === 0) {
					pinchingRef.current = false;
					pinchRef.current = null;
				}
				setState((prevState) => ({ ...prevState, touchMoved: false }));
				return;
			}

			setState((prevState) => {
				// While magnified, touch drag pans (handled by pointer events) and
				// must not navigate to another photo.
				if (prevState.zoomScale > ZOOM_MIN_SCALE) {
					return { ...prevState, touchMoved: false };
				}

				// A pan/pinch gesture just ended; suppress the trailing swipe.
				if (movedRef.current) {
					return { ...prevState, touchMoved: false };
				}

				const { touchStartInfo, touchEndInfo, touchMoved } = prevState;
				if (touchMoved && touchStartInfo && touchEndInfo) {
					if (touchStartInfo.screenX < touchEndInfo.screenX) {
						onPrevButtonPress();
					} else if (touchStartInfo.screenX > touchEndInfo.screenX) {
						onNextButtonPress();
					}
				}

				return { ...prevState, touchMoved: false };
			});
		},
		[onNextButtonPress, onPrevButtonPress],
	);

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

	// Effective transform values: when zoom is disabled the image is always
	// unmagnified on the same frame (no delayed magnified frame).
	const effectiveScale = enableZoom ? state.zoomScale : ZOOM_MIN_SCALE;
	const effectivePanX = enableZoom ? state.zoomPanX : 0;
	const effectivePanY = enableZoom ? state.zoomPanY : 0;

	const photoStyle = {
		...ZOOM_STYLE_BASE,
		'--rbg-scale': effectiveScale,
		'--rbg-zoom-scale': effectiveScale,
		'--rbg-photo-scale': effectiveScale,
		'--rbg-pan-x': `${effectivePanX}px`,
		'--rbg-pan-y': `${effectivePanY}px`,
		'--rbg-photo-pan-x': `${effectivePanX}px`,
		'--rbg-photo-pan-y': `${effectivePanY}px`,
	} as CSSProperties;

	const hasPhotos = photos.length > 0;
	const current = photos[state.activePhotoIndex];
	const { noPhotosProvided: emptyMessage } = phrases;

	return (
		<div className="gallery">
			<div className="gallery-modal--preload">{galleryModalPreloadPhotos}</div>
			<div className="gallery-main">
				{controls}
				<div className="gallery-photos">
					{hasPhotos ? (
						<div className="gallery-photo">
							<div className="gallery-photo--current" ref={viewportRef}>
								<Photo
									photo={current}
									onLoad={onPhotoLoad}
									onError={onPhotoError}
									onPress={onPhotoPress}
									onTouchStart={onTouchStart}
									onTouchMove={onTouchMove}
									onTouchEnd={onTouchEnd}
									onPointerDown={onPointerDown}
									onPointerMove={onPointerMove}
									onPointerUp={onPointerUp}
									onPointerCancel={endPointerPan}
									style={photoStyle}
									zoomable={enableZoom}
									magnified={isMagnified}
									surfaceRef={setSurfaceRef}
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
