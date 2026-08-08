// rule: no-unowned-async-error-clear
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 8490cb41ffc7f8fe9df1cc373eac769d469349d062c5dff15741faf1414f2800
import { useCallback, useRef, useState } from 'react'
import type { InteractRequest, InteractResult } from '../../../../hooks/useInteractionResponder'

export interface InteractionDelivery {
  /** True while a response is in flight (awaiting the responder's promise). */
  pending: boolean
  /**
   * Human-readable delivery-failure message, or `null` when the last attempt
   * has not failed. Survives a subsequent pending attempt and repeated
   * failures; cleared only by a confirmed (`ok: true`) delivery, and reset
   * whenever the tracked request changes.
   */
  error: string | null
  /**
   * Deliver a response. Returns the responder's result (or `undefined` when no
   * responder is wired — a read-only prompt). Never throws.
   */
  send: (request: InteractRequest) => Promise<InteractResult | undefined>
}

/**
 * Builds the delivery-failure message shown to the user. Metadata is optional,
 * so this MUST never interpolate an absent `status`/`reason` — otherwise the UI
 * would render the literal text `undefined`. When no metadata is present the
 * message is just the base "couldn't deliver" line.
 */
export function formatDeliveryError(result: { status?: number; reason?: string }): string {
  const detail = [
    // status 0 is our sentinel for "no HTTP response" (network error) — skip it.
    typeof result.status === 'number' && result.status !== 0 ? `HTTP ${result.status}` : null,
    typeof result.reason === 'string' && result.reason.trim() ? result.reason.trim() : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  const base = "Couldn't deliver your response. Try again."
  return detail ? `${base} (${detail})` : base
}

/**
 * Tracks the delivery lifecycle for a single interaction request.
 *
 * Invariants (see the permission-prompt spec):
 * - A response staying in flight leaves the prompt PENDING — nothing is
 *   resolved locally. Confirmation (`ok: true`) also does not resolve the
 *   prompt; the card resolves only when the interaction data says so.
 * - A delivery error persists across a following pending attempt and across
 *   repeated failures, and is cleared ONLY by a confirmed delivery.
 * - The error never carries over to another request: it resets when
 *   `requestId` changes.
 */
export function useInteractionDelivery(
  requestId: string | null | undefined,
  respond: ((request: InteractRequest) => Promise<InteractResult>) | undefined,
): InteractionDelivery {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the tracked request changes. Adjusting state during render is
  // the idiomatic React pattern for "derive fresh state from a changed prop" —
  // it re-renders immediately without ever committing the stale error.
  const currentId = requestId ?? null
  const [trackedId, setTrackedId] = useState<string | null>(currentId)
  if (trackedId !== currentId) {
    setTrackedId(currentId)
    setPending(false)
    setError(null)
  }

  // Guards against a late-resolving promise from a previous request writing
  // state after the request has already changed.
  const activeIdRef = useRef<string | null>(currentId)
  activeIdRef.current = currentId

  const send = useCallback(
    async (request: InteractRequest): Promise<InteractResult | undefined> => {
      if (!respond) return undefined
      const sentFor = request.requestId
      // Enter pending WITHOUT clearing any existing error — an in-flight retry
      // must keep the previous failure visible until it actually succeeds.
      setPending(true)
      const result = await respond(request)
      // Drop stale results for a request that is no longer active.
      if (activeIdRef.current !== sentFor) return result
      setPending(false)
      setError(result.ok ? null : formatDeliveryError(result))
      return result
    },
    [respond],
  )

  return { pending, error, send }
}
