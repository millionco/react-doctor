// rule: effect-needs-cleanup
// file-path: src/components/gallery.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 6c1a34364649224a1b76c975e2f020f8d1d6ffa89f274c49e4ce4c87a1b26be1
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
	PAN_DRAG_THRESHOLD,
	ZOOM_WHEEL_STEP,
} from '../constants';
import { defaultPhrases } from '../default-phrases';
import type {
	GalleryController,
	GalleryPhoto,
	GalleryPhrases,
} from '../types/gallery';
import {
	UNMAGNIFIED,
	clampPan,
	clampScale,
	focalPan,
	pointerDistance,
	type ZoomBounds,
	type ZoomPanState,
} from '../utils/zoom-pan';
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
	/** Enables wheel/pinch zoom and drag-to-pan on the active photo. */
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

const EMPTY_PHOTOS: GalleryPhoto[] = [];

/** Gesture session kind tracked across native events on the photo button. */
type GestureMode = 'swipe' | 'pan' | 'pinch' | 'mousepan' | null;

interface GestureSession {
	mode: GestureMode;
	startX: number;
	startY: number;
	startScreenX: number;
	endScreenX: number;
	startPanX: number;
	startPanY: number;
	startScale: number;
	startDistance: number;
	focalX: number;
	focalY: number;
	moved: boolean;
	pointerId: number;
}

function createGestureSession(): GestureSession {
	return {
		mode: null,
		startX: 0,
		startY: 0,
		startScreenX: 0,
		endScreenX: 0,
		startPanX: 0,
		startPanY: 0,
		startScale: 1,
		startDistance: 0,
		focalX: 0,
		focalY: 0,
		moved: false,
		pointerId: -1,
	};
}

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
 * Reads the unscaled letterboxed image size and the photo viewport size
 * used to clamp pan offsets. Returns zeros when the elements are unavailable
 * (for example in non-visual environments such as jsdom).
 */
function readZoomBounds(image: HTMLElement | null): ZoomBounds {
	const viewport = image?.closest('.gallery-photo--current') as HTMLElement | null;
	const renderedWidth = image?.offsetWidth ?? 0;
	const renderedHeight = image?.offsetHeight ?? 0;
	const viewportWidth = viewport?.clientWidth ?? 0;
	const viewportHeight = viewport?.clientHeight ?? 0;
	return { renderedWidth, renderedHeight, viewportWidth, viewportHeight };
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
		};
	});

	const [zoom, setZoom] = useState<ZoomPanState>(UNMAGNIFIED);

	// Refs mirroring the latest values so native gesture handlers (attached
	// once) always read fresh state without re-binding listeners.
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const enableZoomRef = useRef(enableZoom);
	enableZoomRef.current = enableZoom;
	const photoSurfaceRef = useRef<HTMLElement | null>(null);
	const gestureRef = useRef<GestureSession>(createGestureSession());

	// Synchronously reset magnification when the active photo changes or when
	// zoom is turned off, so a magnified frame is never left painted on the
	// next/unzoomed photo (derived-state reset, runs before paint).
	const [resetKey, setResetKey] = useState(
		`${state.activePhotoIndex}:${enableZoom ? 1 : 0}`,
	);
	const nextResetKey = `${state.activePhotoIndex}:${enableZoom ? 1 : 0}`;
	if (resetKey !== nextResetKey) {
		setResetKey(nextResetKey);
		// Abort any in-flight gesture so stale session state cannot bleed
		// into the newly active photo.
		gestureRef.current = createGestureSession();
		if (zoom.scale !== 1 || zoom.panX !== 0 || zoom.panY !== 0) {
			setZoom(UNMAGNIFIED);
		}
	}

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
	}, []);

	const onPhotoError = useCallback(() => {
		setState((prevState) => ({ ...prevState, controlsDisabled: false }));
	}, []);


	const onPhotoPress = useCallback(() => {
		// While magnified the photo surface is a pan/zoom canvas: clicks must
		// not advance to the next photo.
		if (zoomRef.current.scale > 1) {
			return;
		}
		move(DIRECTION_NEXT);
		activePhotoPressed?.();
	}, [activePhotoPressed, move]);

	/**
	 * Applies a new scale/pan, clamping the pan to the rendered image bounds
	 * so empty background is never exposed (including after focal zoom).
	 */
	const getImageElement = useCallback((): HTMLElement | null => {
		const surface = photoSurfaceRef.current;
		if (!surface) {
			return null;
		}
		return (surface.querySelector('img.photo') as HTMLElement | null) ?? null;
	}, []);

	const applyZoom = useCallback(
		(nextScale: number, nextPanX: number, nextPanY: number) => {
			const bounds = readZoomBounds(getImageElement());
			const clamped = clampPan(nextScale, nextPanX, nextPanY, bounds);
			setZoom(clamped);
		},
		[getImageElement],
	);

	const resolveViewportCenter = useCallback(
		(image: HTMLElement | null): { cx: number; cy: number } => {
			if (!image) {
				return { cx: 0, cy: 0 };
			}
			const viewport = image.closest(
				'.gallery-photo--current',
			) as HTMLElement | null;
			const target = viewport ?? image;
			const rect = target.getBoundingClientRect();
			return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
		},
		[],
	);

	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (!enableZoomRef.current) {
				return;
			}
			event.preventDefault();
			const image = event.currentTarget as HTMLElement;
			const img = (image.querySelector('img.photo') as HTMLElement | null) ?? image;
			const { cx, cy } = resolveViewportCenter(img);
			const focalX = event.clientX - cx;
			const focalY = event.clientY - cy;
			const current = zoomRef.current;
			const factor = Math.exp(-event.deltaY * ZOOM_WHEEL_STEP);
			const nextScale = clampScale(current.scale * factor);
			if (nextScale === current.scale) {
				return;
			}
			const { panX, panY } = focalPan(
				current.scale,
				nextScale,
				current.panX,
				current.panY,
				focalX,
				focalY,
			);
			applyZoom(nextScale, panX, panY);
		},
		[applyZoom, resolveViewportCenter],
	);

	const beginPinch = useCallback(
		(touches: TouchList) => {
			if (touches.length < 2) {
				return;
			}
			const t0 = touches[0];
			const t1 = touches[1];
			const { cx, cy } = resolveViewportCenter(getImageElement());
			const session = gestureRef.current;
			session.mode = 'pinch';
			session.startDistance = pointerDistance(
				t0.clientX,
				t0.clientY,
				t1.clientX,
				t1.clientY,
			);
			session.startScale = zoomRef.current.scale;
			session.startPanX = zoomRef.current.panX;
			session.startPanY = zoomRef.current.panY;
			session.focalX = (t0.clientX + t1.clientX) / 2 - cx;
			session.focalY = (t0.clientY + t1.clientY) / 2 - cy;
			session.moved = false;
		},
		[resolveViewportCenter],
	);

	const updatePinch = useCallback(
		(touches: TouchList) => {
			if (touches.length < 2) {
				return;
			}
			const t0 = touches[0];
			const t1 = touches[1];
			const session = gestureRef.current;
			if (session.mode !== 'pinch' || session.startDistance === 0) {
				return;
			}
			const distance = pointerDistance(
				t0.clientX,
				t0.clientY,
				t1.clientX,
				t1.clientY,
			);
			const ratio = distance / session.startDistance;
			const nextScale = clampScale(session.startScale * ratio);
			const { panX, panY } = focalPan(
				session.startScale,
				nextScale,
				session.startPanX,
				session.startPanY,
				session.focalX,
				session.focalY,
			);
			applyZoom(nextScale, panX, panY);
			session.moved = true;
		},
		[applyZoom],
	);

	const handleTouchStart = useCallback(
		(event: TouchEvent) => {
			const touches = event.targetTouches;
			if (!enableZoomRef.current) {
				if (touches.length === 1) {
					const session = gestureRef.current;
					session.mode = 'swipe';
					session.startScreenX = touches[0].screenX;
					session.endScreenX = touches[0].screenX;
					session.moved = false;
				}
				return;
			}
			if (touches.length >= 2) {
				event.preventDefault();
				beginPinch(touches);
				return;
			}
			if (touches.length === 1) {
				const session = gestureRef.current;
				if (zoomRef.current.scale > 1) {
					session.mode = 'pan';
					session.startX = touches[0].clientX;
					session.startY = touches[0].clientY;
					session.startPanX = zoomRef.current.panX;
					session.startPanY = zoomRef.current.panY;
					session.moved = false;
				} else {
					session.mode = 'swipe';
					session.startScreenX = touches[0].screenX;
					session.endScreenX = touches[0].screenX;
					session.moved = false;
				}
			}
		},
		[beginPinch],
	);

	const handleTouchMove = useCallback(
		(event: TouchEvent) => {
			const touches = event.targetTouches;
			const session = gestureRef.current;
			if (session.mode === 'pinch' && touches.length >= 2) {
				event.preventDefault();
				updatePinch(touches);
				return;
			}
			if (session.mode === 'pan' && touches.length >= 1) {
				event.preventDefault();
				const dx = touches[0].clientX - session.startX;
				const dy = touches[0].clientY - session.startY;
				if (Math.abs(dx) >= PAN_DRAG_THRESHOLD || Math.abs(dy) >= PAN_DRAG_THRESHOLD) {
					session.moved = true;
				}
				applyZoom(zoomRef.current.scale, session.startPanX + dx, session.startPanY + dy);
				return;
			}
			if (session.mode === 'swipe' && touches.length >= 1) {
				session.endScreenX = touches[0].screenX;
				session.moved = true;
			}
		},
		[applyZoom, updatePinch],
	);

	const handleTouchEnd = useCallback(
		(event: TouchEvent) => {
			const session = gestureRef.current;
			if (session.mode === 'swipe' && session.moved) {
				const delta = session.endScreenX - session.startScreenX;
				if (delta < 0) {
					onNextButtonPress();
				} else if (delta > 0) {
					onPrevButtonPress();
				}
			}
			// When one finger remains after a pinch, continue panning with it
			// instead of ending the gesture.
			if (
				event.targetTouches.length === 1 &&
				session.mode === 'pinch' &&
				enableZoomRef.current &&
				zoomRef.current.scale > 1
			) {
				const touch = event.targetTouches[0];
				session.mode = 'pan';
				session.startX = touch.clientX;
				session.startY = touch.clientY;
				session.startPanX = zoomRef.current.panX;
				session.startPanY = zoomRef.current.panY;
				session.moved = false;
				return;
			}
			if (event.targetTouches.length === 0) {
				gestureRef.current = createGestureSession();
			}
		},
		[onNextButtonPress, onPrevButtonPress],
	);

	const handlePointerDown = useCallback(
		(event: PointerEvent) => {
			// Touch/pen gestures are handled via touch events; pointer events
			// are only used for mouse drag-pan to avoid double handling.
			if (!enableZoomRef.current || event.pointerType !== 'mouse') {
				return;
			}
			if (zoomRef.current.scale <= 1) {
				return;
			}
			const session = gestureRef.current;
			session.mode = 'mousepan';
			session.pointerId = event.pointerId;
			session.startX = event.clientX;
			session.startY = event.clientY;
			session.startPanX = zoomRef.current.panX;
			session.startPanY = zoomRef.current.panY;
			session.startScale = zoomRef.current.scale;
			session.moved = false;
			const target = event.currentTarget as HTMLElement;
			if (typeof target.setPointerCapture === 'function') {
				try {
					target.setPointerCapture(event.pointerId);
				} catch {
					/* ignore */
				}
			}
		},
		[],
	);

	const handlePointerMove = useCallback(
		(event: PointerEvent) => {
			const session = gestureRef.current;
			if (session.mode !== 'mousepan' || event.pointerId !== session.pointerId) {
				return;
			}
			const dx = event.clientX - session.startX;
			const dy = event.clientY - session.startY;
			if (Math.abs(dx) >= PAN_DRAG_THRESHOLD || Math.abs(dy) >= PAN_DRAG_THRESHOLD) {
				session.moved = true;
			}
			applyZoom(session.startScale, session.startPanX + dx, session.startPanY + dy);
		},
		[applyZoom],
	);

	const handlePointerUp = useCallback((event: PointerEvent) => {
		const session = gestureRef.current;
		if (session.mode !== 'mousepan' || event.pointerId !== session.pointerId) {
			return;
		}
		const target = event.currentTarget as HTMLElement;
		if (typeof target.releasePointerCapture === 'function') {
			try {
				target.releasePointerCapture(event.pointerId);
			} catch {
				/* ignore */
			}
		}
		gestureRef.current = createGestureSession();
	}, []);

	/**
	 * Attaches non-passive native gesture listeners to the photo button so
	 * `preventDefault` works during wheel/touch zoom and pan.
	 */
	const registerGestureHandlers = useCallback(
		(element: HTMLElement): (() => void) | undefined => {
			photoSurfaceRef.current = element;
			const options = { passive: false };
			const onWheel = (e: WheelEvent) => handleWheel(e);
			const onTouchStart = (e: TouchEvent) => handleTouchStart(e);
			const onTouchMove = (e: TouchEvent) => handleTouchMove(e);
			const onTouchEnd = (e: TouchEvent) => handleTouchEnd(e);
			const onPointerDown = (e: PointerEvent) => handlePointerDown(e);
			const onPointerMove = (e: PointerEvent) => handlePointerMove(e);
			const onPointerUp = (e: PointerEvent) => handlePointerUp(e);
			const onPointerCancel = (e: PointerEvent) => handlePointerUp(e);

			element.addEventListener('wheel', onWheel, options);
			element.addEventListener('touchstart', onTouchStart, options);
			element.addEventListener('touchmove', onTouchMove, options);
			element.addEventListener('touchend', onTouchEnd, options);
			element.addEventListener('pointerdown', onPointerDown);
			element.addEventListener('pointermove', onPointerMove);
			element.addEventListener('pointerup', onPointerUp);
			element.addEventListener('pointercancel', onPointerCancel);

			return () => {
				element.removeEventListener('wheel', onWheel);
				element.removeEventListener('touchstart', onTouchStart);
				element.removeEventListener('touchmove', onTouchMove);
				element.removeEventListener('touchend', onTouchEnd);
				element.removeEventListener('pointerdown', onPointerDown);
				element.removeEventListener('pointermove', onPointerMove);
				element.removeEventListener('pointerup', onPointerUp);
				element.removeEventListener('pointercancel', onPointerCancel);
			};
		},
		[
			handleWheel,
			handleTouchStart,
			handleTouchMove,
			handleTouchEnd,
			handlePointerDown,
			handlePointerMove,
			handlePointerUp,
		],
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
							<div className="gallery-photo--current">
								<Photo
									photo={current}
									enableZoom={enableZoom}
									scale={zoom.scale}
									panX={zoom.panX}
									panY={zoom.panY}
									onLoad={onPhotoLoad}
									onError={onPhotoError}
									onPress={onPhotoPress}
									registerGestureHandlers={registerGestureHandlers}
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
