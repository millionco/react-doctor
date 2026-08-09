// rule: effect-needs-cleanup
// file-path: src/components/Tooltip/Tooltip.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 16efe6cf434debe4986a758e7b4a00934fdfb06ea060a1d69f9400873c5ea56b
import React, { useEffect, useState, useRef, useCallback, useImperativeHandle } from 'react'
import { autoUpdate } from '@floating-ui/dom'
import classNames from 'classnames'
import {
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

type PendingShowRequest = {
  kind: 'interaction' | 'imperative'
  anchor?: HTMLElement
  options?: TooltipImperativeOpenOptions | null
  startedAt: number
  delay: number
}

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
  const showRequestRef = useRef<PendingShowRequest | null>(null)
  const showRequestDueAtRef = useRef<number | null>(null)
  const handleShowTimerRef = useRef<NodeJS.Timeout | null>(null)
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
  const showRef = useRef(show)
  const renderedRef = useRef(rendered)
  const isOpenRef = useRef(isOpen)
  const setIsOpenRef = useRef(setIsOpen)
  const activeAnchorRef = useRef(activeAnchor)
  const wasControlledRef = useRef(isOpen !== undefined)
  const previousIsOpenRef = useRef(isOpen)
  const anchorInteractionRef = useRef(
    new Map<HTMLElement, { hover: boolean; focus: boolean }>(),
  )

  showRef.current = show
  renderedRef.current = rendered
  isOpenRef.current = isOpen
  setIsOpenRef.current = setIsOpen
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

  const clearShowDelayTimer = () => {
    if (tooltipShowDelayTimerRef.current) {
      clearTimeout(tooltipShowDelayTimerRef.current)
      tooltipShowDelayTimerRef.current = null
    }
    showRequestDueAtRef.current = null
  }

  const clearScheduledShow = () => {
    if (handleShowTimerRef.current) {
      clearTimeout(handleShowTimerRef.current)
      handleShowTimerRef.current = null
    }
  }

  const cancelPendingInteractionOpen = () => {
    if (showRequestRef.current?.kind !== 'interaction') {
      return
    }
    clearShowDelayTimer()
    showRequestRef.current = null
  }

  const cancelPendingOpen = (includeImperative = false) => {
    const request = showRequestRef.current
    if (request && (includeImperative || request.kind === 'interaction')) {
      clearShowDelayTimer()
      showRequestRef.current = null
    }
    if (includeImperative) {
      clearScheduledShow()
    }
  }

  const handleShow = (value: boolean, cancelImperativeOpen = false) => {
    if (!mounted.current) {
      return
    }
    if (value) {
      renderedRef.current = true
      setRendered(true)
    } else {
      cancelPendingOpen(cancelImperativeOpen)
      clearScheduledShow()
    }
    /**
     * wait for the component to render and calculate position
     * before actually showing
     */
    clearScheduledShow()
    handleShowTimerRef.current = setTimeout(() => {
      handleShowTimerRef.current = null
      if (!mounted.current) {
        return
      }
      setIsOpenRef.current?.(value)
      if (isOpenRef.current === undefined) {
        setShow(value)
      }
    }, 10)
  }

  /**
   * this replicates the effect from `handleShow()`
   * when `isOpen` is changed from outside
   */
  useEffect(() => {
    if (isOpen === undefined) {
      return () => null
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
    const controlled = isOpen !== undefined
    const controlChanged = wasControlledRef.current !== controlled
    const controlledValueChanged = controlled && previousIsOpenRef.current !== isOpen

    if (controlChanged || controlledValueChanged) {
      // A request made under a different control mode must never be resumed
      // after the parent changes how visibility is managed.
      cancelPendingOpen(true)
    }

    wasControlledRef.current = controlled
    previousIsOpenRef.current = isOpen
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
        renderedRef.current = false
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

  const setCurrentAnchor = (anchor: HTMLElement | null) => {
    activeAnchorRef.current = anchor
    setActiveAnchor(anchor)
    setProviderActiveAnchor({ current: anchor })
  }

  const commitShowRequest = (request: PendingShowRequest) => {
    if (showRequestRef.current !== request) {
      return
    }
    showRequestRef.current = null
    clearShowDelayTimer()

    if (request.kind === 'imperative') {
      const options = request.options ?? null
      if (options?.anchorSelect) {
        const anchor = document.querySelector<HTMLElement>(options.anchorSelect)
        setCurrentAnchor(anchor)
      }
      setImperativeOptions(options)
    }
    handleShow(true)
  }

  const scheduleShowRequest = (request: PendingShowRequest) => {
    clearShowDelayTimer()
    const delay = Math.max(0, request.delay)
    const dueAt = request.startedAt + delay
    showRequestDueAtRef.current = dueAt
    const remaining = Math.max(0, dueAt - Date.now())

    if (remaining === 0) {
      commitShowRequest(request)
      return
    }

    tooltipShowDelayTimerRef.current = setTimeout(() => {
      commitShowRequest(request)
    }, remaining)
  }

  const startInteractionOpen = (anchor: HTMLElement) => {
    if (showRequestRef.current?.kind === 'imperative') {
      return
    }

    if (tooltipHideDelayTimerRef.current) {
      clearTimeout(tooltipHideDelayTimerRef.current)
      tooltipHideDelayTimerRef.current = null
    }

    const currentRequest = showRequestRef.current
    if (currentRequest?.kind === 'interaction' && currentRequest.anchor === anchor) {
      return
    }
    if (anchor === activeAnchorRef.current && (showRef.current || renderedRef.current)) {
      return
    }

    cancelPendingInteractionOpen()
    const request: PendingShowRequest = {
      kind: 'interaction',
      anchor,
      startedAt: Date.now(),
      delay: delayShow,
    }

    if (showRef.current || renderedRef.current) {
      handleShow(true)
      return
    }

    showRequestRef.current = request
    if (delayShow > 0) {
      scheduleShowRequest(request)
    } else {
      commitShowRequest(request)
    }
  }

  const handleHideTooltipDelayed = (
    delay = delayHide,
    respectTooltipHover = true,
    cancelImperativeOpen = false,
  ) => {
    cancelPendingOpen(cancelImperativeOpen)

    if (tooltipHideDelayTimerRef.current) {
      clearTimeout(tooltipHideDelayTimerRef.current)
    }

    tooltipHideDelayTimerRef.current = setTimeout(() => {
      tooltipHideDelayTimerRef.current = null
      if (respectTooltipHover && hoveringTooltip.current) {
        return
      }
      handleShow(false, cancelImperativeOpen)
    }, Math.max(0, delay))
  }

  const isAnchorInteractionActive = (anchor: HTMLElement) => {
    const state = anchorInteractionRef.current.get(anchor)
    return Boolean(state?.hover || state?.focus)
  }

  const handleShowTooltip = (event?: Event) => {
    if (!event || showRequestRef.current?.kind === 'imperative') {
      return
    }
    const target = (event.currentTarget ?? event.target) as HTMLElement | null
    if (!target?.isConnected) {
      /**
       * this happens when the target is removed from the DOM
       * at the same time the tooltip gets triggered
       */
      setCurrentAnchor(null)
      return
    }
    startInteractionOpen(target)
    setCurrentAnchor(target)
  }

  const handleHideTooltip = (anchor?: HTMLElement) => {
    if (showRequestRef.current?.kind === 'imperative') {
      return
    }
    if (anchor && activeAnchorRef.current !== anchor) {
      // A leave/blur from an old anchor must not close a tooltip opened by a
      // newer anchor.
      return
    }
    if (anchor && isAnchorInteractionActive(anchor)) {
      return
    }

    cancelPendingInteractionOpen()
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
    if (!showRef.current && !showRequestRef.current) {
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
    handleShow(false, true)
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
      handleShow(false, true)
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
      handleShow(false, true)
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
      capture?: boolean
    }[] = []

    const getEventAnchor = (event?: Event) =>
      (event?.currentTarget ?? event?.target) as HTMLElement | null

    const getAnchorInteractionState = (anchor: HTMLElement) => {
      const state = anchorInteractionRef.current.get(anchor) ?? { hover: false, focus: false }
      anchorInteractionRef.current.set(anchor, state)
      return state
    }

    const handleRegularOpen = (event?: Event, eventName?: string) => {
      const anchor = getEventAnchor(event)
      if (!anchor) {
        return
      }
      const relatedTarget = (event as MouseEvent | FocusEvent | undefined)?.relatedTarget
      if (
        relatedTarget instanceof Node &&
        anchor.contains(relatedTarget) &&
        (eventName === 'mouseover' || eventName === 'mouseenter' || eventName === 'focus')
      ) {
        return
      }
      const state = getAnchorInteractionState(anchor)
      const wasInteracting = state.hover || state.focus
      if (eventName === 'focus') {
        state.focus = true
      } else if (eventName === 'mouseover' || eventName === 'mouseenter') {
        state.hover = true
      }
      if (wasInteracting && activeAnchorRef.current === anchor) {
        return
      }
      handleShowTooltip(event)
    }

    const handleRegularClose = (event?: Event, eventName?: string) => {
      const anchor = getEventAnchor(event)
      if (!anchor) {
        return
      }
      const relatedTarget = (event as MouseEvent | FocusEvent | undefined)?.relatedTarget
      if (
        relatedTarget instanceof Node &&
        anchor.contains(relatedTarget) &&
        (eventName === 'mouseout' || eventName === 'mouseleave' || eventName === 'blur')
      ) {
        return
      }
      const state = getAnchorInteractionState(anchor)
      if (eventName === 'blur') {
        state.focus = false
      } else if (eventName === 'mouseout' || eventName === 'mouseleave') {
        state.hover = false
      }
      handleHideTooltip(anchor)
    }

    const handleClickOpenTooltipAnchor = (event?: Event) => {
      const anchor = getEventAnchor(event)
      if (!anchor) {
        return
      }
      if (showRef.current && anchor === activeAnchorRef.current) {
        /**
         * ignore clicking the anchor that was used to open the tooltip.
         * this avoids conflict with the click close event.
         */
        return
      }
      handleShowTooltip(event)
    }
    const handleClickCloseTooltipAnchor = (event?: Event) => {
      const anchor = getEventAnchor(event)
      if (!showRef.current || anchor !== activeAnchorRef.current) {
        /**
         * ignore clicking the anchor that was NOT used to open the tooltip.
         * this avoids closing the tooltip when clicking on a
         * new anchor with the tooltip already open.
         */
        return
      }
      handleHideTooltip(anchor ?? undefined)
    }

    const regularEvents = ['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'focus', 'blur']
    const clickEvents = ['click', 'dblclick', 'mousedown', 'mouseup']

    Object.entries(actualOpenEvents).forEach(([event, enabled]) => {
      if (!enabled) {
        return
      }
      if (regularEvents.includes(event)) {
        enabledEvents.push({
          event,
          listener: (eventObject) => handleRegularOpen(eventObject, event),
          capture: event === 'focus',
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
          listener: (eventObject) => handleRegularClose(eventObject, event),
          capture: event === 'blur',
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

    enabledEvents.forEach(({ event, listener, capture }) => {
      elementRefs.forEach((ref) => {
        ref.current?.addEventListener(event, listener, capture)
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
      enabledEvents.forEach(({ event, listener, capture }) => {
        elementRefs.forEach((ref) => {
          ref.current?.removeEventListener(event, listener, capture)
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
              renderedRef.current = false
              setRendered(false)
              handleShow(false, true)
              setActiveAnchor(null)
              if (tooltipHideDelayTimerRef.current) {
                clearTimeout(tooltipHideDelayTimerRef.current)
              }
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
    const imperativeAnchor = imperativeOptions?.anchorSelect
      ? document.querySelector<HTMLElement>(imperativeOptions.anchorSelect)
      : null
    const anchors = [...anchorsBySelect, anchorById, imperativeAnchor]
    if (!activeAnchor || !anchors.includes(activeAnchor)) {
      /**
       * if there is no active anchor,
       * or if the current active anchor is not amongst the allowed ones,
       * reset it
       */
      setActiveAnchor(anchorsBySelect[0] ?? anchorById)
    }
  }, [anchorId, anchorsBySelect, activeAnchor, imperativeOptions?.anchorSelect])

  useEffect(() => {
    if (defaultIsOpen) {
      handleShow(true)
    }
    return () => {
      cancelPendingOpen(true)
      clearScheduledShow()
      if (tooltipHideDelayTimerRef.current) {
        clearTimeout(tooltipHideDelayTimerRef.current)
      }
      if (missedTransitionTimerRef.current) {
        clearTimeout(missedTransitionTimerRef.current)
      }
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
    const request = showRequestRef.current
    if (request?.kind === 'interaction') {
      // Keep the original start time. Changing delayShow changes the due
      // time, but never starts a new wait.
      request.delay = delayShow
      scheduleShowRequest(request)
    }
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
      if (tooltipHideDelayTimerRef.current) {
        clearTimeout(tooltipHideDelayTimerRef.current)
        tooltipHideDelayTimerRef.current = null
      }
      cancelPendingOpen(true)

      const request: PendingShowRequest = {
        kind: 'imperative',
        options: options ?? null,
        startedAt: Date.now(),
        delay: options?.delay ?? 0,
      }
      if (request.delay > 0) {
        showRequestRef.current = request
        scheduleShowRequest(request)
      } else {
        showRequestRef.current = request
        commitShowRequest(request)
      }
    },
    close: (options) => {
      cancelPendingOpen(true)
      if (options?.delay && options.delay > 0) {
        handleHideTooltipDelayed(options.delay, false, true)
      } else {
        handleShow(false, true)
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
        renderedRef.current = false
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
