// rule: effect-needs-cleanup
// file-path: src/components/Tooltip/Tooltip.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 3ec4780f50343bcfa1bb428dcbe63c50253f47d7df66b8e472b7f82243f3c33e
import React, { useEffect, useState, useRef, useCallback, useImperativeHandle } from 'react'
import { autoUpdate } from '@floating-ui/dom'
import classNames from 'classnames'
import {
  debounce,
  deepEqual,
  useEffectWithNext,
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
  /**
   * the delay of a pending tooltip opening, so rerenders and prop
   * changes can keep track of it instead of restarting the wait
   */
  const pendingShowDelayRef = useRef<number | null>(null)
  /**
   * `Date.now()` timestamp of when the pending tooltip opening was
   * requested, so elapsed time can be taken into account if `delayShow`
   * (or anything else) changes in the meantime
   */
  const pendingShowStartedAtRef = useRef(0)
  /**
   * options of the last pending (delayed) imperative `open()` call.
   * they are only applied once the delay elapses, so the new content
   * stays hidden until due
   */
  const pendingImperativeOptionsRef = useRef<TooltipImperativeOpenOptions | null>(null)
  /**
   * identifies the current anchor interaction. the anchor events effect
   * invalidates it on cleanup, and every new anchor interaction bumps
   * it, so a pending opening is only kept alive while the interaction
   * that started it is still going on
   */
  const interactionIdRef = useRef(0)
  /**
   * the interaction that owns the pending opening
   */
  const pendingShowInteractionIdRef = useRef(0)

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
      if (isOpen === undefined || isOpen) {
        /**
         * in controlled mode (`isOpen !== undefined`), visibility is
         * determined by the `isOpen` prop, so the tooltip is only
         * rendered when it asks for the tooltip to be shown
         */
        setRendered(true)
      }
    } else {
      /**
       * once the tooltip starts closing, any pending opening must
       * not bring it back
       */
      if (pendingImperativeOptionsRef.current) {
        pendingImperativeOptionsRef.current = null
        setImperativeOptions(null)
      }
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
   * cancels a delayed tooltip opening without touching any
   * pending imperative opening.
   * used when rescheduling or adjusting the remaining delay.
   */
  const cancelPendingShow = () => {
    if (tooltipShowDelayTimerRef.current) {
      clearTimeout(tooltipShowDelayTimerRef.current)
      tooltipShowDelayTimerRef.current = null
    }
    pendingShowDelayRef.current = null
    /**
     * invalidate the interaction that requested the pending opening.
     * a new interaction will bump it, restarting the wait from zero
     */
    interactionIdRef.current += 1
  }

  /**
   * cancels a delayed tooltip opening for good, releasing the content
   * requested by a pending imperative `open()` call as well.
   */
  const cancelPendingShowAndRelease = () => {
    cancelPendingShow()
    if (pendingImperativeOptionsRef.current) {
      pendingImperativeOptionsRef.current = null
      setImperativeOptions(null)
    }
  }

  const cancelPendingHide = () => {
    if (tooltipHideDelayTimerRef.current) {
      clearTimeout(tooltipHideDelayTimerRef.current)
      tooltipHideDelayTimerRef.current = null
    }
  }

  /**
   * checks whether the inputs that define the current interaction with
   * the anchors changed between two runs of the anchor events effect.
   * a change to any of them cancels any pending opening, while regular
   * rerenders and unrelated prop changes keep it intact
   */
  const interactionInputsChanged = (currentInputs: unknown[], previousInputs: unknown[]) =>
    currentInputs.length !== previousInputs.length ||
    currentInputs.some((input, index) => !Object.is(input, previousInputs[index]))

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

  const handleShowTooltipDelayed = (delay = delayShow) => {
    if (
      tooltipShowDelayTimerRef.current &&
      pendingShowDelayRef.current !== null &&
      pendingShowInteractionIdRef.current === interactionIdRef.current
    ) {
      /**
       * there is already a pending opening from the current interaction.
       * adjust the remaining wait to the new delay instead of restarting
       * it, so the elapsed time is taken into account
       */
      const remaining = Math.max(0, delay - (Date.now() - pendingShowStartedAtRef.current))
      if (remaining === 0) {
        cancelPendingShow()
        if (pendingImperativeOptionsRef.current) {
          setImperativeOptions(pendingImperativeOptionsRef.current)
          pendingImperativeOptionsRef.current = null
        }
        handleShow(true)
        return
      }
      clearTimeout(tooltipShowDelayTimerRef.current)
      pendingShowDelayRef.current = remaining
      tooltipShowDelayTimerRef.current = setTimeout(() => {
        tooltipShowDelayTimerRef.current = null
        pendingShowDelayRef.current = null
        if (pendingImperativeOptionsRef.current) {
          setImperativeOptions(pendingImperativeOptionsRef.current)
          pendingImperativeOptionsRef.current = null
        }
        handleShow(true)
      }, remaining)
      return
    }

    if (pendingImperativeOptionsRef.current && rendered) {
      /**
       * an imperative `open()` call with a delay replaces the options of a
       * tooltip that is already visible, but the new content must stay
       * hidden until the delay is due
       */
      pendingShowStartedAtRef.current = Date.now()
      pendingShowDelayRef.current = delay
      pendingShowInteractionIdRef.current = interactionIdRef.current
      tooltipShowDelayTimerRef.current = setTimeout(() => {
        tooltipShowDelayTimerRef.current = null
        pendingShowDelayRef.current = null
        setImperativeOptions(pendingImperativeOptionsRef.current)
        pendingImperativeOptionsRef.current = null
      }, delay)
      return
    }

    if (rendered) {
      // if the tooltip is already rendered, ignore delay
      handleShow(true)
      return
    }

    pendingShowStartedAtRef.current = Date.now()
    pendingShowDelayRef.current = delay
    pendingShowInteractionIdRef.current = interactionIdRef.current
    tooltipShowDelayTimerRef.current = setTimeout(() => {
      tooltipShowDelayTimerRef.current = null
      pendingShowDelayRef.current = null
      if (pendingImperativeOptionsRef.current) {
        setImperativeOptions(pendingImperativeOptionsRef.current)
        pendingImperativeOptionsRef.current = null
      }
      handleShow(true)
    }, delay)
  }

  const handleHideTooltipDelayed = (delay = delayHide) => {
    /**
     * any closing (even a delayed one) immediately cancels a pending
     * opening and releases the content it requested
     */
    cancelPendingShowAndRelease()
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
    /**
     * anchor events can not replace or cancel a pending (delayed)
     * imperative opening, they just switch the anchor
     */
    if (!pendingImperativeOptionsRef.current) {
      if (delayShow) {
        handleShowTooltipDelayed()
      } else {
        handleShow(true)
      }
    }
    setActiveAnchor(target)
    setProviderActiveAnchor({ current: target })

    cancelPendingHide()
  }

  const handleHideTooltip = (event?: Event) => {
    if (event?.currentTarget && activeAnchor && event.currentTarget !== activeAnchor) {
      /**
       * a late (stale) event from a previously interacted anchor must not
       * affect the current anchor interaction
       */
      return
    }
    if (clickable) {
      // allow time for the mouse to reach the tooltip, in case there's a gap
      handleHideTooltipDelayed(delayHide || 100)
    } else if (delayHide) {
      handleHideTooltipDelayed()
    } else {
      handleShow(false)
      cancelPendingShowAndRelease()
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
    const hasPendingOpen = Boolean(
      tooltipShowDelayTimerRef.current && pendingShowDelayRef.current !== null,
    )
    if (!show && !hasPendingOpen) {
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
    handleShow(false)
    cancelPendingShowAndRelease()
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

  /**
   * the inputs that define the current interaction with the anchors.
   * when any of them changes, a pending opening from a previous
   * interaction is canceled, while regular rerenders and unrelated
   * prop changes keep the pending opening intact
   */
  const interactionInputs = [
    activeAnchor,
    anchorsBySelect,
    anchorId,
    anchorRefs,
    openEvents,
    closeEvents,
    shouldOpenOnClick,
    imperativeModeOnly,
  ]

  useEffectWithNext(
    () => {
      const elementRefs = new Set(anchorRefs)

      anchorsBySelect.forEach((anchor) => {
        elementRefs.add({ current: anchor })
      })

      const anchorById = document.querySelector<HTMLElement>(`[id='${anchorId}']`)
      if (anchorById) {
        elementRefs.add({ current: anchorById })
      }

      const handleScrollResize = () => {
        /**
         * dismissing the tooltip also cancels any pending opening
         * and releases the content it requested
         */
        cancelPendingShowAndRelease()
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
        /**
         * dismissing the tooltip also cancels any pending opening
         * and releases the content it requested
         */
        cancelPendingShowAndRelease()
        handleShow(false)
      }
      if (actualGlobalCloseEvents.escape) {
        window.addEventListener('keydown', handleEsc)
      }

      if (actualGlobalCloseEvents.clickOutsideAnchor) {
        window.addEventListener('click', handleClickOutsideAnchors)
      }

      const enabledEvents: { event: string; listener: (event?: Event) => void }[] = []

      const handleClickOpenTooltipAnchor = (event?: Event) => {
        if (show && event?.target === activeAnchor) {
          /**
           * ignore clicking the anchor that was used to open the tooltip.
           * this avoids conflict with the click close event.
           */
          return
        }
        handleShowTooltip(event)
      }
      const handleClickCloseTooltipAnchor = (event?: Event) => {
        if (!show || event?.target !== activeAnchor) {
          /**
           * ignore clicking the anchor that was NOT used to open the tooltip.
           * this avoids closing the tooltip when clicking on a
           * new anchor with the tooltip already open.
           */
          return
        }
        handleHideTooltip()
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
      const handleMouseLeaveTooltip = (event?: Event) => {
        hoveringTooltip.current = false
        handleHideTooltip(event)
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

      /**
       * rendered is also a dependency to ensure anchor observers are re-registered
       * since `tooltipRef` becomes stale after removing/adding the tooltip to the DOM
       */
      return (nextInteractionInputs?: unknown[]) => {
        if (
          nextInteractionInputs === undefined ||
          (interactionInputsChanged(nextInteractionInputs, interactionInputs) &&
            /**
             * a wait (re)started by the event handlers of the update that
             * is triggering this cleanup is left untouched, so the
             * interaction it belongs to can go on normally
             */
            Date.now() - pendingShowStartedAtRef.current >= 5)
        ) {
          /**
           * the interaction ended or its inputs changed:
           * cancel any pending opening from it.
           * regular rerenders keep the same inputs, so the wait is
           * never restarted by them
           */
          cancelPendingShow()
        }
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
    },
    interactionInputs,
    [
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
    ],
  )

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
              cancelPendingShowAndRelease()
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
      pendingImperativeOptionsRef.current = null
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
    if (activeAnchor && pendingShowDelayRef.current !== null && tooltipShowDelayTimerRef.current) {
      /**
       * there is a pending opening: adjust the remaining wait to the new
       * `delayShow` value, taking the elapsed time into account.
       * if there is no pending opening (the interaction already ended),
       * the tooltip must not reopen
       */
      handleShowTooltipDelayed(delayShow)
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
      /**
       * a newer `open()` call replaces an older one and cancels any
       * delayed `close()` call
       */
      cancelPendingShow()
      cancelPendingHide()
      if (options?.delay) {
        /**
         * the requested delay is independent from `delayShow`, and the
         * options (including the content) are only applied once the
         * delay elapses, so the new content stays hidden until due
         */
        pendingImperativeOptionsRef.current = options
        handleShowTooltipDelayed(options.delay)
      } else {
        pendingImperativeOptionsRef.current = null
        setImperativeOptions(options ?? null)
        handleShow(true)
      }
    },
    close: (options) => {
      /**
       * any `close()` call, even a delayed one, immediately cancels a
       * pending opening and releases the content it requested
       */
      cancelPendingShowAndRelease()
      if (options?.delay) {
        handleHideTooltipDelayed(options.delay)
      } else {
        cancelPendingHide()
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
