// rule: no-loading-flag-reset-outside-finally
// file-path: packages/shared/src/components/conversation/blocks/shared/SessionInteractionCard.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 8aed267fc9f74cb07c432311ec98d1fbec9e978fac45af289f10a6c785daf3a8
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

export type InteractResult = { ok: true } | { ok: false; status?: number; reason?: string }

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

  const [deliveryPending, setDeliveryPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<string>()
  const interactionKey = `${variant}:${fullInteraction.requestId ?? ''}`
  const interactionKeyRef = useRef(interactionKey)
  interactionKeyRef.current = interactionKey

  useEffect(() => {
    setDeliveryPending(false)
    setDeliveryError(undefined)
  }, [interactionKey])

  const deliver = useCallback(async (request: InteractRequest) => {
    if (!respond) return
    const requestKey = interactionKeyRef.current
    setDeliveryPending(true)
    try {
      const result = await respond(request)
      if (interactionKeyRef.current !== requestKey) return
      if (result.ok) {
        setDeliveryError(undefined)
      } else {
        const details = [
          result.status !== undefined ? `status ${result.status}` : undefined,
          result.reason,
        ].filter((value): value is string => Boolean(value))
        setDeliveryError(
          `We couldn't deliver your response${details.length ? `: ${details.join(' — ')}` : '.'}`,
        )
      }
    } catch (error) {
      if (interactionKeyRef.current !== requestKey) return
      const reason = error instanceof Error ? error.message : String(error)
      setDeliveryError(`We couldn't deliver your response${reason ? `: ${reason}` : '.'}`)
    } finally {
      if (interactionKeyRef.current === requestKey) setDeliveryPending(false)
    }
  }, [respond])

  // ── Permission ────────────────────────────────────────────
  const handlePermissionRespond = useCallback(
    (requestId: string, allowed: boolean) => {
      return deliver({ variant: 'permission', requestId, allowed })
    },
    [deliver],
  )

  const handlePermissionAlwaysAllow = useCallback(
    (requestId: string, allowed: boolean, updatedPermissions: unknown[]) => {
      return deliver({ variant: 'permission', requestId, allowed, updatedPermissions })
    },
    [deliver],
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
      return (
        <PermissionCard
          permission={permission}
          onRespond={respond ? handlePermissionRespond : undefined}
          onAlwaysAllow={
            respond && permission.suggestions?.length ? handlePermissionAlwaysAllow : undefined
          }
          resolved={
            fullInteraction.resolved
              ? { allowed: (data as { allowed?: boolean }).allowed === true }
              : undefined
          }
          isPending={deliveryPending}
          deliveryError={deliveryError}
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
