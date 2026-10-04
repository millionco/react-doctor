// rule: effect-needs-cleanup
// file-path: src/components/gallery.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 404dd58ecef08ade8f25d2a22770fd204a34ea889a6375f67e9c990502329d12
import type { TouchEvent, WheelEvent, MouseEvent } from 'react';
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

interface TouchInfo { screenX: number; }

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
function getNormalizedActivePhotoIndex(a: number, t: number){ if(t===0) return 0; return Math.min(Math.max(a,0),t-1); }
function getWrapControlState(a: number, t: number, w: boolean){ if(w||t<=1) return {hidePrevButton:false,hideNextButton:false}; return {hidePrevButton:a===0,hideNextButton:a===t-1}; }
interface ZoomState { scale:number; x:number; y:number; }
const MIN_SCALE=1, MAX_SCALE=4;
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
function getLetterboxedSize(vW:number,vH:number,nW:number,nH:number){ if(!vW||!vH||!nW||!nH) return {width:0,height:0}; const i=nW/nH, vp=vW/vH; if(i>vp) return {width:vW,height:vW/i}; else return {height:vH,width:vH*i}; }
function clampPan(pX:number,pY:number,scale:number,vW:number,vH:number,rW:number,rH:number){ const maxX=Math.max(0,(rW*scale - vW)/2); const maxY=Math.max(0,(rH*scale - vH)/2); let x=pX,y=pY; if(maxX<=0.0001) x=0; else x=clamp(pX,-maxX,maxX); if(maxY<=0.0001) y=0; else y=clamp(pY,-maxY,maxY); return {x,y}; }
function getTouchDistance(a:any,b:any){ return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); }
function getTouchMid(a:any,b:any){ return {x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2}; }

const Gallery = forwardRef<GalleryController, GalleryProps>(function Gallery(
	{ activePhotoIndex=0, activePhotoPressed, light=false, nextButtonPressed, onActivePhotoIndexChange, phrases=defaultPhrases, photos=EMPTY_PHOTOS, preloadSize=5, prevButtonPressed, showThumbnails=true, wrap=false, enableZoom=true },
	ref,
){
	const [state,setState]=useState<GalleryState>(()=>{ const n=getNormalizedActivePhotoIndex(activePhotoIndex,photos.length); const {hidePrevButton,hideNextButton}=getWrapControlState(n,photos.length,wrap); return {activePhotoIndex:n,hidePrevButton,hideNextButton,controlsDisabled:true,touchStartInfo:null,touchEndInfo:null,touchMoved:false}; });
	const [zoom,setZoom]=useState<ZoomState>({scale:1,x:0,y:0});
	const viewportRef=useRef<HTMLDivElement>(null);
	const naturalRef=useRef<{w:number;h:number}>({w:0,h:0});
	const dragRef=useRef<{isDragging:boolean;startX:number;startY:number;startPanX:number;startPanY:number}|null>(null);
	const pinchRef=useRef<{initialDistance:number;initialScale:number;initialCenterX:number;initialCenterY:number;startPanX:number;startPanY:number}|null>(null);
	const suppressSwipeRef=useRef(false);
	const suppressClickRef=useRef(false);
	const resetZoom=useCallback(()=>{ setZoom({scale:1,x:0,y:0}); dragRef.current=null; pinchRef.current=null; suppressSwipeRef.current=false; suppressClickRef.current=false; },[]);
	useEffect(()=>{ resetZoom(); },[state.activePhotoIndex,resetZoom]);
	useEffect(()=>{ if(!enableZoom) resetZoom(); },[enableZoom,resetZoom]);
	useEffect(()=>{ const n=getNormalizedActivePhotoIndex(activePhotoIndex,photos.length); const {hidePrevButton,hideNextButton}=getWrapControlState(n,photos.length,wrap); setState(prev=>{ if(prev.activePhotoIndex===n&&prev.hidePrevButton===hidePrevButton&&prev.hideNextButton===hideNextButton) return prev; return {...prev,activePhotoIndex:n,hidePrevButton,hideNextButton}; }); },[activePhotoIndex,photos,wrap]);
	useEffect(()=>{ onActivePhotoIndexChange?.(state.activePhotoIndex); },[onActivePhotoIndexChange,state.activePhotoIndex]);
	const getItemByDirection=useCallback((dir:string,idx:number)=>{ if(photos.length===0) return 0; const last=photos.length-1; const isNext=dir===DIRECTION_NEXT; const isPrev=dir===DIRECTION_PREV; if((isPrev&&idx===0)||(isNext&&idx===last)){ if(!wrap) return idx; } const delta=isPrev?-1:1; const r=(idx+delta)%photos.length; return r===-1?photos.length-1:r; },[photos,wrap]);
	const move=useCallback((dir:string, index:number|false=false)=>{ setState(prev=>{ const nextIdx=index!==false?index:getItemByDirection(dir,prev.activePhotoIndex); const {hidePrevButton,hideNextButton}=getWrapControlState(nextIdx,photos.length,wrap); return {...prev,activePhotoIndex:nextIdx,hidePrevButton,hideNextButton}; }); },[getItemByDirection,photos.length,wrap]);
	const prev=useCallback(()=>move(DIRECTION_PREV),[move]);
	const next=useCallback(()=>move(DIRECTION_NEXT),[move]);
	useImperativeHandle(ref,()=>({prev,next}),[prev,next]);
	const onNextButtonPress=useCallback(()=>{ next(); nextButtonPressed?.(); },[next,nextButtonPressed]);
	const onPrevButtonPress=useCallback(()=>{ prev(); prevButtonPressed?.(); },[prev,prevButtonPressed]);
	const onPhotoLoad=useCallback(()=>setState(p=>({...p,controlsDisabled:false})),[]);
	const onPhotoError=useCallback(()=>setState(p=>({...p,controlsDisabled:false})),[]);
	const onPhotoPress=useCallback(()=>{ if(enableZoom){ if(suppressClickRef.current){ suppressClickRef.current=false; return; } if(zoom.scale>1.0001) return; } move(DIRECTION_NEXT); activePhotoPressed?.(); },[activePhotoPressed,move,enableZoom,zoom.scale]);
	const getViewportSize=useCallback(()=>{ const el=viewportRef.current; if(!el) return {w:0,h:0}; const rect=el.getBoundingClientRect(); let w=rect.width,h=rect.height; if(!w||!h){ w=(el as any).offsetWidth||w; h=(el as any).offsetHeight||h; } if((!w||!h)&&el.parentElement){ const pr=el.parentElement.getBoundingClientRect(); if(!w) w=pr.width; if(!h) h=pr.height; } return {w,h}; },[]);
	const updateNaturalSizeFromImg=useCallback((img:HTMLImageElement|null)=>{ if(!img) return; const w=(img as any).naturalWidth||0, h=(img as any).naturalHeight||0; if(w&&h) naturalRef.current={w,h}; },[]);
	const computeRendered=useCallback(()=>{ const vp=getViewportSize(); return {vp,rendered:getLetterboxedSize(vp.w,vp.h,naturalRef.current.w,naturalRef.current.h)}; },[getViewportSize]);
	const handleWheel=useCallback((e:WheelEvent<HTMLDivElement>)=>{ if(!enableZoom) return; e.preventDefault(); const {vp,rendered}=computeRendered(); const cur=zoom.scale; const factor=Math.exp(-e.deltaY*0.002); let ns=clamp(cur*factor,MIN_SCALE,MAX_SCALE); if(ns<=MIN_SCALE+0.0001){ setZoom({scale:1,x:0,y:0}); suppressSwipeRef.current=true; suppressClickRef.current=true; return; } const rect=viewportRef.current?.getBoundingClientRect(); let fx=0,fy=0; if(rect){ fx=e.clientX-(rect.left+rect.width/2); fy=e.clientY-(rect.top+rect.height/2); } const ratio=ns/cur; const dx=fx-(fx-zoom.x)*ratio; const dy=fy-(fy-zoom.y)*ratio; const clamped=clampPan(dx,dy,ns,vp.w,vp.h,rendered.width,rendered.height); setZoom({scale:ns,x:clamped.x,y:clamped.y}); suppressSwipeRef.current=true; suppressClickRef.current=true; },[enableZoom,computeRendered,zoom]);
	const onTouchStart=useCallback((e:TouchEvent)=>{ const t=e.targetTouches; if(!enableZoom){ if(t.length===1) setState(p=>({...p,touchStartInfo:t[0] as any})); return; } if(t.length===2){ const d=getTouchDistance(t[0],t[1]); const mp=getTouchMid(t[0],t[1]); const rect=viewportRef.current?.getBoundingClientRect(); let cx=0,cy=0; if(rect){ cx=mp.x-(rect.left+rect.width/2); cy=mp.y-(rect.top+rect.height/2); } pinchRef.current={initialDistance:d,initialScale:zoom.scale,initialCenterX:cx,initialCenterY:cy,startPanX:zoom.x,startPanY:zoom.y}; suppressSwipeRef.current=true; dragRef.current=null; setState(p=>({...p,touchStartInfo:null,touchEndInfo:null,touchMoved:false})); return; } if(t.length===1){ if(zoom.scale>1.0001){ dragRef.current={isDragging:true,startX:t[0].clientX,startY:t[0].clientY,startPanX:zoom.x,startPanY:zoom.y}; suppressSwipeRef.current=true; setState(p=>({...p,touchStartInfo:null,touchEndInfo:null,touchMoved:false})); } else { dragRef.current=null; pinchRef.current=null; setState(p=>({...p,touchStartInfo:t[0] as any,touchEndInfo:null,touchMoved:false})); } } },[enableZoom,zoom.scale,zoom.x,zoom.y]);
	const onTouchMove=useCallback((e:TouchEvent)=>{ const t=e.targetTouches; if(!enableZoom){ if(t.length===1) setState(p=>({...p,touchMoved:true,touchEndInfo:t[0] as any})); return; } if(t.length===2){ if(!pinchRef.current) return; if(e.cancelable) (e as any).preventDefault?.(); const d=getTouchDistance(t[0],t[1]); const mp=getTouchMid(t[0],t[1]); const rect=viewportRef.current?.getBoundingClientRect(); let cx=0,cy=0; if(rect){ cx=mp.x-(rect.left+rect.width/2); cy=mp.y-(rect.top+rect.height/2); } const ratio=d/pinchRef.current.initialDistance; let ns=clamp(pinchRef.current.initialScale*ratio,MIN_SCALE,MAX_SCALE); const {vp,rendered}=computeRendered(); if(ns<=MIN_SCALE+0.0001){ setZoom({scale:1,x:0,y:0}); suppressSwipeRef.current=true; suppressClickRef.current=true; return; } const lx=(pinchRef.current.initialCenterX-pinchRef.current.startPanX)/(pinchRef.current.initialScale||1); const ly=(pinchRef.current.initialCenterY-pinchRef.current.startPanY)/(pinchRef.current.initialScale||1); const dx=cx-lx*ns; const dy=cy-ly*ns; const clamped=clampPan(dx,dy,ns,vp.w,vp.h,rendered.width,rendered.height); setZoom({scale:ns,x:clamped.x,y:clamped.y}); suppressSwipeRef.current=true; suppressClickRef.current=true; return; } if(t.length===1){ if(dragRef.current?.isDragging){ if(e.cancelable) (e as any).preventDefault?.(); const {vp,rendered}=computeRendered(); const dx=dragRef.current.startPanX + (t[0].clientX-dragRef.current.startX); const dy=dragRef.current.startPanY + (t[0].clientY-dragRef.current.startY); const clamped=clampPan(dx,dy,zoom.scale,vp.w,vp.h,rendered.width,rendered.height); setZoom(prev=>({...prev,x:clamped.x,y:clamped.y})); return; } if(!suppressSwipeRef.current) setState(p=>({...p,touchMoved:true,touchEndInfo:t[0] as any})); } },[enableZoom,computeRendered,zoom.scale]);
	const onTouchEnd=useCallback(()=>{ if(!enableZoom){ setState(prev=>{ const {touchStartInfo,touchEndInfo,touchMoved}=prev; if(touchMoved&&touchStartInfo&&touchEndInfo){ if(touchStartInfo.screenX<touchEndInfo.screenX) onPrevButtonPress(); else if(touchStartInfo.screenX>touchEndInfo.screenX) onNextButtonPress(); } return {...prev,touchMoved:false}; }); return; } if(pinchRef.current){ if(zoom.scale<=MIN_SCALE+0.0001){ setZoom({scale:1,x:0,y:0}); suppressSwipeRef.current=false; suppressClickRef.current=false; } pinchRef.current=null; setState(p=>({...p,touchMoved:false,touchStartInfo:null,touchEndInfo:null})); return; } if(dragRef.current?.isDragging){ dragRef.current=null; setState(p=>({...p,touchMoved:false})); return; } if(suppressSwipeRef.current||zoom.scale>1.0001){ setState(p=>({...p,touchMoved:false,touchStartInfo:null,touchEndInfo:null})); if(zoom.scale<=1.0001) suppressSwipeRef.current=false; return; } setState(prev=>{ const {touchStartInfo,touchEndInfo,touchMoved}=prev; if(touchMoved&&touchStartInfo&&touchEndInfo){ if(touchStartInfo.screenX<touchEndInfo.screenX) onPrevButtonPress(); else if(touchStartInfo.screenX>touchEndInfo.screenX) onNextButtonPress(); } return {...prev,touchMoved:false,touchStartInfo:null,touchEndInfo:null}; }); },[enableZoom,onNextButtonPress,onPrevButtonPress,zoom.scale]);
	const onMouseDown=useCallback((e:MouseEvent<HTMLButtonElement>)=>{ if(!enableZoom) return; if(zoom.scale<=1.0001) return; dragRef.current={isDragging:true,startX:e.clientX,startY:e.clientY,startPanX:zoom.x,startPanY:zoom.y}; suppressClickRef.current=true; e.preventDefault(); },[enableZoom,zoom.scale,zoom.x,zoom.y]);
	useEffect(()=>{ if(!enableZoom) return; const mm=(ev:globalThis.MouseEvent)=>{ if(!dragRef.current?.isDragging) return; const {vp,rendered}=computeRendered(); const clamped=clampPan(dragRef.current.startPanX+(ev.clientX-dragRef.current.startX), dragRef.current.startPanY+(ev.clientY-dragRef.current.startY), zoom.scale, vp.w,vp.h, rendered.width,rendered.height); setZoom(p=>({...p,x:clamped.x,y:clamped.y})); }; const mu=()=>{ if(dragRef.current?.isDragging){ dragRef.current=null; setTimeout(()=>{ suppressClickRef.current=false; },0); } }; window.addEventListener('mousemove',mm); window.addEventListener('mouseup',mu); return ()=>{ window.removeEventListener('mousemove',mm); window.removeEventListener('mouseup',mu); }; },[enableZoom,computeRendered,zoom.scale,getViewportSize]);
	const to=useCallback((idx:number)=>{ if(idx>photos.length-1||idx<0||state.activePhotoIndex===idx) return; const dir=idx>state.activePhotoIndex?DIRECTION_NEXT:DIRECTION_PREV; move(dir,idx); },[move,photos.length,state.activePhotoIndex]);
	const onThumbnailPress=useCallback((i:number)=>to(i),[to]);
	const controls=useMemo(()=>{ if(photos.length<=1) return null; const ui:any[]=[]; if(!state.hidePrevButton) ui.push(<PrevButton key=".prevControl" disabled={state.controlsDisabled} onPress={onPrevButtonPress} light={light}/>); if(!state.hideNextButton) ui.push(<NextButton key=".nextControl" disabled={state.controlsDisabled} onPress={onNextButtonPress} light={light}/>); return ui; },[light,onNextButtonPress,onPrevButtonPress,photos.length,state.controlsDisabled,state.hideNextButton,state.hidePrevButton]);
	const preload=useMemo(()=>{ let c=1, i=state.activePhotoIndex; const a:any[]=[]; while(i<photos.length&&c<=preloadSize){ const p=photos[i]; a.push(<img key={p.photo} alt={p.photo} src={p.photo}/>); i++; c++; } return a; },[photos,preloadSize,state.activePhotoIndex]);
	const hasPhotos=photos.length>0; const current=photos[state.activePhotoIndex]; const {noPhotosProvided:emptyMessage}=phrases;
	const imageStyle=useMemo(()=>{ const s=enableZoom?zoom.scale:1; const x=enableZoom?zoom.x:0; const y=enableZoom?zoom.y:0; return {'--rbg-zoom-scale':`${s}`,'--rbg-photo-scale':`${s}`,'--rbg-scale':`${s}`,'--rbg-pan-x':`${x}px`,'--rbg-pan-y':`${y}px`,'--rbg-photo-pan-x':`${x}px`,'--rbg-photo-pan-y':`${y}px`,transform:`translateY(-50%) translate(${x}px, ${y}px) scale(${s})`,transformOrigin:'center center'} as any; },[zoom.scale,zoom.x,zoom.y,enableZoom]);
	return (
		<div className="gallery">
			<div className="gallery-modal--preload">{preload}</div>
			<div className="gallery-main">
				{controls}
				<div className="gallery-photos">
					{hasPhotos ? (
						<div className="gallery-photo" ref={viewportRef} onWheel={handleWheel}>
							<div className="gallery-photo--current">
								<Photo photo={current} onLoad={()=>{ const c=viewportRef.current; if(c){ const img=c.querySelector('img.gallery-photo-image') as HTMLImageElement|null; if(img) updateNaturalSizeFromImg(img); } onPhotoLoad(); }} onError={onPhotoError} onPress={onPhotoPress} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onMouseDown={onMouseDown} style={imageStyle} onImageRef={updateNaturalSizeFromImg}/>
							</div>
						</div>
					) : (<div className="gallery-empty">{emptyMessage}</div>)}
				</div>
			</div>
			{showThumbnails&&current&&(<Caption phrases={phrases} current={state.activePhotoIndex} photos={photos} onPress={onThumbnailPress}/>)}
		</div>
	);
});
const MemoizedGallery=memo(Gallery);
export {MemoizedGallery as Gallery};
