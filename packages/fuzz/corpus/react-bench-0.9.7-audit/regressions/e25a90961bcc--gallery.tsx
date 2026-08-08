// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit e25a90961bccceac28be38789e68d1c1af1e9fc9408ccb7fcda7aa3bae6df9e3
import type {
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

interface GalleryState {
	activePhotoIndex: number;
	hidePrevButton: boolean;
	hideNextButton: boolean;
	controlsDisabled: boolean;
}

const EMPTY_PHOTOS: GalleryPhoto[] = [];

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function getNormalizedActivePhotoIndex(
	activePhotoIndex: number,
	totalPhotos: number,
): number {
	if (totalPhotos === 0) return 0;
	return Math.min(Math.max(activePhotoIndex, 0), totalPhotos - 1);
}

function getWrapControlState(
	activePhotoIndex: number,
	totalPhotos: number,
	wrap: boolean,
) {
	if (wrap || totalPhotos <= 1) {
		return { hidePrevButton: false, hideNextButton: false };
	}
	return {
		hidePrevButton: activePhotoIndex === 0,
		hideNextButton: activePhotoIndex === totalPhotos - 1,
	};
}

function getRenderedSize(
	viewportW: number,
	viewportH: number,
	naturalW?: number,
	naturalH?: number,
): { renderedW: number; renderedH: number } {
	if (!naturalW || !naturalH || naturalW <= 0 || naturalH <= 0) {
		return { renderedW: viewportW, renderedH: viewportH };
	}
	const aspect = naturalW / naturalH;
	const vpAspect = viewportW / viewportH || 1;
	if (aspect > vpAspect) {
		return { renderedW: viewportW, renderedH: viewportW / aspect };
	}
	return { renderedW: viewportH * aspect, renderedH: viewportH };
}

function clampPan(
	panX: number,
	panY: number,
	scale: number,
	viewportW: number,
	viewportH: number,
	naturalW?: number,
	naturalH?: number,
): { x: number; y: number } {
	if (viewportW <= 0 || viewportH <= 0) {
		return { x: 0, y: 0 };
	}
	const { renderedW, renderedH } = getRenderedSize(
		viewportW,
		viewportH,
		naturalW,
		naturalH,
	);
	const maxX = Math.max(0, (renderedW * scale - viewportW) / 2);
	const maxY = Math.max(0, (renderedH * scale - viewportH) / 2);
	let x = panX;
	let y = panY;
	if (maxX === 0) {
		x = 0;
	} else {
		x = Math.max(-maxX, Math.min(maxX, x));
	}
	if (maxY === 0) {
		y = 0;
	} else {
		y = Math.max(-maxY, Math.min(maxY, y));
	}
	return { x, y };
}

function getTouchList(ev: ReactTouchEvent): any[] {
	const eAny = ev as any;
	if (eAny.touches && eAny.touches.length > 0) {
		return Array.from(eAny.touches);
	}
	if (eAny.targetTouches && eAny.targetTouches.length > 0) {
		return Array.from(eAny.targetTouches);
	}
	if (eAny.changedTouches && eAny.changedTouches.length > 0) {
		return Array.from(eAny.changedTouches);
	}
	return [];
}

function getActiveTouchCount(ev: ReactTouchEvent): number {
	const eAny = ev as any;
	if (eAny.touches && typeof eAny.touches.length === 'number') {
		return eAny.touches.length;
	}
	if (eAny.targetTouches && typeof eAny.targetTouches.length === 'number') {
		return eAny.targetTouches.length;
	}
	return 0;
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
		};
	});

	const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });

	const viewportRef = useRef<HTMLDivElement>(null);
	const naturalSizeRef = useRef<{ w: number; h: number } | null>(null);

	const isDraggingRef = useRef(false);
	const dragStartPosRef = useRef({ x: 0, y: 0 });
	const dragStartPanRef = useRef({ x: 0, y: 0 });
	const hasDraggedRef = useRef(false);

	const isPinchingRef = useRef(false);
	const pinchStartDistRef = useRef(0);
	const pinchStartScaleRef = useRef(1);
	const pinchStartPanRef = useRef({ x: 0, y: 0 });
	const pinchStartCenterRef = useRef({
		x: 0,
		y: 0,
		clientX: 0,
		clientY: 0,
	});

	const suppressClickRef = useRef(false);
	const touchStartXRef = useRef<number | null>(null);
	const touchEndXRef = useRef<number | null>(null);
	const touchMovedRef = useRef(false);

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

	useEffect(() => {
		setZoom({ scale: 1, x: 0, y: 0 });
	}, [state.activePhotoIndex]);

	useEffect(() => {
		if (!enableZoom) {
			setZoom({ scale: 1, x: 0, y: 0 });
		}
	}, [enableZoom]);

	useEffect(() => {
		const onResize = () => {
			const rect = viewportRef.current?.getBoundingClientRect();
			if (!rect) return;
			const vw = rect.width;
			const vh = rect.height;
			if (vw === 0 && vh === 0) return;
			const natural = naturalSizeRef.current;
			setZoom((prev) => {
				const clamped = clampPan(
					prev.x,
					prev.y,
					prev.scale,
					vw,
					vh,
					natural?.w,
					natural?.h,
				);
				if (clamped.x === prev.x && clamped.y === prev.y) return prev;
				return { ...prev, x: clamped.x, y: clamped.y };
			});
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!isDraggingRef.current) return;
			const dx = e.clientX - dragStartPosRef.current.x;
			const dy = e.clientY - dragStartPosRef.current.y;
			if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
				hasDraggedRef.current = true;
			}
			const newX = dragStartPanRef.current.x + dx;
			const newY = dragStartPanRef.current.y + dy;
			const rect = viewportRef.current?.getBoundingClientRect();
			if (!rect) return;
			const natural = naturalSizeRef.current;
			const clamped = clampPan(
				newX,
				newY,
				zoom.scale,
				rect.width,
				rect.height,
				natural?.w,
				natural?.h,
			);
			setZoom((prev) => {
				if (prev.x === clamped.x && prev.y === clamped.y) return prev;
				return { ...prev, x: clamped.x, y: clamped.y };
			});
		};
		const onMouseUp = () => {
			if (isDraggingRef.current) {
				isDraggingRef.current = false;
				if (hasDraggedRef.current) {
					suppressClickRef.current = true;
					setTimeout(() => {
						suppressClickRef.current = false;
						hasDraggedRef.current = false;
					}, 200);
				}
			}
		};
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, [zoom.scale]);

	const getItemByDirection = useCallback(
		(direction: string, activeIndex: number) => {
			if (photos.length === 0) return 0;
			const isNextDirection = direction === DIRECTION_NEXT;
			const isPrevDirection = direction === DIRECTION_PREV;
			const lastItemIndex = photos.length - 1;
			const isGoingToWrap =
				(isPrevDirection && activeIndex === 0) ||
				(isNextDirection && activeIndex === lastItemIndex);
			if (isGoingToWrap && !wrap) return activeIndex;
			const delta = isPrevDirection ? -1 : 1;
			const itemIndex = (activeIndex + delta) % photos.length;
			return itemIndex === -1 ? photos.length - 1 : itemIndex;
		},
		[photos, wrap],
	);

	const move = useCallback(
		(direction: string, index: number | false = false) => {
			setZoom({ scale: 1, x: 0, y: 0 });
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

	const prev = useCallback(() => move(DIRECTION_PREV), [move]);
	const next = useCallback(() => move(DIRECTION_NEXT), [move]);

	useImperativeHandle(ref, () => ({ prev, next }), [prev, next]);

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

	const handleNaturalSize = useCallback((w: number, h: number) => {
		naturalSizeRef.current = { w, h };
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!rect) return;
		const vw = rect.width;
		const vh = rect.height;
		if (vw === 0 && vh === 0) return;
		setZoom((prev) => {
			const clamped = clampPan(prev.x, prev.y, prev.scale, vw, vh, w, h);
			if (clamped.x === prev.x && clamped.y === prev.y) return prev;
			return { ...prev, x: clamped.x, y: clamped.y };
		});
	}, []);

	const onPhotoPress = useCallback(() => {
		if (suppressClickRef.current || hasDraggedRef.current) {
			hasDraggedRef.current = false;
			return;
		}
		if (enableZoom && zoom.scale > 1.01) {
			return;
		}
		move(DIRECTION_NEXT);
		activePhotoPressed?.();
	}, [activePhotoPressed, enableZoom, move, zoom.scale]);

	const handleTouchStart = useCallback(
		(event: ReactTouchEvent) => {
			const touches = getTouchList(event);
			if (touches.length === 1) {
				const t = touches[0];
				const sx = (t.screenX ?? t.clientX) as number;
				touchStartXRef.current = sx;
				touchEndXRef.current = null;
				touchMovedRef.current = false;
			}

			if (!enableZoom) return;

			if (touches.length === 2) {
				const t1 = touches[0];
				const t2 = touches[1];
				const dist = Math.hypot(
					t1.clientX - t2.clientX,
					t1.clientY - t2.clientY,
				);
				pinchStartDistRef.current = dist;
				pinchStartScaleRef.current = zoom.scale;
				pinchStartPanRef.current = { x: zoom.x, y: zoom.y };
				const rect = viewportRef.current?.getBoundingClientRect();
				if (rect) {
					const centerClientX = (t1.clientX + t2.clientX) / 2;
					const centerClientY = (t1.clientY + t2.clientY) / 2;
					pinchStartCenterRef.current = {
						x: centerClientX - rect.left - rect.width / 2,
						y: centerClientY - rect.top - rect.height / 2,
						clientX: centerClientX,
						clientY: centerClientY,
					};
				}
				isPinchingRef.current = true;
			} else if (touches.length === 1 && zoom.scale > 1.01) {
				const t = touches[0];
				isDraggingRef.current = true;
				hasDraggedRef.current = false;
				dragStartPosRef.current = { x: t.clientX, y: t.clientY };
				dragStartPanRef.current = { x: zoom.x, y: zoom.y };
			}
		},
		[enableZoom, zoom.scale, zoom.x, zoom.y],
	);

	const handleTouchMove = useCallback(
		(event: ReactTouchEvent) => {
			const touches = getTouchList(event);

			if (touches.length === 1) {
				const t = touches[0];
				const ex = (t.screenX ?? t.clientX) as number;
				touchEndXRef.current = ex;
				if (
					touchStartXRef.current !== null &&
					Math.abs(ex - touchStartXRef.current) > 3
				) {
					touchMovedRef.current = true;
				}
			}

			if (!enableZoom) return;

			if (isPinchingRef.current && touches.length === 2) {
				const t1 = touches[0];
				const t2 = touches[1];
				const dist = Math.hypot(
					t1.clientX - t2.clientX,
					t1.clientY - t2.clientY,
				);
				const rect = viewportRef.current?.getBoundingClientRect();
				if (!rect) return;
				const vw = rect.width;
				const vh = rect.height;
				if (vw === 0 && vh === 0) return;
				const startDist = pinchStartDistRef.current;
				if (startDist === 0) return;
				const ratio = dist / startDist;
				let newScale = pinchStartScaleRef.current * ratio;
				newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));

				const centerClientX = (t1.clientX + t2.clientX) / 2;
				const centerClientY = (t1.clientY + t2.clientY) / 2;
				const currentCenter = {
					x: centerClientX - rect.left - vw / 2,
					y: centerClientY - rect.top - vh / 2,
				};
				const startCenter = pinchStartCenterRef.current;
				const startPan = pinchStartPanRef.current;
				const ratioScale = newScale / (pinchStartScaleRef.current || 1);

				const newX =
					currentCenter.x - (startCenter.x - startPan.x) * ratioScale;
				const newY =
					currentCenter.y - (startCenter.y - startPan.y) * ratioScale;

				const natural = naturalSizeRef.current;
				const clamped = clampPan(
					newX,
					newY,
					newScale,
					vw,
					vh,
					natural?.w,
					natural?.h,
				);

				setZoom({ scale: newScale, x: clamped.x, y: clamped.y });
				suppressClickRef.current = true;
				if (event.cancelable) {
					event.preventDefault();
				}
			} else if (
				isDraggingRef.current &&
				touches.length === 1 &&
				zoom.scale > 1.01
			) {
				const t = touches[0];
				const dx = t.clientX - dragStartPosRef.current.x;
				const dy = t.clientY - dragStartPosRef.current.y;
				if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
					hasDraggedRef.current = true;
				}
				const newX = dragStartPanRef.current.x + dx;
				const newY = dragStartPanRef.current.y + dy;
				const rect = viewportRef.current?.getBoundingClientRect();
				if (!rect) return;
				const natural = naturalSizeRef.current;
				const clamped = clampPan(
					newX,
					newY,
					zoom.scale,
					rect.width,
					rect.height,
					natural?.w,
					natural?.h,
				);
				setZoom((prev) => {
					if (prev.x === clamped.x && prev.y === clamped.y) return prev;
					return { ...prev, x: clamped.x, y: clamped.y };
				});
				if (event.cancelable) {
					event.preventDefault();
				}
			}
		},
		[enableZoom, zoom.scale],
	);

	const handleTouchEnd = useCallback(
		(event: ReactTouchEvent) => {
			const activeCount = getActiveTouchCount(event);

			const shouldSuppressNav =
				enableZoom &&
				(zoom.scale > 1.01 ||
					isPinchingRef.current ||
					(isDraggingRef.current && hasDraggedRef.current));

			if (
				!shouldSuppressNav &&
				touchMovedRef.current &&
				touchStartXRef.current !== null &&
				touchEndXRef.current !== null
			) {
				const startX = touchStartXRef.current;
				const endX = touchEndXRef.current;
				if (startX < endX) {
					onPrevButtonPress();
				} else if (startX > endX) {
					onNextButtonPress();
				}
			}

			if (activeCount < 2 && isPinchingRef.current) {
				isPinchingRef.current = false;
				suppressClickRef.current = true;
				setTimeout(() => {
					suppressClickRef.current = false;
				}, 300);
				if (zoom.scale <= 1.01) {
					setZoom({ scale: 1, x: 0, y: 0 });
				}
			}

			if (isDraggingRef.current && activeCount === 0) {
				isDraggingRef.current = false;
			}

			if (activeCount === 0) {
				touchStartXRef.current = null;
				touchEndXRef.current = null;
				touchMovedRef.current = false;
			}
		},
		[enableZoom, zoom.scale, onNextButtonPress, onPrevButtonPress],
	);

	const handleMouseDown = useCallback(
		(e: ReactMouseEvent) => {
			if (!enableZoom || zoom.scale <= 1.01) return;
			isDraggingRef.current = true;
			hasDraggedRef.current = false;
			dragStartPosRef.current = { x: e.clientX, y: e.clientY };
			dragStartPanRef.current = { x: zoom.x, y: zoom.y };
			e.preventDefault();
		},
		[enableZoom, zoom.scale, zoom.x, zoom.y],
	);

	const handleWheel = useCallback(
		(e: ReactWheelEvent) => {
			if (!enableZoom) return;
			const rect = viewportRef.current?.getBoundingClientRect();
			if (!rect) return;
			const vw = rect.width;
			const vh = rect.height;
			if (vw === 0 && vh === 0) return;

			const oldScale = zoom.scale;
			let newScale: number;
			if (e.deltaY < 0) {
				newScale = oldScale * 1.15;
			} else {
				newScale = oldScale / 1.15;
			}
			newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));

			if (newScale === oldScale && oldScale === 1) {
				return;
			}

			e.preventDefault();

			const cx = e.clientX - rect.left - vw / 2;
			const cy = e.clientY - rect.top - vh / 2;

			const ratio = newScale / oldScale;
			const newX = cx - (cx - zoom.x) * ratio;
			const newY = cy - (cy - zoom.y) * ratio;

			const natural = naturalSizeRef.current;
			const clamped = clampPan(newX, newY, newScale, vw, vh, natural?.w, natural?.h);

			if (newScale <= 1.01) {
				setZoom({ scale: 1, x: 0, y: 0 });
			} else {
				setZoom({ scale: newScale, x: clamped.x, y: clamped.y });
			}

			suppressClickRef.current = true;
			setTimeout(() => {
				suppressClickRef.current = false;
			}, 300);
		},
		[enableZoom, zoom.scale, zoom.x, zoom.y],
	);

	const to = useCallback(
		(index: number) => {
			if (
				index > photos.length - 1 ||
				index < 0 ||
				state.activePhotoIndex === index
			)
				return;
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
		if (!hasMultiplePhotos) return null;
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

	const displayScale = enableZoom ? zoom.scale : 1;
	const displayX = enableZoom ? zoom.x : 0;
	const displayY = enableZoom ? zoom.y : 0;

	const imageZoomStyle = useMemo(() => {
		return {
			'--rbg-zoom-scale': `${displayScale}`,
			'--rbg-photo-scale': `${displayScale}`,
			'--rbg-scale': `${displayScale}`,
			'--rbg-pan-x': `${displayX}px`,
			'--rbg-pan-y': `${displayY}px`,
			'--rbg-photo-pan-x': `${displayX}px`,
			'--rbg-photo-pan-y': `${displayY}px`,
			transform: `translate3d(${displayX}px, ${displayY}px, 0) translateY(-50%) scale(${displayScale})`,
			transformOrigin: 'center center',
		} as React.CSSProperties;
	}, [displayScale, displayX, displayY]);

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
								onWheel={handleWheel}
								style={{
									touchAction: enableZoom ? 'none' : undefined,
								}}
							>
								<Photo
									photo={current}
									onLoad={onPhotoLoad}
									onError={onPhotoError}
									onPress={onPhotoPress}
									onTouchStart={handleTouchStart}
									onTouchMove={handleTouchMove}
									onTouchEnd={handleTouchEnd}
									onMouseDown={handleMouseDown}
									onNaturalSize={handleNaturalSize}
									style={imageZoomStyle}
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
