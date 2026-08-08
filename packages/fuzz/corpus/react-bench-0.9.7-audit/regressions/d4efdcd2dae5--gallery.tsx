// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit d4efdcd2dae58b970cdef97881ec32c40a2122e2052621745b6a05d2364b1ba5
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
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

import {
	DIRECTION_NEXT,
	DIRECTION_PREV,
	MAX_ZOOM_SCALE,
	MIN_ZOOM_SCALE,
	PAN_DRAG_THRESHOLD,
	WHEEL_ZOOM_SENSITIVITY,
} from '../constants';
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
	/** Enables wheel/pinch zoom and drag panning on the active photo. */
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

interface GalleryState {
	activePhotoIndex: number;
	hidePrevButton: boolean;
	hideNextButton: boolean;
	controlsDisabled: boolean;
}

/** Inline style shape carrying the zoom/pan CSS custom properties. */
type ZoomStyle = CSSProperties & {
	'--rbg-scale'?: number | string;
	'--rbg-zoom-scale'?: number | string;
	'--rbg-photo-scale'?: number | string;
	'--rbg-pan-x'?: string;
	'--rbg-pan-y'?: string;
	'--rbg-photo-pan-x'?: string;
	'--rbg-photo-pan-y'?: string;
};

const EMPTY_PHOTOS: GalleryPhoto[] = [];

/**
 * Clamps a value to the inclusive `[min, max]` range.
 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Computes the letterboxed (aspect-fit) rendered size of the active photo
 * inside its viewport from the image's natural dimensions.
 */
function getRenderedSize(
	naturalWidth: number,
	naturalHeight: number,
	viewportWidth: number,
	viewportHeight: number,
): { width: number; height: number } {
	if (
		naturalWidth <= 0 ||
		naturalHeight <= 0 ||
		viewportWidth <= 0 ||
		viewportHeight <= 0
	) {
		return { width: 0, height: 0 };
	}

	const fitScale = Math.min(
		viewportWidth / naturalWidth,
		viewportHeight / naturalHeight,
		1,
	);
	return {
		width: naturalWidth * fitScale,
		height: naturalHeight * fitScale,
	};
}

/**
 * Computes the Euclidean distance between two touch points.
 */
function touchDistance(a: Touch, b: Touch): number {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Clamps control visibility based on boundary and wrap mode.
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
 * Normalizes a requested active index to available photo bounds.
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
 * Core carousel component responsible for image navigation, touch gestures,
 * and the gesture-driven zoom/pan lightbox surface.
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
		};
	});

	const [zoomScale, setZoomScale] = useState(1);
	const [panX, setPanX] = useState(0);
	const [panY, setPanY] = useState(0);
	const [isDragging, setIsDragging] = useState(false);

	// Viewport = the photo button; the letterboxed `<img>` lives inside it.
	const viewportRef = useRef<HTMLButtonElement | null>(null);

	// Mirror of the live zoom state so native event handlers (attached once)
	// always read fresh values without re-closing on every render.
	const zoomRef = useRef({ scale: 1, panX: 0, panY: 0, enabled: enableZoom });
	const isMagnifiedRef = useRef(false);

	// Transient gesture bookkeeping that must not trigger re-renders.
	const gestureRef = useRef({
		// touch swipe / single-finger pan
		touchStartX: 0,
		touchStartY: 0,
		touchLastX: 0,
		touchLastY: 0,
		touchMoved: false,
		panning: false,
		// pinch
		pinchActive: false,
		pinchInitialDistance: 0,
		pinchInitialScale: 1,
		pinchInitialPanX: 0,
		pinchInitialPanY: 0,
		pinchFocalX: 0,
		pinchFocalY: 0,
		// mouse drag pan
		mouseLastX: 0,
		mouseLastY: 0,
		mouseMoved: false,
		// click suppression after a drag
		suppressClick: false,
	});

	const isMagnified = zoomScale > 1;
	isMagnifiedRef.current = isMagnified;
	zoomRef.current = {
		scale: zoomScale,
		panX,
		panY,
		enabled: enableZoom,
	};

	/**
	 * Reads the live viewport + image metrics used to clamp panning.
	 */
	const getMetrics = useCallback(() => {
		const viewport = viewportRef.current;
		const image = viewport?.querySelector<HTMLImageElement>('img.photo');
		if (!viewport || !image) {
			return null;
		}

		const naturalWidth = image.naturalWidth || 0;
		const naturalHeight = image.naturalHeight || 0;
		const viewportWidth = viewport.clientWidth || 0;
		const viewportHeight = viewport.clientHeight || 0;
		const { width: renderedWidth, height: renderedHeight } = getRenderedSize(
			naturalWidth,
			naturalHeight,
			viewportWidth,
			viewportHeight,
		);

		return {
			naturalWidth,
			naturalHeight,
			viewportWidth,
			viewportHeight,
			renderedWidth,
			renderedHeight,
		};
	}, []);

	/**
	 * Returns the maximum allowed pan offset per axis for a given scale.
	 * Panning is only possible along an axis when the magnified image
	 * overflows the photo viewport on that axis.
	 */
	const getMaxPan = useCallback(
		(scale: number) => {
			const metrics = getMetrics();
			if (!metrics) {
				return { maxX: 0, maxY: 0 };
			}

			const { renderedWidth, renderedHeight, viewportWidth, viewportHeight } =
				metrics;
			return {
				maxX: Math.max(0, (renderedWidth * scale - viewportWidth) / 2),
				maxY: Math.max(0, (renderedHeight * scale - viewportHeight) / 2),
			};
		},
		[getMetrics],
	);

	/**
	 * Clamps the pan offset to the rendered letterboxed image bounds so that
	 * empty background is never exposed.
	 */
	const clampPan = useCallback(
		(scale: number, nextPanX: number, nextPanY: number) => {
			const { maxX, maxY } = getMaxPan(scale);
			return {
				panX: clamp(nextPanX, -maxX, maxX),
				panY: clamp(nextPanY, -maxY, maxY),
			};
		},
		[getMaxPan],
	);

	/**
	 * Applies a new scale/pan: clamps to bounds, updates the live ref mirror,
	 * and commits the values to React state.
	 */
	const applyZoom = useCallback(
		(scale: number, nextPanX: number, nextPanY: number) => {
			const { panX: clampedPanX, panY: clampedPanY } = clampPan(
				scale,
				nextPanX,
				nextPanY,
			);
			zoomRef.current = {
				scale,
				panX: clampedPanX,
				panY: clampedPanY,
				enabled: zoomRef.current.enabled,
			};
			isMagnifiedRef.current = scale > 1;
			setZoomScale(scale);
			setPanX(clampedPanX);
			setPanY(clampedPanY);
		},
		[clampPan],
	);

	const resetZoom = useCallback(() => {
		applyZoom(MIN_ZOOM_SCALE, 0, 0);
	}, [applyZoom]);

	// Keep the zoom mirror in sync with the `enableZoom` prop.
	useEffect(() => {
		zoomRef.current = { ...zoomRef.current, enabled: enableZoom };
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

			resetZoom();
			return {
				...prevState,
				activePhotoIndex: normalizedActivePhotoIndex,
				hidePrevButton,
				hideNextButton,
			};
		});
	}, [activePhotoIndex, photos, wrap, resetZoom]);

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
			resetZoom();
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
		[getItemByDirection, photos.length, resetZoom, wrap],
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
	}, []);

	const onPhotoError = useCallback(() => {
		setState((prevState) => ({ ...prevState, controlsDisabled: false }));
	}, []);

	const onPhotoPress = useCallback(() => {
		// While magnified (or right after a drag), clicks must not navigate.
		if (isMagnifiedRef.current || gestureRef.current.suppressClick) {
			gestureRef.current.suppressClick = false;
			return;
		}

		move(DIRECTION_NEXT);
		activePhotoPressed?.();
	}, [activePhotoPressed, move]);

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

	/**
	 * Zooms toward a focal point (cursor or pinch midpoint) expressed relative
	 * to the viewport center, keeping the point under the focal fixed.
	 */
	const zoomToward = useCallback(
		(focalX: number, focalY: number, nextScale: number) => {
			const { scale, panX, panY } = zoomRef.current;
			const clampedScale = clamp(nextScale, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);
			if (clampedScale === scale) {
				return;
			}

			const ratio = clampedScale / scale;
			const nextPanX = focalX * (1 - ratio) + panX * ratio;
			const nextPanY = focalY * (1 - ratio) + panY * ratio;
			applyZoom(clampedScale, nextPanX, nextPanY);
		},
		[applyZoom],
	);

	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (!zoomRef.current.enabled) {
				return;
			}

			const viewport = viewportRef.current;
			if (!viewport) {
				return;
			}

			event.preventDefault();
			const rect = viewport.getBoundingClientRect();
			const focalX = event.clientX - (rect.left + rect.width / 2);
			const focalY = event.clientY - (rect.top + rect.height / 2);
			const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
			zoomToward(focalX, focalY, zoomRef.current.scale * factor);
		},
		[zoomToward],
	);

	const handleTouchStart = useCallback((event: TouchEvent) => {
		if (!zoomRef.current.enabled) {
			return;
		}

		const touches = event.targetTouches;
		if (touches.length >= 2) {
			const a = touches[0];
			const b = touches[1];
			if (!a || !b) {
				return;
			}
			const rect = viewportRef.current?.getBoundingClientRect();
			const cx = rect ? rect.left + rect.width / 2 : 0;
			const cy = rect ? rect.top + rect.height / 2 : 0;
			gestureRef.current.pinchActive = true;
			gestureRef.current.pinchInitialDistance = touchDistance(a, b);
			gestureRef.current.pinchInitialScale = zoomRef.current.scale;
			gestureRef.current.pinchInitialPanX = zoomRef.current.panX;
			gestureRef.current.pinchInitialPanY = zoomRef.current.panY;
			gestureRef.current.pinchFocalX = (a.clientX + b.clientX) / 2 - cx;
			gestureRef.current.pinchFocalY = (a.clientY + b.clientY) / 2 - cy;
			gestureRef.current.panning = false;
			gestureRef.current.touchMoved = false;
			return;
		}

		const touch = touches[0];
		if (!touch) {
			return;
		}

		gestureRef.current.pinchActive = false;
		gestureRef.current.suppressClick = false;
		gestureRef.current.touchStartX = touch.screenX;
		gestureRef.current.touchStartY = touch.screenY;
		gestureRef.current.touchLastX = touch.screenX;
		gestureRef.current.touchLastY = touch.screenY;
		gestureRef.current.touchMoved = false;
		gestureRef.current.panning = zoomRef.current.scale > 1;
	}, []);

	const handleTouchMove = useCallback(
		(event: TouchEvent) => {
			if (!zoomRef.current.enabled) {
				return;
			}

			const touches = event.targetTouches;

			if (gestureRef.current.pinchActive && touches.length >= 2) {
				event.preventDefault();
				const a = touches[0];
				const b = touches[1];
				if (!a || !b) {
					return;
				}
				const initial = gestureRef.current.pinchInitialDistance;
				if (initial <= 0) {
					return;
				}

				const nextScale =
					gestureRef.current.pinchInitialScale *
					(touchDistance(a, b) / initial);
				const focalX = gestureRef.current.pinchFocalX;
				const focalY = gestureRef.current.pinchFocalY;
				const baseScale = gestureRef.current.pinchInitialScale;
				const basePanX = gestureRef.current.pinchInitialPanX;
				const basePanY = gestureRef.current.pinchInitialPanY;
				const clampedScale = clamp(nextScale, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);
				const ratio = clampedScale / baseScale;
				const nextPanX = focalX * (1 - ratio) + basePanX * ratio;
				const nextPanY = focalY * (1 - ratio) + basePanY * ratio;
				applyZoom(clampedScale, nextPanX, nextPanY);
				return;
			}

			const touch = touches[0];
			if (!touch) {
				return;
			}

			gestureRef.current.touchMoved = true;

			if (gestureRef.current.panning && zoomRef.current.scale > 1) {
				event.preventDefault();
				const dx = touch.screenX - gestureRef.current.touchLastX;
				const dy = touch.screenY - gestureRef.current.touchLastY;
				applyZoom(
					zoomRef.current.scale,
					zoomRef.current.panX + dx,
					zoomRef.current.panY + dy,
				);
				gestureRef.current.touchLastX = touch.screenX;
				gestureRef.current.touchLastY = touch.screenY;
				return;
			}

			// Not magnified: track the swipe end position for navigation on touchend.
			gestureRef.current.touchLastX = touch.screenX;
		},
		[applyZoom],
	);

	const handleTouchEnd = useCallback(
		(event: TouchEvent) => {
			if (!zoomRef.current.enabled) {
				return;
			}

			if (gestureRef.current.pinchActive) {
				if (event.targetTouches.length < 2) {
					gestureRef.current.pinchActive = false;
					// Re-clamp in case the pinch ended at a non-integer focal point.
					applyZoom(
						zoomRef.current.scale,
						zoomRef.current.panX,
						zoomRef.current.panY,
					);
				}
				return;
			}

			if (gestureRef.current.panning) {
				gestureRef.current.panning = false;
				if (gestureRef.current.touchMoved) {
					gestureRef.current.suppressClick = true;
				}
				applyZoom(
					zoomRef.current.scale,
					zoomRef.current.panX,
					zoomRef.current.panY,
				);
				return;
			}

			// Swipe navigation only while unmagnified.
			if (zoomRef.current.scale > 1) {
				return;
			}

			const { touchStartX, touchLastX, touchMoved } = gestureRef.current;
			if (!touchMoved) {
				return;
			}

			if (touchStartX < touchLastX) {
				onPrevButtonPress();
			} else if (touchStartX > touchLastX) {
				onNextButtonPress();
			}

			// Suppress the synthetic click that follows a swipe so it does not
			// advance the gallery a second time.
			gestureRef.current.suppressClick = true;
			gestureRef.current.touchMoved = false;
		},
		[applyZoom, onNextButtonPress, onPrevButtonPress],
	);

	// Attach non-passive wheel/touch listeners so we can preventDefault during
	// pinch/pan without the browser scrolling or zooming the page. Using a
	// callback ref keeps the listeners bound to the live viewport element even
	// when it mounts after the gallery first renders (e.g. photos arrive later).
	const attachViewport = useCallback(
		(element: HTMLButtonElement | null) => {
			const previous = viewportRef.current;
			if (previous && previous !== element) {
				previous.removeEventListener('wheel', handleWheel);
				previous.removeEventListener('touchstart', handleTouchStart);
				previous.removeEventListener('touchmove', handleTouchMove);
				previous.removeEventListener('touchend', handleTouchEnd);
			}

			viewportRef.current = element;

			if (element) {
				element.addEventListener('wheel', handleWheel, { passive: false });
				element.addEventListener('touchstart', handleTouchStart, {
					passive: false,
				});
				element.addEventListener('touchmove', handleTouchMove, {
					passive: false,
				});
				element.addEventListener('touchend', handleTouchEnd);
			}
		},
		[handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd],
	);

	const onMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLButtonElement>) => {
			gestureRef.current.suppressClick = false;
			if (!enableZoom || zoomRef.current.scale <= 1) {
				return;
			}

			event.preventDefault();
			gestureRef.current.mouseLastX = event.clientX;
			gestureRef.current.mouseLastY = event.clientY;
			gestureRef.current.mouseMoved = false;
			setIsDragging(true);
		},
		[enableZoom],
	);

	// Mouse drag panning: listen on the window so the drag continues even when
	// the pointer leaves the photo.
	useEffect(() => {
		if (!isDragging) {
			return;
		}

		const onMove = (event: MouseEvent) => {
			const dx = event.clientX - gestureRef.current.mouseLastX;
			const dy = event.clientY - gestureRef.current.mouseLastY;
			if (
				!gestureRef.current.mouseMoved &&
				Math.hypot(dx, dy) < PAN_DRAG_THRESHOLD
			) {
				return;
			}

			gestureRef.current.mouseMoved = true;
			applyZoom(
				zoomRef.current.scale,
				zoomRef.current.panX + dx,
				zoomRef.current.panY + dy,
			);
			gestureRef.current.mouseLastX = event.clientX;
			gestureRef.current.mouseLastY = event.clientY;
		};

		const onUp = () => {
			if (gestureRef.current.mouseMoved) {
				gestureRef.current.suppressClick = true;
			}
			gestureRef.current.mouseMoved = false;
			setIsDragging(false);
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, [applyZoom, isDragging]);

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

	const effectiveScale = enableZoom ? zoomScale : MIN_ZOOM_SCALE;
	const effectivePanX = enableZoom ? panX : 0;
	const effectivePanY = enableZoom ? panY : 0;

	const photoStyle: ZoomStyle = {
		'--rbg-scale': effectiveScale,
		'--rbg-zoom-scale': effectiveScale,
		'--rbg-photo-scale': effectiveScale,
		'--rbg-pan-x': `${effectivePanX}px`,
		'--rbg-pan-y': `${effectivePanY}px`,
		'--rbg-photo-pan-x': `${effectivePanX}px`,
		'--rbg-photo-pan-y': `${effectivePanY}px`,
		transform: `translateY(-50%) translate(${effectivePanX}px, ${effectivePanY}px) scale(${effectiveScale})`,
	};

	const buttonStyle: CSSProperties = enableZoom
		? {
				touchAction: 'none',
				cursor: isMagnified ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
			}
		: {};

	return (
		<div className="gallery">
			<div className="gallery-modal--preload">{galleryModalPreloadPhotos}</div>
			<div className="gallery-main">
				{controls}
				<div className="gallery-photos">
					{hasPhotos ? (
						<div className="gallery-photo">
							<div className="gallery-photo--current">
								<Photo
									photo={current}
									onLoad={onPhotoLoad}
									onError={onPhotoError}
									onPress={onPhotoPress}
									onMouseDown={onMouseDown}
									style={photoStyle}
									buttonStyle={buttonStyle}
									viewportRef={attachViewport}
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
