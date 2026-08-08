// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit c0c5231b6288f99fcdef7a416d080c6e3d2d9eb946f45d1468d861570a19a73f
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  normalizePermissionRequest,
  normalizeAskQuestion,
  normalizePlanApproval,
  normalizeElicitation,
} from '../../../../lib/interaction-normalizers'
import { PermissionCard } from './PermissionCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { PlanApprovalCard } from './PlanApprovalCard'
import { ElicitationCard } from './ElicitationCard'
import { CompactInteractionPreview } from './CompactInteractionPreview'
import type { PendingInteractionMeta } from './CompactInteractionPreview'
import { InteractionError } from './InteractionError'
import type { InteractResult } from '../../../../hooks/useInteractionResponder'

// Re-export so consumers can import types from this file
export type { PendingInteractionMeta } from './CompactInteractionPreview'

// ── Types ──────────────────────────────────────────────────────────

// Local mirror of the ts-rs-generated `InteractionBlock` contract. `shared`
// cannot import `apps/web/src/types/generated/InteractionBlock` (it escapes
// shared's tsconfig rootDir — TS6059), so the shape is declared here with the
// SAME optionality as the generated contract: `requestId`/`historicalSource`
// are OPTIONAL (the previous fork wrongly marked them required), and
// `historicalSource` is the `HistoricalSource` union (not bare `string`).
export interface FullInteractionBlock {
  id: string
  variant: 'permission' | 'question' | 'plan' | 'elicitation'
  requestId?: string | null
  resolved: boolean
  historicalSource?: 'system_variant' | 'inferred_from_tool_pattern' | null
  data: unknown
}

export type InteractRequest =
  | { variant: 'permission'; requestId: string; allowed: boolean; updatedPermissions?: unknown[] }
  | { variant: 'question'; requestId: string; answers: Record<string, string> }
  | {
      variant: 'plan'
      requestId: string
      approved: boolean
      feedback?: string
      bypassPermissions?: boolean
    }
  | { variant: 'elicitation'; requestId: string; response: string }

export type { InteractResult } from '../../../../hooks/useInteractionResponder'

export interface SessionInteractionCardProps {
  sessionId: string
  meta: PendingInteractionMeta
  fullInteraction: FullInteractionBlock | null
  respond?: (request: InteractRequest) => Promise<InteractResult>
}

// ── Component ──────────────────────────────────────────────────────

export function SessionInteractionCard({
  meta,
  fullInteraction,
  respond,
}: SessionInteractionCardProps) {
  // While full data is loading, show compact preview
  if (!fullInteraction) {
    return <CompactInteractionPreview meta={meta} />
  }

  return <FullCard fullInteraction={fullInteraction} respond={respond} />
}

// ── Inner card renderer (avoids conditional hooks in parent) ──────

function FullCard({
  fullInteraction,
  respond,
}: {
  fullInteraction: FullInteractionBlock
  respond?: (request: InteractRequest) => Promise<InteractResult>
}) {
  const { variant, data } = fullInteraction
  const requestId = fullInteraction.requestId
  const [isPending, setIsPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<{
    requestId: string
    message: string
  } | null>(null)
  const activeRequestIdRef = useRef(requestId)
  activeRequestIdRef.current = requestId

  // Delivery state belongs to a request, never to the card instance. A card
  // can be reused by React as live interaction data changes.
  useEffect(() => {
    setIsPending(false)
    setDeliveryError(null)
  }, [requestId])

  const deliver = useCallback(
    async (request: InteractRequest) => {
      if (!respond) return
      setIsPending(true)
      try {
        const result = await respond(request)
        if (activeRequestIdRef.current !== request.requestId) return
        if (result.ok) {
          setDeliveryError(null)
          return
        }
        const details = [
          result.status === undefined ? undefined : `status ${result.status}`,
          result.reason,
        ].filter((detail): detail is string => Boolean(detail))
        setDeliveryError({
          requestId: request.requestId,
          message: `Couldn't deliver your response${details.length ? ` (${details.join(': ')})` : ''}. Please try again.`,
        })
      } catch {
        if (activeRequestIdRef.current !== request.requestId) return
        setDeliveryError({
          requestId: request.requestId,
          message: "Couldn't deliver your response. Please try again.",
        })
      } finally {
        if (activeRequestIdRef.current === request.requestId) setIsPending(false)
      }
    },
    [respond],
  )

  // ── Permission ────────────────────────────────────────────
  const handlePermissionRespond = useCallback(
    (requestId: string, allowed: boolean) => {
      void deliver({ variant: 'permission', requestId, allowed })
    },
    [deliver],
  )

  const handlePermissionAlwaysAllow = useCallback(
    (requestId: string, allowed: boolean, updatedPermissions: unknown[]) => {
      void deliver({ variant: 'permission', requestId, allowed, updatedPermissions })
    },
    [deliver],
  )

  // ── Question ──────────────────────────────────────────────
  const handleQuestionAnswer = useCallback(
    (requestId: string, answers: Record<string, string>) => {
      void deliver({ variant: 'question', requestId, answers })
    },
    [deliver],
  )

  // ── Plan ──────────────────────────────────────────────────
  const handlePlanApprove = useCallback(
    (requestId: string, approved: boolean, feedback?: string, bypassPermissions?: boolean) => {
      void deliver({ variant: 'plan', requestId, approved, feedback, bypassPermissions })
    },
    [deliver],
  )

  // ── Elicitation ───────────────────────────────────────────
  const handleElicitationSubmit = useCallback(
    (requestId: string, response: string) => {
      void deliver({ variant: 'elicitation', requestId, response })
    },
    [deliver],
  )

  switch (variant) {
    case 'permission': {
      const permission = normalizePermissionRequest(data)
      if (!permission) return <InteractionError variant="permission" />
      return (
        <PermissionCard
          permission={permission}
          onRespond={respond ? handlePermissionRespond : undefined}
          onAlwaysAllow={
            respond && permission.suggestions?.length ? handlePermissionAlwaysAllow : undefined
          }
          resolved={fullInteraction.resolved ? { allowed: true } : undefined}
          isPending={isPending}
          deliveryError={deliveryError?.requestId === permission.requestId ? deliveryError.message : null}
        />
      )
    }

    case 'question': {
      const question = normalizeAskQuestion(data)
      if (!question) return <InteractionError variant="question" />
      return (
        <AskUserQuestionCard
          question={question}
          onAnswer={respond ? handleQuestionAnswer : undefined}
        />
      )
    }

    case 'plan': {
      const plan = normalizePlanApproval(data)
      if (!plan) return <InteractionError variant="plan" />
      return <PlanApprovalCard plan={plan} onApprove={respond ? handlePlanApprove : undefined} />
    }

    case 'elicitation': {
      const elicitation = normalizeElicitation(data)
      if (!elicitation) return <InteractionError variant="elicitation" />
      return (
        <ElicitationCard
          elicitation={elicitation}
          onSubmit={respond ? handleElicitationSubmit : undefined}
        />
      )
    }

    default:
      return <InteractionError variant={variant} />
  }
}
