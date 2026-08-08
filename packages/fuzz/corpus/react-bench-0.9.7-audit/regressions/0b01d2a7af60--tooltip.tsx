// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 0b01d2a7af6022d01971e58df27dcf8883d1d0dcba494853f58841078198e42e
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

/**
 * a show that was requested but is still waiting for its delay to elapse.
 *
 * `startedAt` is when the show was *first* requested, so that changing
 * `delayShow` mid-wait can discount the time already waited.
 * imperative pending shows hold their own `options` (delay/content/place/...),
 * which only get applied once the delay is due.
 */
interface PendingShow {
  timer: NodeJS.Timeout
  startedAt: number
  imperative: boolean
  options: TooltipImperativeOpenOptions | null
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
  const pendingShowRef = useRef<PendingShow | null>(null)
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

  /**
   * a cancelled pending show is gone for good, so it can't be
   * resumed by a later rerender or prop change
   */
  const cancelPendingShow = () => {
    if (!pendingShowRef.current) {
      return
    }
    clearTimeout(pendingShowRef.current.timer)
    pendingShowRef.current = null
  }

  const cancelPendingHide = () => {
    if (!tooltipHideDelayTimerRef.current) {
      return
    }
    clearTimeout(tooltipHideDelayTimerRef.current)
    tooltipHideDelayTimerRef.current = null
  }

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
      if (isOpen === undefined) {
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
    } else {
      /**
       * being closed from outside ends any opening in progress,
       * so releasing control later can't resume it
       */
      cancelPendingShow()
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

  const handleShowTooltipDelayed = (
    delay = delayShow,
    {
      imperative = false,
      options = null,
      startedAt = Date.now(),
    }: {
      imperative?: boolean
      options?: TooltipImperativeOpenOptions | null
      /**
       * when a pending show is rescheduled (see `delayShow` below), this keeps
       * pointing at the original request so elapsed time isn't waited twice
       */
      startedAt?: number
    } = {},
  ) => {
    // a newer show request always replaces an older one
    cancelPendingShow()

    if (show && !imperative) {
      /**
       * the tooltip is already visible, so switching anchors shouldn't
       * make it disappear while the delay elapses again.
       * an imperative `open()` is exempt: its content must stay hidden until due.
       */
      handleShow(true)
      return
    }

    if (delay <= 0) {
      if (imperative) {
        setImperativeOptions(options)
      }
      handleShow(true)
      return
    }

    const timer = setTimeout(() => {
      pendingShowRef.current = null
      if (imperative) {
        setImperativeOptions(options)
      }
      handleShow(true)
    }, delay)
    pendingShowRef.current = { timer, startedAt, imperative, options }
  }

  const handleHideTooltipDelayed = (delay = delayHide) => {
    cancelPendingHide()

    tooltipHideDelayTimerRef.current = setTimeout(() => {
      tooltipHideDelayTimerRef.current = null
      if (hoveringTooltip.current) {
        return
      }
      handleShow(false)
    }, delay)
  }

  const handleShowTooltip = (event?: Event) => {
    if (!event) {
      return
    }
    const target = (event.currentTarget ?? event.target) as HTMLElement | null
    if (!target?.isConnected) {
      /**
       * this happens when the target is removed from the DOM
       * at the same time the tooltip gets triggered
       */
      setActiveAnchor(null)
      setProviderActiveAnchor({ current: null })
      return
    }
    if (pendingShowRef.current?.imperative) {
      /**
       * a pending imperative `open()` owns the tooltip until it's due,
       * so anchor events can't replace it (nor its anchor)
       */
      return
    }
    handleShowTooltipDelayed()
    setActiveAnchor(target)
    setProviderActiveAnchor({ current: target })

    cancelPendingHide()
  }

  const handleHideTooltip = (event?: Event) => {
    if (pendingShowRef.current?.imperative) {
      // anchor events can't cancel a pending imperative `open()`
      return
    }
    if (event && activeAnchor) {
      const target = (event.currentTarget ?? event.target) as HTMLElement | null
      if (target && target !== activeAnchor) {
        /**
         * a late event from an anchor that isn't the active one anymore.
         * acting on it would close the tooltip belonging to the current anchor.
         */
        return
      }
    }
    // leaving the anchor ends the interaction, so a show still waiting is dropped
    cancelPendingShow()
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
    if (!show) {
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
    /**
     * NOTE: this effect reruns on every anchor/prop change, so it must not
     * (re)schedule a show. Doing so would restart the wait on each rerender,
     * and reopen the tooltip after the interaction that requested it ended.
     */
    const elementRefs = new Set(anchorRefs)

    anchorsBySelect.forEach((anchor) => {
      elementRefs.add({ current: anchor })
    })

    const anchorById = document.querySelector<HTMLElement>(`[id='${anchorId}']`)
    if (anchorById) {
      elementRefs.add({ current: anchorById })
    }

    const handleScrollResize = () => {
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
      cancelPendingShow()
      handleShow(false)
    }
    if (actualGlobalCloseEvents.escape) {
      window.addEventListener('keydown', handleEsc)
    }

    if (actualGlobalCloseEvents.clickOutsideAnchor) {
      window.addEventListener('click', handleClickOutsideAnchors)
    }

    const enabledEvents: { event: string; listener: (event?: Event) => void }[] = []

    /**
     * `currentTarget` is the anchor the listener is attached to,
     * so clicks on its children count as clicks on the anchor itself
     */
    const getEventAnchor = (event?: Event) =>
      (event?.currentTarget ?? event?.target) as HTMLElement | null
    const handleClickOpenTooltipAnchor = (event?: Event) => {
      if (show && getEventAnchor(event) === activeAnchor) {
        /**
         * ignore clicking the anchor that was used to open the tooltip.
         * this avoids conflict with the click close event.
         */
        return
      }
      handleShowTooltip(event)
    }
    const handleClickCloseTooltipAnchor = (event?: Event) => {
      if (!show || getEventAnchor(event) !== activeAnchor) {
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

    Object.entries(actualOpenEvents).forEach(([event, enabled]) => {
      if (!enabled) {
        return
      }
      if (regularEvents.includes(event)) {
        enabledEvents.push({ event, listener: debouncedHandleShowTooltip })
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
        enabledEvents.push({ event, listener: debouncedHandleHideTooltip })
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

    enabledEvents.forEach(({ event, listener }) => {
      elementRefs.forEach((ref) => {
        ref.current?.addEventListener(event, listener)
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
      enabledEvents.forEach(({ event, listener }) => {
        elementRefs.forEach((ref) => {
          ref.current?.removeEventListener(event, listener)
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
              cancelPendingShow()
              cancelPendingHide()
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
      cancelPendingHide()
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
    const pendingShow = pendingShowRef.current
    if (!pendingShow || pendingShow.imperative) {
      /**
       * only reschedule a show that is actually waiting, otherwise changing
       * `delayShow` would open a tooltip nobody asked for.
       * an imperative `open()` keeps the delay it was called with.
       */
      return
    }
    /**
     * the new delay applies to the time already waited, so lowering it below
     * the elapsed time shows the tooltip right away
     */
    const elapsed = Date.now() - pendingShow.startedAt
    handleShowTooltipDelayed(delayShow - elapsed, { startedAt: pendingShow.startedAt })
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
      // opening supersedes a `close()` that is still waiting for its delay
      cancelPendingHide()
      /**
       * the options (content included) are only applied once the delay is due,
       * so a replacement stays hidden even if the tooltip is currently visible
       */
      handleShowTooltipDelayed(options?.delay ?? 0, {
        imperative: true,
        options: options ?? null,
      })
    },
    close: (options) => {
      /**
       * a pending open never survives a close, even a delayed one.
       * since its options were never applied, its content is released with it.
       */
      cancelPendingShow()
      if (options?.delay) {
        handleHideTooltipDelayed(options.delay)
      } else {
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
