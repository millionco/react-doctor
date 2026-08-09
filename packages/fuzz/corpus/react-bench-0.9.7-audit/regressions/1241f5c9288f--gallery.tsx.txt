// rule: effect-needs-cleanup
// file-path: src/components/gallery.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 1241f5c9288f0409a362807ad275c9740939ac96a1a9b44b4c734fd04cc83858
import type { TouchEvent as ReactTouchEvent } from 'react';
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

interface ZoomState {
	scale: number;
	panX: number;
	panY: number;
}

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
		};
	});

	const [zoomState, setZoomState] = useState<ZoomState>(() => ({
		scale: 1,
		panX: 0,
		panY: 0,
	}));
	const zoomRef = useRef<ZoomState>(zoomState);
	useEffect(() => {
		zoomRef.current = zoomState;
	}, [zoomState]);

	const viewportRef = useRef<HTMLDivElement>(null);
	const imageRef = useRef<HTMLImageElement>(null);
	const naturalSizeRef = useRef<{ w: number; h: number } | null>(null);
	const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

	const pinchRef = useRef<{
		initialDist: number;
		initialScale: number;
		initialPanX: number;
		initialPanY: number;
		initialMidX: number;
		initialMidY: number;
	} | null>(null);

	const panRef = useRef<{
		startX: number;
		startY: number;
		initialPanX: number;
		initialPanY: number;
		isDragging: boolean;
	} | null>(null);

	const suppressClickRef = useRef(false);

	const measureViewport = useCallback(() => {
		const el = viewportRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setViewportSize({ w: rect.width, h: rect.height });
	}, []);

	useEffect(() => {
		measureViewport();
		const handleResize = () => measureViewport();
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, [measureViewport]);

	useEffect(() => {
		measureViewport();
	}, [state.activePhotoIndex]);

	const getRenderedSize = useCallback(() => {
		const vpW = viewportSize.w;
		const vpH = viewportSize.h;
		const nat = naturalSizeRef.current;
		if (nat && nat.w > 0 && nat.h > 0 && vpW > 0 && vpH > 0) {
			const ratio = Math.min(vpW / nat.w, vpH / nat.h);
			return { w: nat.w * ratio, h: nat.h * ratio };
		}
		const img = imageRef.current;
		const scale = zoomRef.current.scale || 1;
		if (img) {
			const ow = (img as any).offsetWidth || 0;
			const oh = (img as any).offsetHeight || 0;
			if (ow > 0 && oh > 0) {
				return { w: ow, h: oh };
			}
			const rect = img.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0 && scale > 0) {
				return { w: rect.width / scale, h: rect.height / scale };
			}
		}
		if (vpW > 0 && vpH > 0) {
			return { w: vpW, h: vpH };
		}
		const el = viewportRef.current;
		if (el) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) {
				return { w: r.width, h: r.height };
			}
		}
		return { w: 0, h: 0 };
	}, [viewportSize]);

	const clampPan = useCallback(
		(panX: number, panY: number, scale: number) => {
			let vpW = viewportSize.w;
			let vpH = viewportSize.h;
			if (vpW === 0 || vpH === 0) {
				const el = viewportRef.current;
				if (el) {
					const r = el.getBoundingClientRect();
					vpW = r.width;
					vpH = r.height;
				}
			}
			const rendered = getRenderedSize();
			const rw = rendered.w || vpW;
			const rh = rendered.h || vpH;

			const maxX = Math.max(0, (rw * scale - vpW) / 2);
			const maxY = Math.max(0, (rh * scale - vpH) / 2);

			let clampedX = panX;
			let clampedY = panY;
			if (maxX === 0) {
				clampedX = 0;
			} else {
				clampedX = Math.min(Math.max(panX, -maxX), maxX);
			}
			if (maxY === 0) {
				clampedY = 0;
			} else {
				clampedY = Math.min(Math.max(panY, -maxY), maxY);
			}
			return { panX: clampedX, panY: clampedY };
		},
		[viewportSize, getRenderedSize],
	);

	useEffect(() => {
		setZoomState({ scale: 1, panX: 0, panY: 0 });
		suppressClickRef.current = false;
		pinchRef.current = null;
		panRef.current = null;
	}, [state.activePhotoIndex]);

	useEffect(() => {
		if (!enableZoom) {
			setZoomState({ scale: 1, panX: 0, panY: 0 });
			pinchRef.current = null;
			panRef.current = null;
		}
	}, [enableZoom]);

	useEffect(() => {
		if (zoomRef.current.scale > 1) {
			const cl = clampPan(
				zoomRef.current.panX,
				zoomRef.current.panY,
				zoomRef.current.scale,
			);
			if (
				cl.panX !== zoomRef.current.panX ||
				cl.panY !== zoomRef.current.panY
			) {
				setZoomState((prev) => ({
					...prev,
					panX: cl.panX,
					panY: cl.panY,
				}));
			}
		} else {
			if (zoomRef.current.panX !== 0 || zoomRef.current.panY !== 0) {
				setZoomState((prev) => ({ ...prev, panX: 0, panY: 0 }));
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [viewportSize]);

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
		const img = imageRef.current;
		if (img) {
			const w = (img as any).naturalWidth || 0;
			const h = (img as any).naturalHeight || 0;
			if (w > 0 && h > 0) {
				naturalSizeRef.current = { w, h };
				if (zoomRef.current.scale > 1) {
					const vp = viewportRef.current?.getBoundingClientRect();
					if (vp) {
						const ratio = Math.min(vp.width / w, vp.height / h);
						const rw = w * ratio;
						const rh = h * ratio;
						const maxX = Math.max(0, (rw * zoomRef.current.scale - vp.width) / 2);
						const maxY = Math.max(0, (rh * zoomRef.current.scale - vp.height) / 2);
						let px = zoomRef.current.panX;
						let py = zoomRef.current.panY;
						if (maxX === 0) px = 0;
						else px = Math.min(Math.max(px, -maxX), maxX);
						if (maxY === 0) py = 0;
						else py = Math.min(Math.max(py, -maxY), maxY);
						if (px !== zoomRef.current.panX || py !== zoomRef.current.panY) {
							setZoomState((prev) => ({ ...prev, panX: px, panY: py }));
						}
					}
				}
			}
		}
		measureViewport();
	}, [measureViewport]);

	const onPhotoError = useCallback(() => {
		setState((prevState) => ({ ...prevState, controlsDisabled: false }));
	}, []);

	const onPhotoPress = useCallback(() => {
		if (suppressClickRef.current) {
			suppressClickRef.current = false;
			return;
		}
		if (enableZoom && zoomRef.current.scale > 1) {
			return;
		}
		move(DIRECTION_NEXT);
		activePhotoPressed?.();
	}, [activePhotoPressed, move, enableZoom]);

	const onTouchStartLegacy = useCallback(
		(event: ReactTouchEvent) => {
			if (enableZoom && zoomRef.current.scale > 1) {
				return;
			}
			const t = event.targetTouches[0];
			if (t) {
				setState((prevState) => ({
					...prevState,
					touchStartInfo: { screenX: t.screenX } as any,
				}));
			}
		},
		[enableZoom],
	);

	const onTouchMoveLegacy = useCallback(
		(event: ReactTouchEvent) => {
			if (enableZoom && zoomRef.current.scale > 1) {
				return;
			}
			const t = event.targetTouches[0];
			if (t) {
				setState((prevState) => ({
					...prevState,
					touchMoved: true,
					touchEndInfo: { screenX: t.screenX } as any,
				}));
			}
		},
		[enableZoom],
	);

	const onTouchEndLegacy = useCallback(() => {
		if (enableZoom && zoomRef.current.scale > 1) {
			setState((prevState) => ({ ...prevState, touchMoved: false }));
			return;
		}
		if (suppressClickRef.current) {
			suppressClickRef.current = false;
			setState((prevState) => ({ ...prevState, touchMoved: false }));
			return;
		}
		setState((prevState) => {
			const { touchStartInfo, touchEndInfo, touchMoved } = prevState;
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
			};
		});
	}, [onNextButtonPress, onPrevButtonPress, enableZoom]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;

		const handleWheel = (e: WheelEvent) => {
			if (!enableZoom) return;
			e.preventDefault();
			const scale = zoomRef.current.scale;
			const panX = zoomRef.current.panX;
			const panY = zoomRef.current.panY;
			const rect = viewport.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) {
				return;
			}
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			const focalX = e.clientX - centerX;
			const focalY = e.clientY - centerY;

			const delta = -e.deltaY;
			const factor = Math.exp(delta * 0.0015);
			let newScale = scale * factor;
			newScale = Math.min(Math.max(newScale, MIN_ZOOM), MAX_ZOOM);

			if (newScale === scale) {
				return;
			}

			let newPanX = focalX - (focalX - panX) * (newScale / scale);
			let newPanY = focalY - (focalY - panY) * (newScale / scale);

			const clamped = clampPan(newPanX, newPanY, newScale);
			if (newScale === 1) {
				setZoomState({ scale: 1, panX: 0, panY: 0 });
			} else {
				setZoomState({ scale: newScale, panX: clamped.panX, panY: clamped.panY });
			}
			suppressClickRef.current = true;
		};

		const handleMouseDown = (e: MouseEvent) => {
			if (!enableZoom) return;
			if (zoomRef.current.scale <= 1) return;
			panRef.current = {
				startX: e.clientX,
				startY: e.clientY,
				initialPanX: zoomRef.current.panX,
				initialPanY: zoomRef.current.panY,
				isDragging: true,
			};
			e.preventDefault();
		};

		const handleWindowMouseMove = (e: MouseEvent) => {
			if (!panRef.current?.isDragging) return;
			if (pinchRef.current) return;
			const dx = e.clientX - panRef.current.startX;
			const dy = e.clientY - panRef.current.startY;
			const newPanX = panRef.current.initialPanX + dx;
			const newPanY = panRef.current.initialPanY + dy;
			const clamped = clampPan(newPanX, newPanY, zoomRef.current.scale);
			setZoomState((prev) => ({
				...prev,
				panX: clamped.panX,
				panY: clamped.panY,
			}));
		};

		const handleWindowMouseUp = () => {
			if (panRef.current?.isDragging) {
				panRef.current = null;
				suppressClickRef.current = true;
				setTimeout(() => {
					suppressClickRef.current = false;
				}, 300);
			}
		};

		const getTouchDistance = (t1: Touch, t2: Touch) => {
			const dx = t1.clientX - t2.clientX;
			const dy = t1.clientY - t2.clientY;
			return Math.sqrt(dx * dx + dy * dy);
		};

		const handleTouchStart = (e: TouchEvent) => {
			if (!enableZoom) return;
			const touches = e.touches;
			if (touches.length === 2) {
				const dist = getTouchDistance(touches[0], touches[1]);
				const midX = (touches[0].clientX + touches[1].clientX) / 2;
				const midY = (touches[0].clientY + touches[1].clientY) / 2;
				pinchRef.current = {
					initialDist: dist,
					initialScale: zoomRef.current.scale,
					initialPanX: zoomRef.current.panX,
					initialPanY: zoomRef.current.panY,
					initialMidX: midX,
					initialMidY: midY,
				};
				panRef.current = null;
				suppressClickRef.current = true;
				setState((prev) => ({
					...prev,
					touchStartInfo: null,
					touchEndInfo: null,
					touchMoved: false,
				}));
			} else if (touches.length === 1) {
				if (zoomRef.current.scale > 1) {
					const t = touches[0];
					panRef.current = {
						startX: t.clientX,
						startY: t.clientY,
						initialPanX: zoomRef.current.panX,
						initialPanY: zoomRef.current.panY,
						isDragging: true,
					};
				}
			}
		};

		const handleTouchMove = (e: TouchEvent) => {
			const touches = e.touches;
			if (pinchRef.current && touches.length === 2) {
				e.preventDefault();
				const dist = getTouchDistance(touches[0], touches[1]);
				if (dist === 0) return;
				const midX = (touches[0].clientX + touches[1].clientX) / 2;
				const midY = (touches[0].clientY + touches[1].clientY) / 2;
				const rect = viewport.getBoundingClientRect();
				const centerX = rect.left + rect.width / 2;
				const centerY = rect.top + rect.height / 2;
				const scaleFactor = dist / pinchRef.current.initialDist;
				let newScale = pinchRef.current.initialScale * scaleFactor;
				newScale = Math.min(Math.max(newScale, MIN_ZOOM), MAX_ZOOM);

				const initialMidRelX = pinchRef.current.initialMidX - centerX;
				const initialMidRelY = pinchRef.current.initialMidY - centerY;
				const currentMidRelX = midX - centerX;
				const currentMidRelY = midY - centerY;

				const newPanX =
					currentMidRelX -
					(initialMidRelX - pinchRef.current.initialPanX) *
						(newScale / pinchRef.current.initialScale);
				const newPanY =
					currentMidRelY -
					(initialMidRelY - pinchRef.current.initialPanY) *
						(newScale / pinchRef.current.initialScale);

				const clamped = clampPan(newPanX, newPanY, newScale);
				if (newScale === 1) {
					setZoomState({ scale: 1, panX: 0, panY: 0 });
				} else {
					setZoomState({ scale: newScale, panX: clamped.panX, panY: clamped.panY });
				}
			} else if (panRef.current && touches.length === 1 && zoomRef.current.scale > 1) {
				e.preventDefault();
				const t = touches[0];
				const dx = t.clientX - panRef.current.startX;
				const dy = t.clientY - panRef.current.startY;
				const newPanX = panRef.current.initialPanX + dx;
				const newPanY = panRef.current.initialPanY + dy;
				const clamped = clampPan(newPanX, newPanY, zoomRef.current.scale);
				setZoomState((prev) => ({
					...prev,
					panX: clamped.panX,
					panY: clamped.panY,
				}));
			}
		};

		const handleTouchEnd = (e: TouchEvent) => {
			if (pinchRef.current) {
				if (e.touches.length >= 2) return;
				pinchRef.current = null;
				suppressClickRef.current = true;
				const clamped = clampPan(
					zoomRef.current.panX,
					zoomRef.current.panY,
					zoomRef.current.scale,
				);
				if (
					clamped.panX !== zoomRef.current.panX ||
					clamped.panY !== zoomRef.current.panY
				) {
					setZoomState((prev) => ({
						...prev,
						panX: clamped.panX,
						panY: clamped.panY,
					}));
				}
				if (zoomRef.current.scale === 1) {
					setZoomState({ scale: 1, panX: 0, panY: 0 });
				}
				if (e.touches.length === 1 && zoomRef.current.scale > 1) {
					const t = e.touches[0];
					panRef.current = {
						startX: t.clientX,
						startY: t.clientY,
						initialPanX: zoomRef.current.panX,
						initialPanY: zoomRef.current.panY,
						isDragging: true,
					};
				}
				return;
			}
			if (panRef.current) {
				if (e.touches.length === 0) {
					panRef.current = null;
					suppressClickRef.current = true;
					setTimeout(() => {
						suppressClickRef.current = false;
					}, 300);
				}
				return;
			}
		};

		viewport.addEventListener('wheel', handleWheel, { passive: false });
		viewport.addEventListener('mousedown', handleMouseDown as any);
		window.addEventListener('mousemove', handleWindowMouseMove as any);
		window.addEventListener('mouseup', handleWindowMouseUp as any);
		viewport.addEventListener('touchstart', handleTouchStart as any, {
			passive: false,
		});
		viewport.addEventListener('touchmove', handleTouchMove as any, {
			passive: false,
		});
		viewport.addEventListener('touchend', handleTouchEnd as any, {
			passive: false,
		});
		viewport.addEventListener('touchcancel', handleTouchEnd as any, {
			passive: false,
		});

		return () => {
			viewport.removeEventListener('wheel', handleWheel as any);
			viewport.removeEventListener('mousedown', handleMouseDown as any);
			window.removeEventListener('mousemove', handleWindowMouseMove as any);
			window.removeEventListener('mouseup', handleWindowMouseUp as any);
			viewport.removeEventListener('touchstart', handleTouchStart as any);
			viewport.removeEventListener('touchmove', handleTouchMove as any);
			viewport.removeEventListener('touchend', handleTouchEnd as any);
			viewport.removeEventListener('touchcancel', handleTouchEnd as any);
		};
	}, [enableZoom, clampPan]);

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

	const imageZoomStyle = useMemo(() => {
		const scale = enableZoom ? zoomState.scale : 1;
		const panX = enableZoom ? zoomState.panX : 0;
		const panY = enableZoom ? zoomState.panY : 0;
		return {
			'--rbg-zoom-scale': String(scale),
			'--rbg-photo-scale': String(scale),
			'--rbg-scale': String(scale),
			'--rbg-pan-x': `${panX}px`,
			'--rbg-pan-y': `${panY}px`,
			'--rbg-photo-pan-x': `${panX}px`,
			'--rbg-photo-pan-y': `${panY}px`,
			transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${scale})`,
			top: '50%',
			left: '50%',
			right: 'auto',
			bottom: 'auto',
		} as React.CSSProperties;
	}, [zoomState, enableZoom]);

	return (
		<div className="gallery">
			<div className="gallery-modal--preload">{galleryModalPreloadPhotos}</div>
			<div className="gallery-main">
				{controls}
				<div className="gallery-photos">
					{hasPhotos ? (
						<div className="gallery-photo">
							<div
								className="gallery-photo--current"
								ref={viewportRef}
								style={{
									touchAction: enableZoom ? 'none' : undefined,
									cursor:
										enableZoom && zoomState.scale > 1 ? 'grab' : undefined,
								}}
							>
								<Photo
									photo={current}
									onLoad={onPhotoLoad}
									onError={onPhotoError}
									onPress={onPhotoPress}
									onTouchStart={onTouchStartLegacy}
									onTouchMove={onTouchMoveLegacy}
									onTouchEnd={onTouchEndLegacy}
									style={imageZoomStyle as any}
									imageRef={imageRef}
									onNaturalSize={(w: number, h: number) => {
										if (w > 0 && h > 0) {
											naturalSizeRef.current = { w, h };
											measureViewport();
										}
									}}
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
