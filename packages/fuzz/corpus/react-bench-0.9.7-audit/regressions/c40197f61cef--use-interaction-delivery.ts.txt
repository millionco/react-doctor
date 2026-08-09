// rule: no-loading-flag-reset-outside-finally, no-unowned-async-error-clear
// file-path: packages/shared/src/hooks/useInteractionDelivery.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit c40197f61cefe5ff0e795b63469c632a57ea956ad4cff735ad1954f59e638bb2
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InteractRequest, InteractResult } from './useInteractionResponder'

export type DeliveryFailure = Extract<InteractResult, { ok: false }>

export function formatDeliveryFailureMessage(failure: DeliveryFailure): string {
  const parts: string[] = ["Couldn't deliver your response."]
  if (failure.status !== undefined) {
    parts.push(`(${failure.status})`)
  }
  if (failure.reason !== undefined && failure.reason !== '') {
    parts.push(failure.reason)
  }
  return parts.join(' ')
}

/**
 * Tracks in-flight interaction delivery and the last failure for the active
 * request. Clears failure only after `ok: true`; resets when `requestId` changes.
 */
export function useInteractionDelivery(
  requestId: string | null | undefined,
  respond?: (request: InteractRequest) => Promise<InteractResult>,
) {
  const [deliveryPending, setDeliveryPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<DeliveryFailure | null>(null)
  const inFlightRef = useRef(0)

  useEffect(() => {
    setDeliveryError(null)
    setDeliveryPending(false)
    inFlightRef.current = 0
  }, [requestId])

  const deliver = useCallback(
    async (request: InteractRequest) => {
      if (!respond) return
      const flight = ++inFlightRef.current
      setDeliveryPending(true)
      try {
        const result = await respond(request)
        if (flight !== inFlightRef.current) return
        setDeliveryPending(false)
        if (result.ok) {
          setDeliveryError(null)
        } else {
          setDeliveryError(result)
        }
      } catch {
        if (flight !== inFlightRef.current) return
        setDeliveryPending(false)
        setDeliveryError({ ok: false })
      }
    },
    [respond],
  )

  return { deliver, deliveryPending, deliveryError }
}
