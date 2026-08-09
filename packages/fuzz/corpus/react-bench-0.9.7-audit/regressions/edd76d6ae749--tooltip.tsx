// rule: effect-needs-cleanup
// file-path: src/components/Tooltip/Tooltip.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit edd76d6ae7494961c677550bac7a22b1a2bacbd5528340053d82db1ab3483378
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

type InteractionState = {
  hover: boolean
  focus: boolean
}

type PendingInteractionOpen = {
  anchor: HTMLElement
  startedAt: number
  requireActiveInteraction: boolean
  committing: boolean
  timer: NodeJS.Timeout | null
}

type PendingImperativeOpen = {
  options: TooltipImperativeOpenOptions | null
  timer: NodeJS.Timeout | null
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
  const tooltipHideDelayTimerRef = useRef<NodeJS.Timeout | null>(null)
  const tooltipHideDelayAnchorRef = useRef<HTMLElement | null>(null)
  const visibilityTimerRef = useRef<NodeJS.Timeout | null>(null)
  const visibilityRequestRef = useRef<boolean | null>(null)
  const visibilityRequestIdRef = useRef(0)
  const pendingInteractionOpenRef = useRef<PendingInteractionOpen | null>(null)
  const pendingImperativeOpenRef = useRef<PendingImperativeOpen | null>(null)
  const interactionStateRef = useRef(new Map<HTMLElement, InteractionState>())
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
  const activeAnchorRef = useRef(activeAnchor)
  const isOpenRef = useRef(isOpen)
  const delayShowRef = useRef(delayShow)
  const setIsOpenRef = useRef(setIsOpen)
  const setActiveAnchorRef = useRef(setActiveAnchor)
  const setProviderActiveAnchorRef = useRef(setProviderActiveAnchor)

  showRef.current = show
  activeAnchorRef.current = activeAnchor
  isOpenRef.current = isOpen
  delayShowRef.current = delayShow
  setIsOpenRef.current = setIsOpen
  setActiveAnchorRef.current = setActiveAnchor
  setProviderActiveAnchorRef.current = setProviderActiveAnchor

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

  const setRenderedValue = useCallback((value: boolean) => {
    setRendered(value)
  }, [])

  const setShowValue = useCallback((value: boolean) => {
    showRef.current = value
    setShow(value)
  }, [])

  const setCurrentAnchor = useCallback((anchor: HTMLElement | null) => {
    activeAnchorRef.current = anchor
    setActiveAnchorRef.current(anchor)
    setProviderActiveAnchorRef.current({ current: anchor })
  }, [])

  const clearDelayedClose = useCallback(() => {
    if (tooltipHideDelayTimerRef.current) {
      clearTimeout(tooltipHideDelayTimerRef.current)
    }
    tooltipHideDelayTimerRef.current = null
    tooltipHideDelayAnchorRef.current = null
  }, [])

  const cancelPendingInteractionOpen = useCallback(() => {
    const pendingOpen = pendingInteractionOpenRef.current
    if (pendingOpen?.timer) {
      clearTimeout(pendingOpen.timer)
    }
    pendingInteractionOpenRef.current = null
  }, [])

  const cancelPendingImperativeOpen = useCallback(() => {
    const pendingOpen = pendingImperativeOpenRef.current
    if (pendingOpen?.timer) {
      clearTimeout(pendingOpen.timer)
    }
    if (pendingOpen) {
      pendingOpen.options = null
    }
    pendingImperativeOpenRef.current = null
  }, [])

  const cancelPendingOpens = useCallback(() => {
    cancelPendingInteractionOpen()
    cancelPendingImperativeOpen()
  }, [cancelPendingInteractionOpen, cancelPendingImperativeOpen])

  const cancelScheduledVisibilityOpen = useCallback(() => {
    if (visibilityRequestRef.current !== true) {
      return
    }
    visibilityRequestIdRef.current += 1
    if (visibilityTimerRef.current) {
      clearTimeout(visibilityTimerRef.current)
    }
    visibilityTimerRef.current = null
    visibilityRequestRef.current = null
  }, [])

  const handleShow = useCallback(
    (value: boolean, onCommit?: () => void) => {
      if (!mounted.current) {
        return
      }
      if (value && isOpenRef.current !== false) {
        if (missedTransitionTimerRef.current) {
          clearTimeout(missedTransitionTimerRef.current)
          missedTransitionTimerRef.current = null
        }
        setRenderedValue(true)
      }

      visibilityRequestIdRef.current += 1
      const requestId = visibilityRequestIdRef.current
      const requestWasControlled = isOpenRef.current !== undefined
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current)
      }
      visibilityRequestRef.current = value

      /**
       * Wait for the component to render and calculate position before actually showing.
       * The request id prevents an already-queued open from winning over a later close.
       */
      visibilityTimerRef.current = setTimeout(() => {
        if (!mounted.current || requestId !== visibilityRequestIdRef.current) {
          return
        }
        visibilityTimerRef.current = null
        visibilityRequestRef.current = null
        setIsOpenRef.current?.(value)
        if (!requestWasControlled && isOpenRef.current === undefined) {
          setShowValue(value)
        }
        onCommit?.()
      }, 10)
    },
    [setRenderedValue, setShowValue],
  )

  const applyControlledVisibility = useCallback(
    (value: boolean) => {
      visibilityRequestIdRef.current += 1
      const requestId = visibilityRequestIdRef.current
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current)
      }
      visibilityRequestRef.current = null
      if (value) {
        setRenderedValue(true)
      }
      visibilityTimerRef.current = setTimeout(() => {
        if (!mounted.current || requestId !== visibilityRequestIdRef.current) {
          return
        }
        visibilityTimerRef.current = null
        setShowValue(value)
      }, 10)
    },
    [setRenderedValue, setShowValue],
  )

  const previousIsOpenRef = useRef(isOpen)

  /**
   * Controlled visibility is authoritative. Changing control mode invalidates work that
   * started in the previous mode so releasing control cannot revive an old request.
   */
  useEffect(() => {
    const previousIsOpen = previousIsOpenRef.current
    const controlModeChanged = (previousIsOpen === undefined) !== (isOpen === undefined)
    const controlledValueChanged =
      isOpen !== undefined && previousIsOpen !== undefined && previousIsOpen !== isOpen

    if (controlModeChanged || controlledValueChanged) {
      cancelPendingOpens()
      clearDelayedClose()
    }

    if (isOpen === undefined) {
      if (previousIsOpen !== undefined) {
        visibilityRequestIdRef.current += 1
        if (visibilityTimerRef.current) {
          clearTimeout(visibilityTimerRef.current)
        }
        visibilityTimerRef.current = null
        visibilityRequestRef.current = null
        setShowValue(previousIsOpen)
        if (!previousIsOpen) {
          setRenderedValue(false)
          setImperativeOptions(null)
        }
      }
    } else {
      applyControlledVisibility(isOpen)
    }

    previousIsOpenRef.current = isOpen
  }, [
    applyControlledVisibility,
    cancelPendingOpens,
    clearDelayedClose,
    isOpen,
    setRenderedValue,
    setShowValue,
  ])

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
        missedTransitionTimerRef.current = null
        /**
         * if the tooltip switches from `show === true` to `show === false` too fast
         * the transition never runs, so `onTransitionEnd` callback never gets fired
         */
        setRenderedValue(false)
        setImperativeOptions(null)
        afterHide?.()
        // +25ms just to make sure `onTransitionEnd` (if it gets fired) has time to run
      }, transitionShowDelay + 25)
    }
  }, [afterHide, afterShow, setRenderedValue, show])

  const handleComputedPosition = (newComputedPosition: IComputedPosition) => {
    setComputedPosition((oldComputedPosition) =>
      deepEqual(oldComputedPosition, newComputedPosition)
        ? oldComputedPosition
        : newComputedPosition,
    )
  }

  const isAnchorInteracting = useCallback((anchor: HTMLElement) => {
    const state = interactionStateRef.current.get(anchor)
    return Boolean(state?.hover || state?.focus)
  }, [])

  const completeInteractionOpen = useCallback(
    (pendingOpen: PendingInteractionOpen) => {
      if (pendingInteractionOpenRef.current !== pendingOpen) {
        return
      }
      if (
        pendingImperativeOpenRef.current ||
        !pendingOpen.anchor.isConnected ||
        (pendingOpen.requireActiveInteraction && !isAnchorInteracting(pendingOpen.anchor))
      ) {
        pendingInteractionOpenRef.current = null
        return
      }
      pendingOpen.timer = null
      pendingOpen.committing = true
      handleShow(true, () => {
        if (pendingInteractionOpenRef.current === pendingOpen) {
          pendingInteractionOpenRef.current = null
        }
      })
    },
    [handleShow, isAnchorInteracting],
  )

  const scheduleInteractionOpen = useCallback(
    (pendingOpen: PendingInteractionOpen) => {
      if (pendingOpen.committing) {
        return
      }
      if (pendingOpen.timer) {
        clearTimeout(pendingOpen.timer)
        pendingOpen.timer = null
      }
      const elapsed = Date.now() - pendingOpen.startedAt
      const remainingDelay = Math.max(0, delayShowRef.current - elapsed)
      if (!remainingDelay) {
        completeInteractionOpen(pendingOpen)
        return
      }
      pendingOpen.timer = setTimeout(() => completeInteractionOpen(pendingOpen), remainingDelay)
    },
    [completeInteractionOpen],
  )

  const beginAnchorOpen = useCallback(
    (anchor: HTMLElement, requireActiveInteraction: boolean) => {
      if (!anchor.isConnected) {
        setCurrentAnchor(null)
        return
      }
      if (pendingImperativeOpenRef.current) {
        return
      }

      clearDelayedClose()
      const currentlyVisible = isOpenRef.current === undefined ? showRef.current : isOpenRef.current
      if (currentlyVisible) {
        cancelPendingInteractionOpen()
        setCurrentAnchor(anchor)
        handleShow(true)
        return
      }

      const currentPendingOpen = pendingInteractionOpenRef.current
      if (currentPendingOpen?.anchor === anchor) {
        return
      }
      if (currentPendingOpen?.committing) {
        cancelScheduledVisibilityOpen()
        setRenderedValue(false)
      }
      cancelPendingInteractionOpen()
      setCurrentAnchor(anchor)
      const pendingOpen: PendingInteractionOpen = {
        anchor,
        startedAt: Date.now(),
        requireActiveInteraction,
        committing: false,
        timer: null,
      }
      pendingInteractionOpenRef.current = pendingOpen
      scheduleInteractionOpen(pendingOpen)
    },
    [
      cancelPendingInteractionOpen,
      cancelScheduledVisibilityOpen,
      clearDelayedClose,
      handleShow,
      scheduleInteractionOpen,
      setCurrentAnchor,
      setRenderedValue,
    ],
  )

  const performHide = useCallback(() => {
    clearDelayedClose()
    handleShow(false)
    const currentlyVisible = isOpenRef.current === undefined ? showRef.current : isOpenRef.current
    if (!currentlyVisible) {
      setRenderedValue(false)
      setImperativeOptions(null)
    }
  }, [clearDelayedClose, handleShow, setRenderedValue])

  const dismissTooltip = useCallback(
    (delay = 0, sourceAnchor: HTMLElement | null = null) => {
      cancelPendingOpens()
      cancelScheduledVisibilityOpen()

      const currentlyVisible = isOpenRef.current === undefined ? showRef.current : isOpenRef.current
      if (!currentlyVisible) {
        setRenderedValue(false)
        setImperativeOptions(null)
      }

      if (delay > 0) {
        clearDelayedClose()
        tooltipHideDelayAnchorRef.current = sourceAnchor
        tooltipHideDelayTimerRef.current = setTimeout(() => {
          tooltipHideDelayTimerRef.current = null
          const delayedCloseAnchor = tooltipHideDelayAnchorRef.current
          tooltipHideDelayAnchorRef.current = null
          if (
            hoveringTooltip.current ||
            (delayedCloseAnchor && activeAnchorRef.current !== delayedCloseAnchor)
          ) {
            return
          }
          performHide()
        }, delay)
        return
      }
      performHide()
    },
    [
      cancelPendingOpens,
      cancelScheduledVisibilityOpen,
      clearDelayedClose,
      performHide,
      setRenderedValue,
    ],
  )

  const handleHideTooltip = useCallback(
    (sourceAnchor: HTMLElement | null = null) => {
      if (clickable) {
        // allow time for the mouse to reach the tooltip, in case there's a gap
        dismissTooltip(delayHide || 100, sourceAnchor)
      } else {
        dismissTooltip(delayHide, sourceAnchor)
      }
    },
    [clickable, delayHide, dismissTooltip],
  )

  const isInternalAnchorTransition = (event: Event, anchor: HTMLElement) => {
    const relatedTarget = (event as MouseEvent | FocusEvent).relatedTarget
    return relatedTarget instanceof Node && anchor.contains(relatedTarget)
  }

  const handleRegularOpenTooltipAnchor = (event?: Event) => {
    const anchor = event?.currentTarget as HTMLElement | null
    if (!event || !anchor || isInternalAnchorTransition(event, anchor)) {
      return
    }
    const state = interactionStateRef.current.get(anchor) ?? { hover: false, focus: false }
    const wasAlreadyActive = event.type === 'focus' ? state.focus : state.hover
    if (event.type === 'focus') {
      state.focus = true
    } else {
      state.hover = true
    }
    interactionStateRef.current.set(anchor, state)
    if (wasAlreadyActive) {
      return
    }
    beginAnchorOpen(anchor, true)
  }

  const handleRegularCloseTooltipAnchor = (event?: Event) => {
    const anchor = event?.currentTarget as HTMLElement | null
    if (!event || !anchor || isInternalAnchorTransition(event, anchor)) {
      return
    }
    const state = interactionStateRef.current.get(anchor) ?? { hover: false, focus: false }
    if (event.type === 'blur') {
      state.focus = false
    } else {
      state.hover = false
    }
    if (state.hover || state.focus) {
      interactionStateRef.current.set(anchor, state)
      return
    }
    interactionStateRef.current.delete(anchor)

    // A hover/focus lifecycle never owns an imperative request.
    if (pendingImperativeOpenRef.current) {
      return
    }
    const pendingInteractionOpen = pendingInteractionOpenRef.current
    if (activeAnchorRef.current !== anchor && pendingInteractionOpen?.anchor !== anchor) {
      return
    }
    handleHideTooltip(anchor)
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
    const currentlyVisible = isOpenRef.current === undefined ? showRef.current : isOpenRef.current
    if (
      !currentlyVisible &&
      !pendingInteractionOpenRef.current &&
      !pendingImperativeOpenRef.current &&
      visibilityRequestRef.current !== true
    ) {
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
    const anchors = [anchorById, activeAnchorRef.current, ...anchorsBySelect]
    if (anchors.some((anchor) => anchor?.contains(target))) {
      return
    }
    dismissTooltip()
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
      dismissTooltip()
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
      dismissTooltip()
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
    const eventsOpeningAnAnchor = new WeakSet<Event>()

    const handleClickOpenTooltipAnchor = (event?: Event) => {
      const anchor = event?.currentTarget as HTMLElement | null
      const currentlyVisible = isOpenRef.current === undefined ? showRef.current : isOpenRef.current
      if (!anchor) {
        return
      }
      if (currentlyVisible && anchor === activeAnchorRef.current) {
        /**
         * ignore clicking the anchor that was used to open the tooltip.
         * this avoids conflict with the click close event.
         */
        return
      }
      if (event) {
        eventsOpeningAnAnchor.add(event)
      }
      beginAnchorOpen(anchor, false)
    }
    const handleClickCloseTooltipAnchor = (event?: Event) => {
      if (event && eventsOpeningAnAnchor.has(event)) {
        return
      }
      const anchor = event?.currentTarget as HTMLElement | null
      const currentlyVisible = isOpenRef.current === undefined ? showRef.current : isOpenRef.current
      const pendingForAnchor = pendingInteractionOpenRef.current?.anchor === anchor
      if (
        !anchor ||
        (!currentlyVisible && !pendingForAnchor) ||
        anchor !== activeAnchorRef.current
      ) {
        /**
         * ignore clicking the anchor that was NOT used to open the tooltip.
         * this avoids closing the tooltip when clicking on a
         * new anchor with the tooltip already open.
         */
        return
      }
      handleHideTooltip(anchor)
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
          listener: handleRegularOpenTooltipAnchor,
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
          listener: handleRegularCloseTooltipAnchor,
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
      clearDelayedClose()
    }
    const handleMouseLeaveTooltip = () => {
      hoveringTooltip.current = false
      handleHideTooltip(activeAnchorRef.current)
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
    anchorId,
    beginAnchorOpen,
    clearDelayedClose,
    clickable,
    closeOnEsc,
    closeOnResize,
    closeOnScroll,
    dismissTooltip,
    handleHideTooltip,
    imperativeModeOnly,
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
              dismissTooltip()
              setRenderedValue(false)
              setCurrentAnchor(null)
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
  }, [
    activeAnchor,
    anchorSelect,
    dismissTooltip,
    id,
    imperativeOptions?.anchorSelect,
    setCurrentAnchor,
    setRenderedValue,
  ])

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
      const nextAnchor = anchorsBySelect[0] ?? anchorById
      activeAnchorRef.current = nextAnchor
      setActiveAnchorRef.current(nextAnchor)
    }
  }, [activeAnchor, anchorId, anchorsBySelect])

  useEffect(() => {
    if (defaultIsOpen) {
      handleShow(true)
    }
    return () => {
      cancelPendingOpens()
      clearDelayedClose()
      visibilityRequestIdRef.current += 1
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current)
      }
      if (missedTransitionTimerRef.current) {
        clearTimeout(missedTransitionTimerRef.current)
      }
      interactionStateRef.current.clear()
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
    const pendingOpen = pendingInteractionOpenRef.current
    if (pendingOpen) {
      scheduleInteractionOpen(pendingOpen)
    }
  }, [delayShow, scheduleInteractionOpen])

  const actualContent = imperativeOptions?.content ?? content
  const canShow = (isOpen ?? show) && Object.keys(computedPosition.tooltipStyles).length > 0

  const completeImperativeOpen = (pendingOpen: PendingImperativeOpen) => {
    if (pendingImperativeOpenRef.current !== pendingOpen) {
      return
    }
    pendingOpen.timer = null
    if (!mounted.current) {
      pendingOpen.options = null
      pendingImperativeOpenRef.current = null
      return
    }

    const options = pendingOpen.options
    if (options?.anchorSelect) {
      const anchors = Array.from(document.querySelectorAll<HTMLElement>(options.anchorSelect))
      setAnchorsBySelect(anchors)
      setCurrentAnchor(anchors[0] ?? null)
    }
    setImperativeOptions(options)
    handleShow(true, () => {
      if (pendingImperativeOpenRef.current === pendingOpen) {
        pendingOpen.options = null
        pendingImperativeOpenRef.current = null
      }
    })
  }

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

      const hadScheduledOpen = visibilityRequestRef.current === true
      const currentlyVisible = isOpenRef.current === undefined ? showRef.current : isOpenRef.current
      clearDelayedClose()
      cancelPendingInteractionOpen()
      cancelPendingImperativeOpen()
      visibilityRequestIdRef.current += 1
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current)
      }
      visibilityTimerRef.current = null
      visibilityRequestRef.current = null
      if (hadScheduledOpen && !currentlyVisible) {
        setRenderedValue(false)
        setImperativeOptions(null)
      }

      const pendingOpen: PendingImperativeOpen = {
        options: options ?? null,
        timer: null,
      }
      pendingImperativeOpenRef.current = pendingOpen
      const openDelay = Math.max(0, options?.delay ?? 0)
      if (openDelay) {
        pendingOpen.timer = setTimeout(() => completeImperativeOpen(pendingOpen), openDelay)
        return
      }
      completeImperativeOpen(pendingOpen)
    },
    close: (options) => {
      dismissTooltip(Math.max(0, options?.delay ?? 0))
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
          missedTransitionTimerRef.current = null
        }
        if (
          (isOpen ?? show) ||
          visibilityRequestRef.current === true ||
          event.propertyName !== 'opacity'
        ) {
          return
        }
        setRenderedValue(false)
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
