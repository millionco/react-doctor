// rule: no-loading-flag-reset-outside-finally
// file-path: packages/shared/src/components/conversation/blocks/shared/SessionInteractionCard.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit e5619c73acf019b69330abf076dd41acf30cf7a7e6e3b4eff531f51ed2528f31
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

export type InteractResult =
  | { ok: true }
  | { ok: false; status?: number; reason?: string }

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

  // ── Delivery state ────────────────────────────────────────
  // A confirmed delivery (ok: true) must NOT resolve the card locally — only
  // the interaction data marking it resolved does that. A failure (ok: false)
  // keeps the prompt interactive and surfaces a retryable error. The error is
  // keyed by requestId so it never carries over to another request.
  const [deliveryPending, setDeliveryPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<{ status?: number; reason?: string } | null>(
    null,
  )
  const activeRequestIdRef = useRef<string | null | undefined>(fullInteraction.requestId)
  activeRequestIdRef.current = fullInteraction.requestId

  useEffect(() => {
    setDeliveryPending(false)
    setDeliveryError(null)
  }, [fullInteraction.requestId])

  const send = useCallback(
    async (request: InteractRequest) => {
      if (!respond) return { ok: false as const }
      const requestId = request.requestId
      setDeliveryPending(true)
      try {
        const result = await respond(request)
        // Ignore stale completions from a previous request.
        if (activeRequestIdRef.current !== requestId) return result
        if (result.ok) {
          setDeliveryError(null)
        } else {
          setDeliveryError({ status: result.status, reason: result.reason })
        }
        return result
      } catch (e) {
        // A throwing responder is still a delivery failure — surface it so the
        // action can be retried rather than leaking an unhandled rejection.
        const result = { ok: false as const, reason: String(e) }
        if (activeRequestIdRef.current === requestId) {
          setDeliveryError({ reason: result.reason })
        }
        return result
      } finally {
        if (activeRequestIdRef.current === requestId) setDeliveryPending(false)
      }
    },
    [respond],
  )

  const handleResponseDelivered = useCallback(() => {
    setDeliveryError(null)
  }, [])

  // ── Permission ────────────────────────────────────────────
  const handlePermissionRespond = useCallback(
    (requestId: string, allowed: boolean) => send({ variant: 'permission', requestId, allowed }),
    [send],
  )

  const handlePermissionAlwaysAllow = useCallback(
    (requestId: string, allowed: boolean, updatedPermissions: unknown[]) => {
      void send({ variant: 'permission', requestId, allowed, updatedPermissions })
    },
    [send],
  )

  // ── Question ──────────────────────────────────────────────
  const handleQuestionAnswer = useCallback(
    (requestId: string, answers: Record<string, string>) => {
      respond?.({ variant: 'question', requestId, answers })
    },
    [respond],
  )

  // ── Plan ──────────────────────────────────────────────────
  const handlePlanApprove = useCallback(
    (requestId: string, approved: boolean, feedback?: string, bypassPermissions?: boolean) => {
      respond?.({ variant: 'plan', requestId, approved, feedback, bypassPermissions })
    },
    [respond],
  )

  // ── Elicitation ───────────────────────────────────────────
  const handleElicitationSubmit = useCallback(
    (requestId: string, response: string) => {
      respond?.({ variant: 'elicitation', requestId, response })
    },
    [respond],
  )

  switch (variant) {
    case 'permission': {
      const permission = normalizePermissionRequest(data)
      if (!permission) return <InteractionError variant="permission" />
      // Resolved state comes from the interaction data itself — never from a
      // local send succeeding. `allowed` is read from the data when present.
      const resolvedAllowed =
        typeof (data as { allowed?: unknown }).allowed === 'boolean'
          ? (data as { allowed: boolean }).allowed
          : true
      return (
        <PermissionCard
          permission={permission}
          onRespond={respond ? handlePermissionRespond : undefined}
          onAlwaysAllow={
            respond && permission.suggestions?.length ? handlePermissionAlwaysAllow : undefined
          }
          resolved={fullInteraction.resolved ? { allowed: resolvedAllowed } : undefined}
          deliveryPending={deliveryPending}
          deliveryError={deliveryError}
          onResponseDelivered={handleResponseDelivered}
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
