// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit d60c1de3106a7947b9e27cefa9a96264dd0d454d5daa9f38c4ff3d17d10a4f54
import clsx from 'clsx';
import type { CSSProperties, TouchEvent as ReactTouchEvent, PointerEvent, WheelEvent } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryPhoto } from '../types/gallery';
import { getCaptionText } from '../utils/get-caption-text';
import { Image } from './image';

interface PhotoProps {
	photo?: GalleryPhoto | null;
	enableZoom?: boolean;
	onPress?: () => void;
	onTouchStart?: (event: ReactTouchEvent<HTMLButtonElement>) => void;
	onTouchMove?: (event: ReactTouchEvent<HTMLButtonElement>) => void;
	onTouchEnd?: (event: ReactTouchEvent<HTMLButtonElement>) => void;
	onLoad?: () => void;
	onError?: () => void;
	style?: CSSProperties;
}

function Photo({
	photo = null,
	enableZoom = true,
	onPress,
	onTouchStart,
	onTouchMove,
	onTouchEnd,
	onLoad,
	onError,
	style,
}: PhotoProps) {
	const [scale, setScale] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	
	const containerRef = useRef<HTMLButtonElement | null>(null);

	// Reset zoom on photo change or if zoom is disabled
	useEffect(() => {
		setScale(1);
		setPan({ x: 0, y: 0 });
		lastScale.current = 1;
	}, [photo, enableZoom]);

	const clampPan = useCallback((newScale: number, panX: number, panY: number) => {
		if (!containerRef.current || !containerRef.current.querySelector('img')) return { x: 0, y: 0 };
		
		const img = containerRef.current?.querySelector('img');
		const container = containerRef.current;
		const viewportW = container.clientWidth;
		const viewportH = container.clientHeight;
		
		const natW = img.naturalWidth;
		const natH = img.naturalHeight;
		
		if (!natW || !natH) return { x: 0, y: 0 };
		
		// Rendered aspect-fit size
		const aspect = natW / natH;
		const viewportAspect = viewportW / viewportH;
		
		let renderedW = viewportW;
		let renderedH = viewportH;
		
		if (viewportAspect > aspect) {
			renderedW = viewportH * aspect;
		} else {
			renderedH = viewportW / aspect;
		}
		
		const maxPanX = Math.max(0, (renderedW * newScale - viewportW) / 2);
		const maxPanY = Math.max(0, (renderedH * newScale - viewportH) / 2);
		
		return {
			x: Math.max(-maxPanX, Math.min(maxPanX, panX)),
			y: Math.max(-maxPanY, Math.min(maxPanY, panY))
		};
	}, []);

	// Refs to track gestures
	const isDragging = useRef(false);
	const lastPointer = useRef<{ x: number; y: number } | null>(null);
	const initialPinchDist = useRef<number | null>(null);
	const initialPinchScale = useRef<number>(1);
	const lastScale = useRef(1);

	const updateScaleAndPan = useCallback((newScale: number, cx: number, cy: number) => {
		newScale = Math.max(1, Math.min(newScale, 10)); // max zoom 10x
		if (newScale === 1) {
			setScale(1);
			setPan({ x: 0, y: 0 });
			return;
		}
		
		setPan(prevPan => {
			const ds = newScale / lastScale.current;
			// (cx - pan) / scale should be constant
			// newPan = cx - (cx - pan) * ds
			const newPanX = cx - (cx - prevPan.x) * ds;
			const newPanY = cy - (cy - prevPan.y) * ds;
			
			return clampPan(newScale, newPanX, newPanY);
		});
		setScale(newScale);
		lastScale.current = newScale;
	}, [clampPan]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const handleWheel = (e: globalThis.WheelEvent) => {
			if (!enableZoom) return;
			e.preventDefault();
			const containerRect = container.getBoundingClientRect();
			const vcx = e.clientX - (containerRect.left + containerRect.width / 2);
			const vcy = e.clientY - (containerRect.top + containerRect.height / 2);
			// Determine zoom direction and speed. Use a sensible factor.
			// Standardize wheel delta since it varies across browsers/devices.
			const delta = -e.deltaY;
			// limit delta to avoid jumping too fast
			const normalizedDelta = Math.max(-100, Math.min(100, delta));
			const zoomFactor = Math.pow(1.005, normalizedDelta);
			updateScaleAndPan(lastScale.current * zoomFactor, vcx, vcy);
		};
		// non-passive wheel listener
		container.addEventListener('wheel', handleWheel, { passive: false });
		return () => container.removeEventListener('wheel', handleWheel);
	}, [enableZoom, updateScaleAndPan]);

	const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLButtonElement>) => {
		if (!enableZoom) {
			onTouchStart?.(e);
			return;
		}
		
		if (e.targetTouches.length === 2) {
			// Pinch
			const dx = e.targetTouches[0].clientX - e.targetTouches[1].clientX;
			const dy = e.targetTouches[0].clientY - e.targetTouches[1].clientY;
			initialPinchDist.current = Math.hypot(dx, dy);
			initialPinchScale.current = lastScale.current;
		} else if (e.targetTouches.length === 1) {
			lastPointer.current = { x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY };
			if (lastScale.current === 1) {
				onTouchStart?.(e);
			}
		}
	}, [enableZoom, onTouchStart]);

	const handleTouchMove = useCallback((e: ReactTouchEvent<HTMLButtonElement>) => {
		if (!enableZoom) {
			onTouchMove?.(e);
			return;
		}
		
		if (e.targetTouches.length === 2) {
			if (initialPinchDist.current) {
				const dx = e.targetTouches[0].clientX - e.targetTouches[1].clientX;
				const dy = e.targetTouches[0].clientY - e.targetTouches[1].clientY;
				const dist = Math.hypot(dx, dy);
				const zoomFactor = dist / initialPinchDist.current;
				
				const cx = (e.targetTouches[0].clientX + e.targetTouches[1].clientX) / 2;
				const cy = (e.targetTouches[0].clientY + e.targetTouches[1].clientY) / 2;
				const containerRect = containerRef.current!.getBoundingClientRect();
				const vcx = cx - (containerRect.left + containerRect.width / 2);
				const vcy = cy - (containerRect.top + containerRect.height / 2);
				
				const newScale = initialPinchScale.current * zoomFactor;
				updateScaleAndPan(newScale, vcx, vcy);
			}
		} else if (e.targetTouches.length === 1 && lastPointer.current) {
			const clientX = e.targetTouches[0].clientX;
			const clientY = e.targetTouches[0].clientY;
			const dx = clientX - lastPointer.current.x;
			const dy = clientY - lastPointer.current.y;
			lastPointer.current = { x: clientX, y: clientY };
			
			if (lastScale.current > 1) {
				isDragging.current = true;
				setPan(prev => clampPan(lastScale.current, prev.x + dx, prev.y + dy));
			} else {
				onTouchMove?.(e);
			}
		}
	}, [enableZoom, clampPan, updateScaleAndPan, onTouchMove]);

	const handleTouchEnd = useCallback((e: ReactTouchEvent<HTMLButtonElement>) => {
		if (!enableZoom) {
			onTouchEnd?.(e);
			return;
		}
		
		if (e.targetTouches.length < 2) {
			initialPinchDist.current = null;
		}
		if (e.targetTouches.length === 0) {
			lastPointer.current = null;
			setTimeout(() => { isDragging.current = false; }, 50);
		}
		
		if (lastScale.current === 1) {
			onTouchEnd?.(e);
		}
	}, [enableZoom, onTouchEnd]);

	const onPressHandler = useCallback(() => {
		if (!enableZoom) {
			onPress?.();
			return;
		}
		if (lastScale.current === 1 && !isDragging.current) {
			onPress?.();
		}
	}, [enableZoom, onPress]);

	// For mouse drag panning
	useEffect(() => {
		const container = containerRef.current;
		if (!container || !enableZoom) return;

		let mouseDragging = false;
		let lastMouse = { x: 0, y: 0 };

		const onMouseDown = (e: MouseEvent) => {
			if (lastScale.current > 1) {
				mouseDragging = true;
				lastMouse = { x: e.clientX, y: e.clientY };
			}
		};

		const onMouseMove = (e: MouseEvent) => {
			if (mouseDragging && lastScale.current > 1) {
				const dx = e.clientX - lastMouse.x;
				const dy = e.clientY - lastMouse.y;
				lastMouse = { x: e.clientX, y: e.clientY };
				isDragging.current = true;
				setPan(prev => clampPan(lastScale.current, prev.x + dx, prev.y + dy));
			}
		};

		const onMouseUp = () => {
			mouseDragging = false;
			setTimeout(() => { isDragging.current = false; }, 50);
		};

		container.addEventListener('mousedown', onMouseDown);
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);

		return () => {
			container.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, [enableZoom, clampPan]);

	if (!photo) return null;

	const captionText = getCaptionText(photo.caption);
	const className = clsx(
		'gallery-media-photo',
		'gallery-media-photo--block',
		'gallery-media-cover',
	);

	return (
		<ul className="gallery-images--ul gallery-photo-list">
			<li className={clsx(className, 'gallery-photo-item')}>
				<button
					type="button"
					ref={containerRef}
					onClick={onPressHandler}
					className="photo-button gallery-photo-button"
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					{/* Wrapper just for rendering, we use imgRef via standard props if Image exposed it, but we can't easily. Wait, we can pass ref to Image? */}
					<Image
						alt={photo.alt || captionText}
						className="photo gallery-photo-image"
						src={photo.photo || ''}
						onLoad={onLoad}
						onError={onError}
						style={style}
						scale={scale}
						panX={pan.x}
						panY={pan.y}
					/>
				</button>
			</li>
		</ul>
	);
}

const MemoizedPhoto = memo(Photo);
export { MemoizedPhoto as Photo };
