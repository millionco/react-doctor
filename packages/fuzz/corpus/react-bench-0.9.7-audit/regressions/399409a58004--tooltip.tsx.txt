// rule: effect-needs-cleanup
// file-path: src/components/Tooltip/Tooltip.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 399409a580048db79f861063de8016c76a79d52c6fcef26d420c59a3ed6c3a91
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

type PendingOpen = {
  kind: 'anchor' | 'imperative'
  anchor: HTMLElement | null
  options?: TooltipImperativeOpenOptions
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
  const tooltipHideDelayTimerRef = useRef<NodeJS.Timeout | null>(null)
  const tooltipVisibilityTimerRef = useRef<NodeJS.Timeout | null>(null)
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
  const pendingOpenRef = useRef<PendingOpen | null>(null)
  const activeAnchorRef = useRef<HTMLElement | null>(activeAnchor)
  const showRef = useRef(show)
  const interactionsRef = useRef(new Map<HTMLElement, { hovering: boolean; focused: boolean }>())
  const previousIsOpenRef = useRef<boolean | undefined>(isOpen)
  const lastFloatPosition = useRef<IPosition | null>(null)
  /**
   * @todo Remove this in a future version (provider/wrapper method is deprecated)
   */
  const { anchorRefs, setActiveAnchor: setProviderActiveAnchor } = useTooltip(id)
  const hoveringTooltip = useRef(false)
  const [anchorsBySelect, setAnchorsBySelect] = useState<HTMLElement[]>([])
  const mounted = useRef(false)

  activeAnchorRef.current = activeAnchor
  showRef.current = show

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
  }

  const clearHideDelayTimer = () => {
    if (tooltipHideDelayTimerRef.current) {
      clearTimeout(tooltipHideDelayTimerRef.current)
      tooltipHideDelayTimerRef.current = null
    }
  }

  const cancelPendingOpen = () => {
    pendingOpenRef.current = null
    clearShowDelayTimer()
  }

  const handleShow = (value: boolean) => {
    if (!mounted.current) {
      return
    }
    if (!value) {
      cancelPendingOpen()
    }
    if (tooltipVisibilityTimerRef.current) {
      clearTimeout(tooltipVisibilityTimerRef.current)
    }
    if (value) {
      setRendered(true)
    }
    /**
     * wait for the component to render and calculate position
     * before actually showing
     */
    tooltipVisibilityTimerRef.current = setTimeout(() => {
      tooltipVisibilityTimerRef.current = null
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
    const wasControlled = previousIsOpenRef.current !== undefined
    if (wasControlled && (isOpen === undefined || isOpen === false)) {
      cancelPendingOpen()
    }
    previousIsOpenRef.current = isOpen
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

  const resolveAnchor = (selector?: string) => {
    if (!selector) {
      return activeAnchorRef.current
    }
    try {
      return document.querySelector<HTMLElement>(selector)
    } catch {
      return null
    }
  }

  const setTooltipAnchor = (anchor: HTMLElement | null) => {
    activeAnchorRef.current = anchor
    setActiveAnchor(anchor)
    setProviderActiveAnchor({ current: anchor })
  }

  const commitOpen = (request: PendingOpen) => {
    if (pendingOpenRef.current !== request) {
      return
    }
    pendingOpenRef.current = null
    clearShowDelayTimer()
    if (request.kind === 'imperative') {
      setTooltipAnchor(request.anchor)
      setImperativeOptions(request.options ?? null)
    } else {
      setImperativeOptions(null)
    }
    clearHideDelayTimer()
    handleShow(true)
  }

  const scheduleOpen = (request: PendingOpen) => {
    if (pendingOpenRef.current !== request) {
      return
    }
    clearShowDelayTimer()
    const elapsed = Date.now() - request.startedAt
    const remaining = Math.max(0, request.delay - elapsed)
    if (!remaining) {
      commitOpen(request)
      return
    }
    tooltipShowDelayTimerRef.current = setTimeout(() => {
      commitOpen(request)
    }, remaining)
  }

  const handleShowTooltipDelayed = (delay = delayShow) => {
    const request: PendingOpen = {
      kind: 'anchor',
      anchor: activeAnchorRef.current,
      startedAt: Date.now(),
      delay,
    }
    pendingOpenRef.current = request
    scheduleOpen(request)
  }

  const getInteraction = (anchor: HTMLElement) => {
    let interaction = interactionsRef.current.get(anchor)
    if (!interaction) {
      interaction = { hovering: false, focused: false }
      interactionsRef.current.set(anchor, interaction)
    }
    return interaction
  }

  const isInsideAnchor = (anchor: HTMLElement, relatedTarget: EventTarget | null) =>
    relatedTarget instanceof Node && anchor.contains(relatedTarget)

  const updateAnchorInteraction = (event: Event, open: boolean) => {
    const anchor = event.currentTarget as HTMLElement | null
    if (!anchor) {
      return null
    }
    const interaction = getInteraction(anchor)
    if (event.type === 'focus' || event.type === 'blur') {
      if (event.type === 'blur' && isInsideAnchor(anchor, (event as FocusEvent).relatedTarget)) {
        return interaction
      }
      interaction.focused = open
    } else if (event.type === 'mouseover' || event.type === 'mouseout') {
      if (isInsideAnchor(anchor, (event as MouseEvent).relatedTarget)) {
        return interaction
      }
      interaction.hovering = open
    } else if (event.type === 'mouseenter' || event.type === 'mouseleave') {
      interaction.hovering = open
    }
    return interaction
  }

  const handleHideTooltipDelayed = (delay = delayHide) => {
    clearHideDelayTimer()

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
    if (pendingOpenRef.current?.kind === 'imperative') {
      return
    }
    if (!target?.isConnected) {
      /**
       * this happens when the target is removed from the DOM
       * at the same time the tooltip gets triggered
       */
      setActiveAnchor(null)
      setProviderActiveAnchor({ current: null })
      return
    }
    updateAnchorInteraction(event, true)
    if (pendingOpenRef.current?.kind === 'anchor' && pendingOpenRef.current.anchor === target) {
      return
    }
    if (
      activeAnchorRef.current === target &&
      (showRef.current || tooltipVisibilityTimerRef.current)
    ) {
      return
    }
    if (showRef.current) {
      setTooltipAnchor(target)
      cancelPendingOpen()
      clearHideDelayTimer()
      handleShow(true)
      return
    }

    if (delayShow) {
      clearHideDelayTimer()
      setTooltipAnchor(target)
      handleShowTooltipDelayed(delayShow)
    } else {
      cancelPendingOpen()
      clearHideDelayTimer()
      handleShow(true)
      setTooltipAnchor(target)
    }
  }

  const handleHideTooltip = (event?: Event) => {
    const anchor = event?.currentTarget as HTMLElement | null
    if (anchor && activeAnchorRef.current !== anchor) {
      return
    }
    const interaction = anchor && event ? updateAnchorInteraction(event, false) : null
    if (interaction && (interaction.hovering || interaction.focused)) {
      return
    }
    if (pendingOpenRef.current?.kind === 'imperative') {
      return
    }
    cancelPendingOpen()
    clearHideDelayTimer()
    if (clickable) {
      // allow time for the mouse to reach the tooltip, in case there's a gap
      handleHideTooltipDelayed(delayHide || 100)
    } else if (delayHide) {
      handleHideTooltipDelayed()
    } else {
      handleShow(false)
    }
  }

  // Keep the paired mouse/focus events from requesting the same open twice.
  const internalDebouncedHandleShowTooltip = debounce(handleShowTooltip, 50, true)
  const internalDebouncedHandleHideTooltip = debounce(handleHideTooltip, 50, true)
  const debouncedHandleShowTooltip = (event?: Event) => {
    internalDebouncedHandleHideTooltip.cancel()
    internalDebouncedHandleShowTooltip(event)
  }
  const debouncedHandleHideTooltip = (event?: Event) => {
    internalDebouncedHandleShowTooltip.cancel()
    internalDebouncedHandleHideTooltip(event)
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
    cancelPendingOpen()
    handleShow(false)
  }

  /*
   * Hover and focus are tracked independently, so they do not need a debounce
   * to prevent one event from cancelling the other.
   */
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
      if (showRef.current && event?.currentTarget === activeAnchorRef.current) {
        /**
         * ignore clicking the anchor that was used to open the tooltip.
         * this avoids conflict with the click close event.
         */
        return
      }
      handleShowTooltip(event)
    }
    const handleClickCloseTooltipAnchor = (event?: Event) => {
      if (!showRef.current || event?.currentTarget !== activeAnchorRef.current) {
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
        ref.current?.addEventListener(event, listener, event === 'focus' || event === 'blur')
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
          ref.current?.removeEventListener(event, listener, event === 'focus' || event === 'blur')
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
    isOpen,
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
              if (tooltipShowDelayTimerRef.current) {
                clearTimeout(tooltipShowDelayTimerRef.current)
              }
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
      if (tooltipShowDelayTimerRef.current) {
        clearShowDelayTimer()
      }
      if (tooltipHideDelayTimerRef.current) {
        clearHideDelayTimer()
      }
      if (tooltipVisibilityTimerRef.current) {
        clearTimeout(tooltipVisibilityTimerRef.current)
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
    const pendingOpen = pendingOpenRef.current
    if (pendingOpen?.kind === 'anchor') {
      pendingOpen.delay = delayShow
      scheduleOpen(pendingOpen)
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
      clearHideDelayTimer()
      const request: PendingOpen = {
        kind: 'imperative',
        anchor: resolveAnchor(options?.anchorSelect),
        options,
        startedAt: Date.now(),
        delay: options?.delay ?? 0,
      }
      pendingOpenRef.current = request
      scheduleOpen(request)
    },
    close: (options) => {
      cancelPendingOpen()
      clearHideDelayTimer()
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
