// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 0aa25aab81e0842a6ab253e4190e27f97ad22101b75c44b45a413aa620fac766
import type {
	CSSProperties,
	TouchEvent as ReactTouchEvent,
	WheelEvent as ReactWheelEvent,
	MouseEvent as ReactMouseEvent,
} from 'react';
import {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

import { DIRECTION_NEXT, DIRECTION_PREV } from '../constants';
import { defaultPhrases } from '../default-phrases';
import type { GalleryController, GalleryPhoto, GalleryPhrases } from '../types/gallery';
import { Caption } from './caption';
import { NextButton } from './next-button';
import { Photo } from './photo';
import { PrevButton } from './prev-button';

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

function getNormalizedActivePhotoIndex(activePhotoIndex: number, totalPhotos: number): number {
	if (totalPhotos === 0) return 0;
	return Math.min(Math.max(activePhotoIndex, 0), totalPhotos - 1);
}

function getWrapControlState(activePhotoIndex: number, totalPhotos: number, wrap: boolean) {
	if (wrap || totalPhotos <= 1) {
		return { hidePrevButton: false, hideNextButton: false };
	}
	return {
		hidePrevButton: activePhotoIndex === 0,
		hideNextButton: activePhotoIndex === totalPhotos - 1,
	};
}

function getDistance(t1: { clientX: number; clientY: number }, t2: { clientX: number; clientY: number }) {
	const dx = t2.clientX - t1.clientX;
	const dy = t2.clientY - t1.clientY;
	return Math.hypot(dx, dy);
}

function getRenderedLetterboxedSize(
	naturalW: number,
	naturalH: number,
	viewportW: number,
	viewportH: number,
) {
	if (!naturalW || !naturalH || !viewportW || !viewportH) {
		if (viewportW && viewportH) return { width: viewportW, height: viewportH };
		return { width: 0, height: 0 };
	}
	const naturalRatio = naturalW / naturalH;
	const viewportRatio = viewportW / viewportH;
	if (naturalRatio > viewportRatio) {
		const width = viewportW;
		const height = viewportW / naturalRatio;
		return { width, height };
	} else {
		const height = viewportH;
		const width = viewportH * naturalRatio;
		return { width, height };
	}
}

function clampPan(
	panX: number,
	panY: number,
	scale: number,
	renderedW: number,
	renderedH: number,
	viewportW: number,
	viewportH: number,
) {
	const maxX = Math.max(0, (renderedW * scale - viewportW) / 2);
	const maxY = Math.max(0, (renderedH * scale - viewportH) / 2);
	const clampedX = maxX === 0 ? 0 : Math.min(Math.max(panX, -maxX), maxX);
	const clampedY = maxY === 0 ? 0 : Math.min(Math.max(panY, -maxY), maxY);
	return { x: clampedX, y: clampedY, maxX, maxY };
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
		const n = getNormalizedActivePhotoIndex(activePhotoIndex, photos.length);
		const { hidePrevButton, hideNextButton } = getWrapControlState(n, photos.length, wrap);
		return {
			activePhotoIndex: n,
			hidePrevButton,
			hideNextButton,
			controlsDisabled: true,
			touchStartInfo: null,
			touchEndInfo: null,
			touchMoved: false,
		};
	});

	const [zoomScale, setZoomScale] = useState(1);
	const [panX, setPanX] = useState(0);
	const [panY, setPanY] = useState(0);

	const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

	const viewportRef = useRef<HTMLDivElement | null>(null);
	const imageElementRef = useRef<HTMLImageElement | null>(null);

	// Track prop changes for immediate reset without flicker
	const normalizedPropIndex = getNormalizedActivePhotoIndex(activePhotoIndex, photos.length);
	const prevPropIndexRef = useRef(normalizedPropIndex);
	const propChangedDuringRender = prevPropIndexRef.current !== normalizedPropIndex;

	const dragRef = useRef<{
		active: boolean;
		startClientX: number;
		startClientY: number;
		startPanX: number;
		startPanY: number;
		moved: boolean;
	}>({ active: false, startClientX: 0, startClientY: 0, startPanX: 0, startPanY: 0, moved: false });

	const pinchRef = useRef<{
		active: boolean;
		startDistance: number;
		startScale: number;
		centerX: number;
		centerY: number;
		startPanX: number;
		startPanY: number;
	}>({ active: false, startDistance: 0, startScale: 1, centerX: 0, centerY: 0, startPanX: 0, startPanY: 0 });

	const suppressClickRef = useRef(false);

	useEffect(() => {
		if (!enableZoom) {
			setZoomScale(1);
			setPanX(0);
			setPanY(0);
			dragRef.current.active = false;
			dragRef.current.moved = false;
			pinchRef.current.active = false;
		}
	}, [enableZoom]);

	// Measure viewport size
	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const update = () => {
			const rect = el.getBoundingClientRect();
			const w = rect.width || (el as HTMLElement).offsetWidth || 0;
			const h = rect.height || (el as HTMLElement).offsetHeight || 0;
			setViewportSize((prev) => {
				if (prev.width === w && prev.height === h) return prev;
				return { width: w, height: h };
			});
		};
		update();
		let ro: ResizeObserver | undefined;
		if (typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(update);
			ro.observe(el);
		} else {
			window.addEventListener('resize', update);
		}
		return () => {
			if (ro) ro.disconnect();
			else window.removeEventListener('resize', update);
		};
	}, [state.activePhotoIndex]);

	useEffect(() => {
		const el = viewportRef.current?.querySelector('img.gallery-photo-image') as HTMLImageElement | null;
		if (el) {
			imageElementRef.current = el;
			if (el.complete && el.naturalWidth) {
				setNaturalSize({ width: el.naturalWidth, height: el.naturalHeight });
			}
		}
	});

	const getViewportRect = useCallback(() => {
		const el = viewportRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		const width = rect.width || (el as HTMLElement).offsetWidth || viewportSize.width;
		const height = rect.height || (el as HTMLElement).offsetHeight || viewportSize.height;
		return {
			left: rect.left,
			top: rect.top,
			width,
			height,
			right: rect.left + width,
			bottom: rect.top + height,
		};
	}, [viewportSize]);

	useEffect(() => {
		const vRect = getViewportRect();
		const vpW = vRect?.width ?? viewportSize.width;
		const vpH = vRect?.height ?? viewportSize.height;
		const rendered = getRenderedLetterboxedSize(naturalSize.width, naturalSize.height, vpW, vpH);
		const clamped = clampPan(panX, panY, zoomScale, rendered.width, rendered.height, vpW, vpH);
		if (clamped.x !== panX || clamped.y !== panY) {
			setPanX(clamped.x);
			setPanY(clamped.y);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [zoomScale, naturalSize, viewportSize]);

	// When prop changes, reset zoom and sync internal index immediately in layout effect
	useLayoutEffect(() => {
		if (prevPropIndexRef.current !== normalizedPropIndex) {
			prevPropIndexRef.current = normalizedPropIndex;
			setZoomScale(1);
			setPanX(0);
			setPanY(0);
			dragRef.current.active = false;
			dragRef.current.moved = false;
			pinchRef.current.active = false;
		}
		const { hidePrevButton, hideNextButton } = getWrapControlState(
			normalizedPropIndex,
			photos.length,
			wrap,
		);
		setState((prev) => {
			if (
				prev.activePhotoIndex === normalizedPropIndex &&
				prev.hidePrevButton === hidePrevButton &&
				prev.hideNextButton === hideNextButton
			) {
				return prev;
			}
			return { ...prev, activePhotoIndex: normalizedPropIndex, hidePrevButton, hideNextButton };
		});
	}, [normalizedPropIndex, photos.length, wrap]);

	useEffect(() => {
		onActivePhotoIndexChange?.(state.activePhotoIndex);
	}, [onActivePhotoIndexChange, state.activePhotoIndex]);

	const getItemByDirection = useCallback(
		(direction: string, activeIndex: number) => {
			if (photos.length === 0) return 0;
			const isNext = direction === DIRECTION_NEXT;
			const isPrev = direction === DIRECTION_PREV;
			const last = photos.length - 1;
			const willWrap = (isPrev && activeIndex === 0) || (isNext && activeIndex === last);
			if (willWrap && !wrap) return activeIndex;
			const delta = isPrev ? -1 : 1;
			const idx = (activeIndex + delta) % photos.length;
			return idx === -1 ? photos.length - 1 : idx;
		},
		[photos, wrap],
	);

	const move = useCallback(
		(direction: string, index: number | false = false) => {
			setZoomScale(1);
			setPanX(0);
			setPanY(0);
			dragRef.current.active = false;
			dragRef.current.moved = false;
			pinchRef.current.active = false;

			setState((prevState) => {
				const nextIdx = index !== false ? index : getItemByDirection(direction, prevState.activePhotoIndex);
				const { hidePrevButton, hideNextButton } = getWrapControlState(nextIdx, photos.length, wrap);
				return { ...prevState, activePhotoIndex: nextIdx, hidePrevButton, hideNextButton };
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

	useImperativeHandle(ref, () => ({ prev, next }), [prev, next]);

	const onNextButtonPress = useCallback(() => {
		if (enableZoom && zoomScale > 1.001) return;
		next();
		nextButtonPressed?.();
	}, [next, nextButtonPressed, enableZoom, zoomScale]);

	const onPrevButtonPress = useCallback(() => {
		if (enableZoom && zoomScale > 1.001) return;
		prev();
		prevButtonPressed?.();
	}, [prev, prevButtonPressed, enableZoom, zoomScale]);

	const onPhotoLoad = useCallback(() => {
		setState((prev) => ({ ...prev, controlsDisabled: false }));
		const el = (imageElementRef.current ??
			viewportRef.current?.querySelector('img.gallery-photo-image')) as HTMLImageElement | null;
		if (el) {
			setNaturalSize({ width: el.naturalWidth || 0, height: el.naturalHeight || 0 });
		}
	}, []);

	const onPhotoError = useCallback(() => {
		setState((prev) => ({ ...prev, controlsDisabled: false }));
	}, []);

	const onPhotoPress = useCallback(() => {
		if (suppressClickRef.current) {
			suppressClickRef.current = false;
			return;
		}
		if (enableZoom && zoomScale > 1.001) return;
		if (enableZoom && dragRef.current.moved) {
			dragRef.current.moved = false;
			return;
		}
		move(DIRECTION_NEXT);
		activePhotoPressed?.();
	}, [activePhotoPressed, move, enableZoom, zoomScale]);

	const onWheel = useCallback(
		(e: ReactWheelEvent) => {
			if (!enableZoom) return;
			e.preventDefault();
			e.stopPropagation();
			const vRect = getViewportRect();
			if (!vRect) return;
			const centerX = vRect.left + vRect.width / 2;
			const centerY = vRect.top + vRect.height / 2;
			const focalX = e.clientX - centerX;
			const focalY = e.clientY - centerY;

			const delta = e.deltaY;
			const factor = Math.exp(-delta * 0.003);
			let nextScale = zoomScale * factor;
			nextScale = Math.min(Math.max(nextScale, 1), 4);

			if (Math.abs(nextScale - zoomScale) < 0.001) {
				if (nextScale <= 1.001) {
					setZoomScale(1);
					setPanX(0);
					setPanY(0);
				}
				return;
			}

			let nextPanX: number;
			let nextPanY: number;
			if (nextScale <= 1.001) {
				nextScale = 1;
				nextPanX = 0;
				nextPanY = 0;
			} else {
				const s0 = zoomScale;
				const s1 = nextScale;
				nextPanX = panX * (s1 / s0) + focalX * (1 - s1 / s0);
				nextPanY = panY * (s1 / s0) + focalY * (1 - s1 / s0);
			}

			const rendered = getRenderedLetterboxedSize(
				naturalSize.width,
				naturalSize.height,
				vRect.width,
				vRect.height,
			);
			const clamped = clampPan(nextPanX, nextPanY, nextScale, rendered.width, rendered.height, vRect.width, vRect.height);
			setZoomScale(nextScale);
			setPanX(clamped.x);
			setPanY(clamped.y);
			suppressClickRef.current = true;
			setTimeout(() => {
				suppressClickRef.current = false;
			}, 100);
		},
		[enableZoom, zoomScale, panX, panY, getViewportRect, naturalSize],
	);

	const onMouseDown = useCallback(
		(e: ReactMouseEvent) => {
			if (!enableZoom) return;
			if (zoomScale <= 1.001) return;
			if (e.button !== 0) return;
			e.preventDefault();
			dragRef.current = {
				active: true,
				startClientX: e.clientX,
				startClientY: e.clientY,
				startPanX: panX,
				startPanY: panY,
				moved: false,
			};
		},
		[enableZoom, zoomScale, panX, panY],
	);

	useEffect(() => {
		const handleMouseMove = (ev: MouseEvent) => {
			if (!dragRef.current.active) return;
			const dx = ev.clientX - dragRef.current.startClientX;
			const dy = ev.clientY - dragRef.current.startClientY;
			if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
				dragRef.current.moved = true;
				suppressClickRef.current = true;
			}
			let nextPanX = dragRef.current.startPanX + dx;
			let nextPanY = dragRef.current.startPanY + dy;
			const vRect = getViewportRect();
			if (vRect) {
				const rendered = getRenderedLetterboxedSize(
					naturalSize.width,
					naturalSize.height,
					vRect.width,
					vRect.height,
				);
				const clamped = clampPan(nextPanX, nextPanY, zoomScale, rendered.width, rendered.height, vRect.width, vRect.height);
				setPanX(clamped.x);
				setPanY(clamped.y);
			} else {
				setPanX(nextPanX);
				setPanY(nextPanY);
			}
		};
		const handleMouseUp = () => {
			if (dragRef.current.active) {
				dragRef.current.active = false;
				if (dragRef.current.moved) {
					setTimeout(() => {
						suppressClickRef.current = false;
						dragRef.current.moved = false;
					}, 0);
				} else {
					suppressClickRef.current = false;
				}
			}
		};
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [zoomScale, getViewportRect, naturalSize]);

	const handleSwipeTouchStart = useCallback(
		(event: ReactTouchEvent) => {
			if (enableZoom) {
				const touches = event.targetTouches;
				if (touches.length === 2) {
					const d = getDistance(touches[0] as any, touches[1] as any) || 1;
					pinchRef.current = {
						active: true,
						startDistance: d,
						startScale: zoomScale,
						centerX: (touches[0].clientX + touches[1].clientX) / 2,
						centerY: (touches[0].clientY + touches[1].clientY) / 2,
						startPanX: panX,
						startPanY: panY,
					};
					setState((prev) => ({
						...prev,
						touchStartInfo: null,
						touchEndInfo: null,
						touchMoved: false,
					}));
					return;
				}
				if (touches.length === 1 && zoomScale > 1.001) {
					const t = touches[0];
					dragRef.current = {
						active: true,
						startClientX: (t as any).clientX,
						startClientY: (t as any).clientY,
						startPanX: panX,
						startPanY: panY,
						moved: false,
					};
					setState((prev) => ({
						...prev,
						touchStartInfo: null,
						touchEndInfo: null,
						touchMoved: false,
					}));
					return;
				}
			}
			if (enableZoom && zoomScale > 1.001) {
				setState((prev) => ({
					...prev,
					touchStartInfo: null,
					touchEndInfo: null,
					touchMoved: false,
				}));
				return;
			}
			setState((prev) => ({
				...prev,
				touchStartInfo: event.targetTouches[0] as any,
			}));
		},
		[enableZoom, zoomScale, panX, panY],
	);

	const handleSwipeTouchMove = useCallback(
		(event: ReactTouchEvent) => {
			if (enableZoom) {
				const touches = event.targetTouches;
				if (pinchRef.current.active && touches.length === 2) {
					(event as any).preventDefault?.();
					const curDist = getDistance(touches[0] as any, touches[1] as any);
					const factor = curDist / (pinchRef.current.startDistance || 1);
					let nextScale = pinchRef.current.startScale * factor;
					nextScale = Math.min(Math.max(nextScale, 1), 4);
					const vRect = getViewportRect();
					if (vRect) {
						const focalX =
							(touches[0].clientX + touches[1].clientX) / 2 - (vRect.left + vRect.width / 2);
						const focalY =
							(touches[0].clientY + touches[1].clientY) / 2 - (vRect.top + vRect.height / 2);
						let nextPanX: number;
						let nextPanY: number;
						if (nextScale <= 1.001) {
							nextScale = 1;
							nextPanX = 0;
							nextPanY = 0;
						} else {
							const s0 = pinchRef.current.startScale;
							const s1 = nextScale;
							const p0x = pinchRef.current.startPanX;
							const p0y = pinchRef.current.startPanY;
							nextPanX = p0x * (s1 / s0) + focalX * (1 - s1 / s0);
							nextPanY = p0y * (s1 / s0) + focalY * (1 - s1 / s0);
						}
						const rendered = getRenderedLetterboxedSize(
							naturalSize.width,
							naturalSize.height,
							vRect.width,
							vRect.height,
						);
						const clamped = clampPan(
							nextPanX,
							nextPanY,
							nextScale,
							rendered.width,
							rendered.height,
							vRect.width,
							vRect.height,
						);
						setZoomScale(nextScale);
						setPanX(clamped.x);
						setPanY(clamped.y);
					} else {
						if (nextScale <= 1.001) {
							setZoomScale(1);
							setPanX(0);
							setPanY(0);
						} else {
							setZoomScale(nextScale);
						}
					}
					suppressClickRef.current = true;
					return;
				}
				if (dragRef.current.active && touches.length === 1) {
					(event as any).preventDefault?.();
					const t: any = touches[0];
					const dx = t.clientX - dragRef.current.startClientX;
					const dy = t.clientY - dragRef.current.startClientY;
					if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
					let nextPanX = dragRef.current.startPanX + dx;
					let nextPanY = dragRef.current.startPanY + dy;
					const vRect = getViewportRect();
					if (vRect) {
						const rendered = getRenderedLetterboxedSize(
							naturalSize.width,
							naturalSize.height,
							vRect.width,
							vRect.height,
						);
						const clamped = clampPan(
							nextPanX,
							nextPanY,
							zoomScale,
							rendered.width,
							rendered.height,
							vRect.width,
							vRect.height,
						);
						setPanX(clamped.x);
						setPanY(clamped.y);
					} else {
						setPanX(nextPanX);
						setPanY(nextPanY);
					}
					suppressClickRef.current = true;
					return;
				}
			}
			if (enableZoom && zoomScale > 1.001) return;
			setState((prev) => ({
				...prev,
				touchMoved: true,
				touchEndInfo: event.targetTouches[0] as any,
			}));
		},
		[enableZoom, zoomScale, getViewportRect, naturalSize],
	);

	const handleSwipeTouchEnd = useCallback(() => {
		if (enableZoom) {
			if (pinchRef.current.active) {
				pinchRef.current.active = false;
				if (zoomScale <= 1.001) {
					setPanX(0);
					setPanY(0);
				}
				setTimeout(() => {
					suppressClickRef.current = false;
				}, 0);
				return;
			}
			if (dragRef.current.active) {
				dragRef.current.active = false;
				if (dragRef.current.moved) {
					suppressClickRef.current = true;
					setTimeout(() => {
						suppressClickRef.current = false;
					}, 0);
				}
				return;
			}
			if (zoomScale > 1.001) {
				setState((prev) => ({ ...prev, touchMoved: false }));
				return;
			}
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
			return { ...prevState, touchMoved: false };
		});
	}, [onNextButtonPress, onPrevButtonPress, enableZoom, zoomScale]);

	const to = useCallback(
		(index: number) => {
			if (index > photos.length - 1 || index < 0 || state.activePhotoIndex === index) return;
			const direction = index > state.activePhotoIndex ? DIRECTION_NEXT : DIRECTION_PREV;
			move(direction, index);
		},
		[move, photos.length, state.activePhotoIndex],
	);

	const onThumbnailPress = useCallback((index: number) => to(index), [to]);

	const controls = useMemo(() => {
		const hasMultiple = photos.length > 1;
		if (!hasMultiple) return null;
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
	}, [light, onNextButtonPress, onPrevButtonPress, photos.length, state.controlsDisabled, state.hideNextButton, state.hidePrevButton]);

	const galleryModalPreloadPhotos = useMemo(() => {
		let counter = 1;
		let index = state.activePhotoIndex;
		const preloadPhotos = [];
		while (index < photos.length && counter <= preloadSize) {
			const photo = photos[index];
			preloadPhotos.push(<img key={photo.photo} alt={photo.photo} src={photo.photo} />);
			index += 1;
			counter += 1;
		}
		return preloadPhotos;
	}, [photos, preloadSize, state.activePhotoIndex]);

	const hasPhotos = photos.length > 0;
	const current = photos[state.activePhotoIndex];
	const { noPhotosProvided: emptyMessage } = phrases;

	// Effective values: during prop change render, show unmagnified immediately
	const forcedReset = !enableZoom || propChangedDuringRender;
	const effectiveScale = forcedReset ? 1 : zoomScale;
	const effectivePanX = forcedReset ? 0 : panX;
	const effectivePanY = forcedReset ? 0 : panY;

	const zoomImageStyle = useMemo<CSSProperties>(() => {
		const scale = effectiveScale;
		const x = effectivePanX;
		const y = effectivePanY;
		return {
			['--rbg-zoom-scale' as any]: `${scale}`,
			['--rbg-photo-scale' as any]: `${scale}`,
			['--rbg-scale' as any]: `${scale}`,
			['--rbg-pan-x' as any]: `${x}px`,
			['--rbg-photo-pan-x' as any]: `${x}px`,
			['--rbg-pan-y' as any]: `${y}px`,
			['--rbg-photo-pan-y' as any]: `${y}px`,
			left: '50%',
			top: '50%',
			right: 'auto',
			bottom: 'auto',
			transform: `translate3d(-50%, -50%, 0) translate3d(${x}px, ${y}px, 0) scale(${scale})`,
			transformOrigin: 'center center',
		} as CSSProperties;
	}, [effectiveScale, effectivePanX, effectivePanY]);

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
								onWheel={onWheel}
								onMouseDown={onMouseDown}
								style={{
									cursor:
										enableZoom && effectiveScale > 1.001
											? dragRef.current.active
												? 'grabbing'
												: 'grab'
											: undefined,
									touchAction: enableZoom ? 'none' : undefined,
								}}
							>
								<Photo
									photo={current}
									onLoad={onPhotoLoad}
									onError={onPhotoError}
									onPress={onPhotoPress}
									onTouchStart={handleSwipeTouchStart}
									onTouchMove={handleSwipeTouchMove}
									onTouchEnd={handleSwipeTouchEnd}
									style={zoomImageStyle}
								/>
							</div>
						</div>
					) : (
						<div className="gallery-empty">{emptyMessage}</div>
					)}
				</div>
			</div>
			{showThumbnails && current && (
				<Caption phrases={phrases} current={state.activePhotoIndex} photos={photos} onPress={onThumbnailPress} />
			)}
		</div>
	);
});

const MemoizedGallery = memo(Gallery);

export { MemoizedGallery as Gallery };
