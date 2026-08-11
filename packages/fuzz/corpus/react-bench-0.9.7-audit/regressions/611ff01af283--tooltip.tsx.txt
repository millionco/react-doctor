// rule: effect-needs-cleanup
// file-path: src/components/Tooltip/Tooltip.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 611ff01af2832609d3064aa1ce21ab39d220609bf028e0a71d24849738728066
import React, { useEffect, useState, useRef, useCallback, useImperativeHandle } from 'react'
import { autoUpdate } from '@floating-ui/dom'
import classNames from 'classnames'
import {
  debounce,
  deepEqual,
  useIsomorphicLayoutEffect,
  getScrollParent,
  computeTooltipPosition,
  cssTimeToMs,
} from 'utils'
import type { IComputedPosition } from 'utils'
import { useTooltip } from 'components/TooltipProvider'
import coreStyles from './core-styles.module.css'
import styles from './styles.module.css'
import type {
  AnchorCloseEvents,
  AnchorOpenEvents,
  GlobalCloseEvents,
  IPosition,
  ITooltip,
  TooltipImperativeOpenOptions,
} from './TooltipTypes'

const Tooltip = ({
  // props
  forwardRef,
  id,
  className,
  classNameArrow,
  variant = 'dark',
  anchorId,
  anchorSelect,
  place = 'top',
  offset = 10,
  events = ['hover'],
  openOnClick = false,
  positionStrategy = 'absolute',
  middlewares,
  wrapper: WrapperElement,
  delayShow = 0,
  delayHide = 0,
  float = false,
  hidden = false,
  noArrow = false,
  clickable = false,
  closeOnEsc = false,
  closeOnScroll = false,
  closeOnResize = false,
  openEvents,
  closeEvents,
  globalCloseEvents,
  imperativeModeOnly,
  style: externalStyles,
  position,
  afterShow,
  afterHide,
  // props handled by controller
  content,
  contentWrapperRef,
  isOpen,
  defaultIsOpen = false,
  setIsOpen,
  activeAnchor,
  setActiveAnchor,
  border,
  opacity,
  arrowColor,
  role = 'tooltip',
}: ITooltip) => {
  const tooltipRef = useRef<HTMLElement>(null)
  const tooltipArrowRef = useRef<HTMLElement>(null)
  const tooltipShowDelayTimerRef = useRef<NodeJS.Timeout | null>(null)
  const tooltipHideDelayTimerRef = useRef<NodeJS.Timeout | null>(null)
  const missedTransitionTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [computedPosition, setComputedPosition] = useState<IComputedPosition>({
    tooltipStyles: {},
    tooltipArrowStyles: {},
    place,
  })
  const [show, setShow] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [imperativeOptions, setImperativeOptions] = useState<TooltipImperativeOpenOptions | null>(
    null,
  )
  const wasShowing = useRef(false)
  const lastFloatPosition = useRef<IPosition | null>(null)
  /**
   * @todo Remove this in a future version (provider/wrapper method is deprecated)
   */
  const { anchorRefs, setActiveAnchor: setProviderActiveAnchor } = useTooltip(id)
  const hoveringTooltip = useRef(false)
  const [anchorsBySelect, setAnchorsBySelect] = useState<HTMLElement[]>([])
  const mounted = useRef(false)
  const renderedRef = useRef(rendered)
  const showRef = useRef(show)
  const isOpenRef = useRef(isOpen)
  const activeAnchorRef = useRef(activeAnchor)
  const previousIsOpenRef = useRef(isOpen)
  /**
   * Tracks a pending delayed open so rerenders/prop changes don't restart or revive it incorrectly.
   */
  const pendingShowRef = useRef<{
    type: 'hover' | 'imperative'
    startedAt: number
    delay: number
    anchor?: HTMLElement | null
    options?: TooltipImperativeOpenOptions | null
  } | null>(null)
  /**
   * Hover and focus are tracked together so either can keep the tooltip open.
   */
  const anchorInteractionRef = useRef<{
    anchor: HTMLElement | null
    hover: boolean
    focus: boolean
  }>({ anchor: null, hover: false, focus: false })

  renderedRef.current = rendered
  showRef.current = show
  isOpenRef.current = isOpen
  activeAnchorRef.current = activeAnchor

  /**
   * @todo Update when deprecated stuff gets removed.
   */
  const shouldOpenOnClick = openOnClick || events.includes('click')
  const hasClickEvent =
    shouldOpenOnClick || openEvents?.click || openEvents?.dblclick || openEvents?.mousedown
  const actualOpenEvents: AnchorOpenEvents = openEvents
    ? { ...openEvents }
    : {
        mouseover: true,
        focus: true,
        mouseenter: false,
        click: false,
        dblclick: false,
        mousedown: false,
      }
  if (!openEvents && shouldOpenOnClick) {
    Object.assign(actualOpenEvents, {
      mouseenter: false,
      focus: false,
      mouseover: false,
      click: true,
    })
  }
  const actualCloseEvents: AnchorCloseEvents = closeEvents
    ? { ...closeEvents }
    : {
        mouseout: true,
        blur: true,
        mouseleave: false,
        click: false,
        dblclick: false,
        mouseup: false,
      }
  if (!closeEvents && shouldOpenOnClick) {
    Object.assign(actualCloseEvents, {
      mouseleave: false,
      blur: false,
      mouseout: false,
    })
  }
  const actualGlobalCloseEvents: GlobalCloseEvents = globalCloseEvents
    ? { ...globalCloseEvents }
    : {
        escape: closeOnEsc || false,
        scroll: closeOnScroll || false,
        resize: closeOnResize || false,
        clickOutsideAnchor: hasClickEvent || false,
      }

  if (imperativeModeOnly) {
    Object.assign(actualOpenEvents, {
      mouseenter: false,
      focus: false,
      click: false,
      dblclick: false,
      mousedown: false,
    })
    Object.assign(actualCloseEvents, {
      mouseleave: false,
      blur: false,
      click: false,
      dblclick: false,
      mouseup: false,
    })
    Object.assign(actualGlobalCloseEvents, {
      escape: false,
      scroll: false,
      resize: false,
      clickOutsideAnchor: false,
    })
  }

  /**
   * useLayoutEffect runs before useEffect,
   * but should be used carefully because of caveats
   * https://beta.reactjs.org/reference/react/useLayoutEffect#caveats
   */
  useIsomorphicLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleShow = (value: boolean) => {
    if (!mounted.current) {
      return
    }
    if (value) {
      setRendered(true)
    }
    /**
     * wait for the component to render and calculate position
     * before actually showing
     */
    setTimeout(() => {
      if (!mounted.current) {
        return
      }
      setIsOpen?.(value)
      if (isOpenRef.current === undefined) {
        setShow(value)
      }
    }, 10)
  }

  const clearShowDelayTimer = () => {
    if (tooltipShowDelayTimerRef.current) {
      clearTimeout(tooltipShowDelayTimerRef.current)
      tooltipShowDelayTimerRef.current = null
    }
  }

  const clearHideDelayTimer = () => {
    if (tooltipHideDelayTimerRef.current) {
      clearTimeout(tooltipHideDelayTimerRef.current)
      tooltipHideDelayTimerRef.current = null
    }
  }

  const cancelPendingShow = (type?: 'hover' | 'imperative') => {
    if (!pendingShowRef.current) {
      clearShowDelayTimer()
      return
    }
    if (type && pendingShowRef.current.type !== type) {
      return
    }
    clearShowDelayTimer()
    pendingShowRef.current = null
  }

  /**
   * this replicates the effect from `handleShow()`
   * when `isOpen` is changed from outside
   */
  useEffect(() => {
    const wasControlled = previousIsOpenRef.current !== undefined
    const releasingControl = wasControlled && isOpen === undefined
    previousIsOpenRef.current = isOpen

    if (releasingControl) {
      /**
       * Releasing control must not resume an earlier opening that was started
       * (or suppressed) while the tooltip was controlled.
       */
      cancelPendingShow()
    }

    if (isOpen === undefined) {
      return () => null
    }

    if (isOpen === false) {
      cancelPendingShow('hover')
    }

    if (isOpen) {
      setRendered(true)
    }
    const timeout = setTimeout(() => {
      setShow(isOpen)
    }, 10)
    return () => {
      clearTimeout(timeout)
    }
  }, [isOpen])

  useEffect(() => {
    if (show === wasShowing.current) {
      return
    }
    if (missedTransitionTimerRef.current) {
      clearTimeout(missedTransitionTimerRef.current)
    }
    wasShowing.current = show
    if (show) {
      afterShow?.()
    } else {
      /**
       * see `onTransitionEnd` on tooltip wrapper
       */
      const style = getComputedStyle(document.body)
      const transitionShowDelay = cssTimeToMs(style.getPropertyValue('--rt-transition-show-delay'))
      missedTransitionTimerRef.current = setTimeout(() => {
        /**
         * if the tooltip switches from `show === true` to `show === false` too fast
         * the transition never runs, so `onTransitionEnd` callback never gets fired
         */
        setRendered(false)
        setImperativeOptions(null)
        afterHide?.()
        // +25ms just to make sure `onTransitionEnd` (if it gets fired) has time to run
      }, transitionShowDelay + 25)
    }
  }, [show])

  const handleComputedPosition = (newComputedPosition: IComputedPosition) => {
    setComputedPosition((oldComputedPosition) =>
      deepEqual(oldComputedPosition, newComputedPosition)
        ? oldComputedPosition
        : newComputedPosition,
    )
  }

  const runPendingShow = () => {
    const pending = pendingShowRef.current
    pendingShowRef.current = null
    tooltipShowDelayTimerRef.current = null
    if (!pending) {
      return
    }
    if (pending.type === 'imperative') {
      setImperativeOptions(pending.options ?? null)
    }
    handleShow(true)
  }

  const handleShowTooltipDelayed = (
    delay = delayShow,
    options?: {
      type?: 'hover' | 'imperative'
      imperativeOptions?: TooltipImperativeOpenOptions | null
      anchor?: HTMLElement | null
      /**
       * When true, always restart the wait (new interaction / new open()).
       * When false, keep an existing pending timer for the same type.
       */
      restart?: boolean
      /**
       * Preserve startedAt when adjusting remaining delay after delayShow changes.
       */
      startedAt?: number
    },
  ) => {
    const type = options?.type ?? 'hover'

    if (type === 'hover' && renderedRef.current && !pendingShowRef.current) {
      // if the tooltip is already rendered, ignore delay (anchor switch)
      handleShow(true)
      return
    }

    if (
      !options?.restart &&
      pendingShowRef.current?.type === type &&
      type === 'hover' &&
      tooltipShowDelayTimerRef.current
    ) {
      // rerenders / repeat enter events must not restart the wait
      return
    }

    clearShowDelayTimer()

    const startedAt = options?.startedAt ?? Date.now()
    const elapsed = options?.startedAt ? Date.now() - options.startedAt : 0
    const remaining = Math.max(0, delay - elapsed)

    pendingShowRef.current = {
      type,
      startedAt,
      delay,
      anchor: options?.anchor,
      options: type === 'imperative' ? options?.imperativeOptions ?? null : undefined,
    }

    tooltipShowDelayTimerRef.current = setTimeout(() => {
      runPendingShow()
    }, remaining)
  }

  const handleHideTooltipDelayed = (delay = delayHide) => {
    clearHideDelayTimer()

    tooltipHideDelayTimerRef.current = setTimeout(() => {
      if (hoveringTooltip.current) {
        return
      }
      handleShow(false)
    }, delay)
  }

  const resolveAnchorFromEvent = (event: Event): HTMLElement | null => {
    const currentTarget = event.currentTarget as HTMLElement | null
    if (currentTarget?.isConnected) {
      return currentTarget
    }

    const target = event.target as HTMLElement | null
    if (!target?.isConnected) {
      return null
    }

    const anchorById = anchorId
      ? document.querySelector<HTMLElement>(`[id='${anchorId}']`)
      : null
    const candidates = [anchorById, ...anchorsBySelect, ...[...anchorRefs].map((ref) => ref.current)]
    return candidates.find((anchor) => anchor?.contains(target)) ?? null
  }

  const isStillInsideAnchor = (event: Event, anchor: HTMLElement | null) => {
    if (!anchor) {
      return false
    }
    const related = (event as MouseEvent | FocusEvent).relatedTarget as Node | null
    return Boolean(related && anchor.contains(related))
  }

  const handleShowTooltip = (event?: Event) => {
    if (!event) {
      return
    }
    /**
     * Anchor hover must not replace a pending imperative open().
     */
    if (pendingShowRef.current?.type === 'imperative') {
      return
    }

    const target = resolveAnchorFromEvent(event)
    if (!target?.isConnected) {
      /**
       * this happens when the target is removed from the DOM
       * at the same time the tooltip gets triggered
       */
      setActiveAnchor(null)
      setProviderActiveAnchor({ current: null })
      return
    }

    const eventType = event.type
    const isFocusEvent = eventType === 'focus' || eventType === 'focusin'
    const interaction = anchorInteractionRef.current
    const switchingAnchor = interaction.anchor !== null && interaction.anchor !== target

    if (switchingAnchor) {
      interaction.hover = false
      interaction.focus = false
    }

    if (isFocusEvent) {
      interaction.focus = true
    } else {
      interaction.hover = true
    }
    interaction.anchor = target

    const alreadyVisible = renderedRef.current
    const sameAnchorPending =
      pendingShowRef.current?.type === 'hover' && pendingShowRef.current.anchor === target

    activeAnchorRef.current = target
    setActiveAnchor(target)
    setProviderActiveAnchor({ current: target })
    clearHideDelayTimer()

    if (alreadyVisible) {
      // visible tooltip switches anchors immediately
      cancelPendingShow('hover')
      handleShow(true)
      return
    }

    if (sameAnchorPending) {
      // repeat hover/focus on the same anchor must not restart the wait
      return
    }

    if (delayShow) {
      handleShowTooltipDelayed(delayShow, { type: 'hover', restart: true, anchor: target })
    } else {
      cancelPendingShow('hover')
      handleShow(true)
    }
  }

  const handleHideTooltip = (event?: Event) => {
    /**
     * Stale leave events must not cancel a pending imperative open().
     */
    if (pendingShowRef.current?.type === 'imperative') {
      return
    }

    if (event) {
      const leavingAnchor = resolveAnchorFromEvent(event)
      const interaction = anchorInteractionRef.current

      /**
       * Late events from a previous anchor must not affect the current one.
       */
      if (interaction.anchor && leavingAnchor && leavingAnchor !== interaction.anchor) {
        return
      }

      if (isStillInsideAnchor(event, leavingAnchor ?? interaction.anchor)) {
        return
      }

      const eventType = event.type
      const isBlurEvent = eventType === 'blur' || eventType === 'focusout'
      if (isBlurEvent) {
        interaction.focus = false
      } else {
        interaction.hover = false
      }

      /**
       * Hover and focus work together — only close when both have ended.
       */
      if (interaction.hover || interaction.focus) {
        return
      }

      interaction.anchor = null
    } else {
      anchorInteractionRef.current = { anchor: null, hover: false, focus: false }
    }

    /**
     * Ending or dismissing cancels the opening.
     */
    cancelPendingShow('hover')

    if (clickable) {
      // allow time for the mouse to reach the tooltip, in case there's a gap
      handleHideTooltipDelayed(delayHide || 100)
    } else if (delayHide) {
      handleHideTooltipDelayed()
    } else {
      handleShow(false)
    }
  }

  const handleTooltipPosition = ({ x, y }: IPosition) => {
    const virtualElement = {
      getBoundingClientRect() {
        return {
          x,
          y,
          width: 0,
          height: 0,
          top: y,
          left: x,
          right: x,
          bottom: y,
        }
      },
    } as Element
    computeTooltipPosition({
      place: imperativeOptions?.place ?? place,
      offset,
      elementReference: virtualElement,
      tooltipReference: tooltipRef.current,
      tooltipArrowReference: tooltipArrowRef.current,
      strategy: positionStrategy,
      middlewares,
      border,
    }).then((computedStylesData) => {
      handleComputedPosition(computedStylesData)
    })
  }

  const handlePointerMove = (event?: Event) => {
    if (!event) {
      return
    }
    const mouseEvent = event as MouseEvent
    const mousePosition = {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
    }
    handleTooltipPosition(mousePosition)
    lastFloatPosition.current = mousePosition
  }

  const handleClickOutsideAnchors = (event: MouseEvent) => {
    if (!showRef.current && !pendingShowRef.current) {
      return
    }
    const target = event.target as HTMLElement
    if (!target.isConnected) {
      return
    }
    if (tooltipRef.current?.contains(target)) {
      return
    }
    const anchorById = document.querySelector<HTMLElement>(`[id='${anchorId}']`)
    const anchors = [anchorById, ...anchorsBySelect]
    if (anchors.some((anchor) => anchor?.contains(target))) {
      return
    }
    anchorInteractionRef.current = { anchor: null, hover: false, focus: false }
    cancelPendingShow()
    handleShow(false)
  }

  // debounce handler to prevent call twice when
  // mouse enter and focus events being triggered toggether
  const internalDebouncedHandleShowTooltip = debounce(handleShowTooltip, 50, true)
  const internalDebouncedHandleHideTooltip = debounce(handleHideTooltip, 50, true)
  // If either of the functions is called while the other is still debounced,
  // reset the timeout. Otherwise if there is a sub-50ms (leave A, enter B, leave B)
  // sequence of events, the tooltip will stay open because the hide debounce
  // from leave A prevented the leave B event from calling it, leaving the
  // tooltip visible.
  const debouncedHandleShowTooltip = (e?: Event) => {
    internalDebouncedHandleHideTooltip.cancel()
    internalDebouncedHandleShowTooltip(e)
  }
  const debouncedHandleHideTooltip = (e?: Event) => {
    internalDebouncedHandleShowTooltip.cancel()
    internalDebouncedHandleHideTooltip(e)
  }

  const updateTooltipPosition = useCallback(() => {
    const actualPosition = imperativeOptions?.position ?? position
    if (actualPosition) {
      // if `position` is set, override regular and `float` positioning
      handleTooltipPosition(actualPosition)
      return
    }

    if (float) {
      if (lastFloatPosition.current) {
        /*
          Without this, changes to `content`, `place`, `offset`, ..., will only
          trigger a position calculation after a `mousemove` event.

          To see why this matters, comment this line, run `yarn dev` and click the
          "Hover me!" anchor.
        */
        handleTooltipPosition(lastFloatPosition.current)
      }
      // if `float` is set, override regular positioning
      return
    }

    if (!activeAnchor?.isConnected) {
      return
    }

    computeTooltipPosition({
      place: imperativeOptions?.place ?? place,
      offset,
      elementReference: activeAnchor,
      tooltipReference: tooltipRef.current,
      tooltipArrowReference: tooltipArrowRef.current,
      strategy: positionStrategy,
      middlewares,
      border,
    }).then((computedStylesData) => {
      if (!mounted.current) {
        // invalidate computed positions after remount
        return
      }
      handleComputedPosition(computedStylesData)
    })
  }, [
    show,
    activeAnchor,
    content,
    externalStyles,
    place,
    imperativeOptions?.place,
    offset,
    positionStrategy,
    position,
    imperativeOptions?.position,
    float,
  ])

  useEffect(() => {
    const elementRefs = new Set(anchorRefs)

    anchorsBySelect.forEach((anchor) => {
      elementRefs.add({ current: anchor })
    })

    const anchorById = document.querySelector<HTMLElement>(`[id='${anchorId}']`)
    if (anchorById) {
      elementRefs.add({ current: anchorById })
    }

    const handleScrollResize = () => {
      anchorInteractionRef.current = { anchor: null, hover: false, focus: false }
      cancelPendingShow()
      handleShow(false)
    }

    const anchorScrollParent = getScrollParent(activeAnchor)
    const tooltipScrollParent = getScrollParent(tooltipRef.current)

    if (actualGlobalCloseEvents.scroll) {
      window.addEventListener('scroll', handleScrollResize)
      anchorScrollParent?.addEventListener('scroll', handleScrollResize)
      tooltipScrollParent?.addEventListener('scroll', handleScrollResize)
    }
    let updateTooltipCleanup: null | (() => void) = null
    if (actualGlobalCloseEvents.resize) {
      window.addEventListener('resize', handleScrollResize)
    } else if (activeAnchor && tooltipRef.current) {
      updateTooltipCleanup = autoUpdate(
        activeAnchor as HTMLElement,
        tooltipRef.current as HTMLElement,
        updateTooltipPosition,
        {
          ancestorResize: true,
          elementResize: true,
          layoutShift: true,
        },
      )
    }

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      anchorInteractionRef.current = { anchor: null, hover: false, focus: false }
      cancelPendingShow()
      handleShow(false)
    }
    if (actualGlobalCloseEvents.escape) {
      window.addEventListener('keydown', handleEsc)
    }

    if (actualGlobalCloseEvents.clickOutsideAnchor) {
      window.addEventListener('click', handleClickOutsideAnchors)
    }

    const enabledEvents: {
      event: string
      listener: (event?: Event) => void
      options?: boolean | AddEventListenerOptions
    }[] = []

    const handleClickOpenTooltipAnchor = (event?: Event) => {
      const target = event?.target as Node | null
      if (show && activeAnchor && target && activeAnchor.contains(target)) {
        /**
         * ignore clicking the anchor that was used to open the tooltip.
         * this avoids conflict with the click close event.
         * clicks from children count toward that anchor.
         */
        return
      }
      handleShowTooltip(event)
    }
    const handleClickCloseTooltipAnchor = (event?: Event) => {
      const target = event?.target as Node | null
      if (!show || !activeAnchor || !target || !activeAnchor.contains(target)) {
        /**
         * ignore clicking the anchor that was NOT used to open the tooltip.
         * this avoids closing the tooltip when clicking on a
         * new anchor with the tooltip already open.
         */
        return
      }
      handleHideTooltip(event)
    }

    const regularEvents = ['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'focus', 'blur']
    const clickEvents = ['click', 'dblclick', 'mousedown', 'mouseup']
    const focusEvents = ['focus', 'blur']

    Object.entries(actualOpenEvents).forEach(([event, enabled]) => {
      if (!enabled) {
        return
      }
      if (regularEvents.includes(event)) {
        enabledEvents.push({
          event,
          listener: debouncedHandleShowTooltip,
          // capture so focus on children counts toward the anchor
          options: focusEvents.includes(event) ? true : undefined,
        })
      } else if (clickEvents.includes(event)) {
        enabledEvents.push({ event, listener: handleClickOpenTooltipAnchor })
      } else {
        // never happens
      }
    })

    Object.entries(actualCloseEvents).forEach(([event, enabled]) => {
      if (!enabled) {
        return
      }
      if (regularEvents.includes(event)) {
        enabledEvents.push({
          event,
          listener: debouncedHandleHideTooltip,
          options: focusEvents.includes(event) ? true : undefined,
        })
      } else if (clickEvents.includes(event)) {
        enabledEvents.push({ event, listener: handleClickCloseTooltipAnchor })
      } else {
        // never happens
      }
    })

    if (float) {
      enabledEvents.push({
        event: 'pointermove',
        listener: handlePointerMove,
      })
    }

    const handleMouseEnterTooltip = () => {
      hoveringTooltip.current = true
    }
    const handleMouseLeaveTooltip = () => {
      hoveringTooltip.current = false
      handleHideTooltip()
    }

    if (clickable && !hasClickEvent) {
      // used to keep the tooltip open when hovering content.
      // not needed if using click events.
      tooltipRef.current?.addEventListener('mouseenter', handleMouseEnterTooltip)
      tooltipRef.current?.addEventListener('mouseleave', handleMouseLeaveTooltip)
    }

    enabledEvents.forEach(({ event, listener, options }) => {
      elementRefs.forEach((ref) => {
        ref.current?.addEventListener(event, listener, options)
      })
    })

    return () => {
      if (actualGlobalCloseEvents.scroll) {
        window.removeEventListener('scroll', handleScrollResize)
        anchorScrollParent?.removeEventListener('scroll', handleScrollResize)
        tooltipScrollParent?.removeEventListener('scroll', handleScrollResize)
      }
      if (actualGlobalCloseEvents.resize) {
        window.removeEventListener('resize', handleScrollResize)
      } else {
        updateTooltipCleanup?.()
      }
      if (actualGlobalCloseEvents.clickOutsideAnchor) {
        window.removeEventListener('click', handleClickOutsideAnchors)
      }
      if (actualGlobalCloseEvents.escape) {
        window.removeEventListener('keydown', handleEsc)
      }
      if (clickable && !hasClickEvent) {
        tooltipRef.current?.removeEventListener('mouseenter', handleMouseEnterTooltip)
        tooltipRef.current?.removeEventListener('mouseleave', handleMouseLeaveTooltip)
      }
      enabledEvents.forEach(({ event, listener, options }) => {
        elementRefs.forEach((ref) => {
          ref.current?.removeEventListener(event, listener, options)
        })
      })
    }
    /**
     * rendered is also a dependency to ensure anchor observers are re-registered
     * since `tooltipRef` becomes stale after removing/adding the tooltip to the DOM
     */
  }, [
    activeAnchor,
    updateTooltipPosition,
    rendered,
    anchorRefs,
    anchorsBySelect,
    // the effect uses the `actual*Events` objects, but this should work
    openEvents,
    closeEvents,
    globalCloseEvents,
    shouldOpenOnClick,
    delayShow,
    delayHide,
  ])

  useEffect(() => {
    let selector = imperativeOptions?.anchorSelect ?? anchorSelect ?? ''
    if (!selector && id) {
      selector = `[data-tooltip-id='${id.replace(/'/g, "\\'")}']`
    }
    const documentObserverCallback: MutationCallback = (mutationList) => {
      const newAnchors: HTMLElement[] = []
      const removedAnchors: HTMLElement[] = []
      mutationList.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-tooltip-id') {
          const newId = (mutation.target as HTMLElement).getAttribute('data-tooltip-id')
          if (newId === id) {
            newAnchors.push(mutation.target as HTMLElement)
          } else if (mutation.oldValue === id) {
            // data-tooltip-id has now been changed, so we need to remove this anchor
            removedAnchors.push(mutation.target as HTMLElement)
          }
        }
        if (mutation.type !== 'childList') {
          return
        }
        if (activeAnchor) {
          const elements = [...mutation.removedNodes].filter((node) => node.nodeType === 1)
          if (selector) {
            try {
              removedAnchors.push(
                // the element itself is an anchor
                ...(elements.filter((element) =>
                  (element as HTMLElement).matches(selector),
                ) as HTMLElement[]),
              )
              removedAnchors.push(
                // the element has children which are anchors
                ...elements.flatMap(
                  (element) =>
                    [...(element as HTMLElement).querySelectorAll(selector)] as HTMLElement[],
                ),
              )
            } catch {
              /**
               * invalid CSS selector.
               * already warned on tooltip controller
               */
            }
          }
          elements.some((node) => {
            if (node?.contains?.(activeAnchor)) {
              setRendered(false)
              handleShow(false)
              setActiveAnchor(null)
              anchorInteractionRef.current = { anchor: null, hover: false, focus: false }
              cancelPendingShow()
              clearHideDelayTimer()
              return true
            }
            return false
          })
        }
        if (!selector) {
          return
        }
        try {
          const elements = [...mutation.addedNodes].filter((node) => node.nodeType === 1)
          newAnchors.push(
            // the element itself is an anchor
            ...(elements.filter((element) =>
              (element as HTMLElement).matches(selector),
            ) as HTMLElement[]),
          )
          newAnchors.push(
            // the element has children which are anchors
            ...elements.flatMap(
              (element) =>
                [...(element as HTMLElement).querySelectorAll(selector)] as HTMLElement[],
            ),
          )
        } catch {
          /**
           * invalid CSS selector.
           * already warned on tooltip controller
           */
        }
      })
      if (newAnchors.length || removedAnchors.length) {
        setAnchorsBySelect((anchors) => [
          ...anchors.filter((anchor) => !removedAnchors.includes(anchor)),
          ...newAnchors,
        ])
      }
    }
    const documentObserver = new MutationObserver(documentObserverCallback)
    // watch for anchor being removed from the DOM
    documentObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tooltip-id'],
      // to track the prev value if we need to remove anchor when data-tooltip-id gets changed
      attributeOldValue: true,
    })
    return () => {
      documentObserver.disconnect()
    }
  }, [id, anchorSelect, imperativeOptions?.anchorSelect, activeAnchor])

  useEffect(() => {
    updateTooltipPosition()
  }, [updateTooltipPosition])

  useEffect(() => {
    if (!contentWrapperRef?.current) {
      return () => null
    }
    const contentObserver = new ResizeObserver(() => {
      setTimeout(() => updateTooltipPosition())
    })
    contentObserver.observe(contentWrapperRef.current)
    return () => {
      contentObserver.disconnect()
    }
  }, [content, contentWrapperRef?.current])

  useEffect(() => {
    const anchorById = document.querySelector<HTMLElement>(`[id='${anchorId}']`)
    const anchors = [...anchorsBySelect, anchorById]
    if (!activeAnchor || !anchors.includes(activeAnchor)) {
      /**
       * if there is no active anchor,
       * or if the current active anchor is not amongst the allowed ones,
       * reset it
       */
      setActiveAnchor(anchorsBySelect[0] ?? anchorById)
    }
  }, [anchorId, anchorsBySelect, activeAnchor])

  useEffect(() => {
    if (defaultIsOpen) {
      handleShow(true)
    }
    return () => {
      cancelPendingShow()
      clearHideDelayTimer()
    }
  }, [])

  useEffect(() => {
    let selector = imperativeOptions?.anchorSelect ?? anchorSelect
    if (!selector && id) {
      selector = `[data-tooltip-id='${id.replace(/'/g, "\\'")}']`
    }
    if (!selector) {
      return
    }
    try {
      const anchors = Array.from(document.querySelectorAll<HTMLElement>(selector))
      setAnchorsBySelect(anchors)
    } catch {
      // warning was already issued in the controller
      setAnchorsBySelect([])
    }
  }, [id, anchorSelect, imperativeOptions?.anchorSelect])

  useEffect(() => {
    const pending = pendingShowRef.current
    /**
     * Only adjust an in-flight hover delay. Do not revive a cancelled opening,
     * and do not affect imperative open() delays (independent of delayShow).
     */
    if (!pending || pending.type !== 'hover' || !tooltipShowDelayTimerRef.current) {
      return
    }
    handleShowTooltipDelayed(delayShow, {
      type: 'hover',
      restart: true,
      startedAt: pending.startedAt,
      anchor: pending.anchor,
    })
  }, [delayShow])

  const actualContent = imperativeOptions?.content ?? content
  const canShow = show && Object.keys(computedPosition.tooltipStyles).length > 0

  useImperativeHandle(forwardRef, () => ({
    open: (options) => {
      if (options?.anchorSelect) {
        try {
          document.querySelector(options.anchorSelect)
        } catch {
          if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn(`[react-tooltip] "${options.anchorSelect}" is not a valid CSS selector`)
          }
          return
        }
      }
      /**
       * A newer open() replaces an older one and cancels any delayed close().
       */
      clearHideDelayTimer()
      cancelPendingShow()

      if (options?.delay) {
        /**
         * Replacement content stays hidden until due — do not apply options yet.
         * Delay is independent of delayShow; still wait even if tooltip is visible.
         */
        handleShowTooltipDelayed(options.delay, {
          type: 'imperative',
          restart: true,
          imperativeOptions: options,
        })
      } else {
        setImperativeOptions(options ?? null)
        handleShow(true)
      }
    },
    close: (options) => {
      /**
       * Any close(), even delayed, immediately cancels a pending open and releases its content.
       * Applied (visible) content is cleared when the tooltip finishes hiding.
       */
      cancelPendingShow()
      anchorInteractionRef.current = { anchor: null, hover: false, focus: false }

      if (options?.delay) {
        handleHideTooltipDelayed(options.delay)
      } else {
        clearHideDelayTimer()
        handleShow(false)
      }
    },
    activeAnchor,
    place: computedPosition.place,
    isOpen: Boolean(rendered && !hidden && actualContent && canShow),
  }))

  return rendered && !hidden && actualContent ? (
    <WrapperElement
      id={id}
      role={role}
      className={classNames(
        'react-tooltip',
        coreStyles['tooltip'],
        styles['tooltip'],
        styles[variant],
        className,
        `react-tooltip__place-${computedPosition.place}`,
        coreStyles[canShow ? 'show' : 'closing'],
        canShow ? 'react-tooltip__show' : 'react-tooltip__closing',
        positionStrategy === 'fixed' && coreStyles['fixed'],
        clickable && coreStyles['clickable'],
      )}
      onTransitionEnd={(event: TransitionEvent) => {
        if (missedTransitionTimerRef.current) {
          clearTimeout(missedTransitionTimerRef.current)
        }
        if (show || event.propertyName !== 'opacity') {
          return
        }
        setRendered(false)
        setImperativeOptions(null)
        afterHide?.()
      }}
      style={{
        ...externalStyles,
        ...computedPosition.tooltipStyles,
        opacity: opacity !== undefined && canShow ? opacity : undefined,
      }}
      ref={tooltipRef}
    >
      {actualContent}
      <WrapperElement
        className={classNames(
          'react-tooltip-arrow',
          coreStyles['arrow'],
          styles['arrow'],
          classNameArrow,
          noArrow && coreStyles['noArrow'],
        )}
        style={{
          ...computedPosition.tooltipArrowStyles,
          background: arrowColor
            ? `linear-gradient(to right bottom, transparent 50%, ${arrowColor} 50%)`
            : undefined,
        }}
        ref={tooltipArrowRef}
      />
    </WrapperElement>
  ) : null
}

export default Tooltip
