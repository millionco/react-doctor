// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit f896607abada053679119004e6d38261ced2d6dadee0b5e94f56145193c25ac2
import { useCallback, useState, useRef, useEffect } from 'react'
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
  const { variant, data, requestId } = fullInteraction
  const [deliveryPending, setDeliveryPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<{ status?: number; reason?: string } | undefined>(undefined)
  const errorRef = useRef<typeof deliveryError>(undefined)
  errorRef.current = deliveryError
  const requestIdRef = useRef(requestId)
  requestIdRef.current = requestId

  useEffect(() => {
    setDeliveryPending(false)
    setDeliveryError(undefined)
  }, [fullInteraction.id])

  const clearError = useCallback(() => {
    setDeliveryError(undefined)
  }, [])

  // ── Permission ────────────────────────────────────────────
  const handlePermissionRespond = useCallback(
    async (reqId: string, allowed: boolean) => {
      if (!respond) return
      setDeliveryPending(true)
      try {
        const result = await respond({ variant: 'permission', requestId: reqId, allowed })
        if (requestIdRef.current === reqId) {
          if (result.ok) {
            clearError()
          } else {
            setDeliveryError({ status: result.status, reason: result.reason })
          }
        }
      } finally {
        if (requestIdRef.current === reqId) setDeliveryPending(false)
      }
    },
    [respond, clearError],
  )

  const handlePermissionAlwaysAllow = useCallback(
    async (reqId: string, allowed: boolean, updatedPermissions: unknown[]) => {
      if (!respond) return
      setDeliveryPending(true)
      try {
        const result = await respond({ variant: 'permission', requestId: reqId, allowed, updatedPermissions })
        if (requestIdRef.current === reqId) {
          if (result.ok) clearError()
          else setDeliveryError({ status: result.status, reason: result.reason })
        }
      } finally {
        if (requestIdRef.current === reqId) setDeliveryPending(false)
      }
    },
    [respond, clearError],
  )

  // ── Question ──────────────────────────────────────────────
  const handleQuestionAnswer = useCallback(
    async (reqId: string, answers: Record<string, string>) => {
      if (!respond) return
      setDeliveryPending(true)
      try {
        const result = await respond({ variant: 'question', requestId: reqId, answers })
        if (requestIdRef.current === reqId) {
          if (result.ok) clearError()
          else setDeliveryError({ status: result.status, reason: result.reason })
        }
      } finally {
        if (requestIdRef.current === reqId) setDeliveryPending(false)
      }
    },
    [respond, clearError],
  )

  // ── Plan ──────────────────────────────────────────────────
  const handlePlanApprove = useCallback(
    async (reqId: string, approved: boolean, feedback?: string, bypassPermissions?: boolean) => {
      if (!respond) return
      setDeliveryPending(true)
      try {
        const result = await respond({ variant: 'plan', requestId: reqId, approved, feedback, bypassPermissions })
        if (requestIdRef.current === reqId) {
          if (result.ok) clearError()
          else setDeliveryError({ status: result.status, reason: result.reason })
        }
      } finally {
        if (requestIdRef.current === reqId) setDeliveryPending(false)
      }
    },
    [respond, clearError],
  )

  // ── Elicitation ───────────────────────────────────────────
  const handleElicitationSubmit = useCallback(
    async (reqId: string, response: string) => {
      if (!respond) return
      setDeliveryPending(true)
      try {
        const result = await respond({ variant: 'elicitation', requestId: reqId, response })
        if (requestIdRef.current === reqId) {
          if (result.ok) clearError()
          else setDeliveryError({ status: result.status, reason: result.reason })
        }
      } finally {
        if (requestIdRef.current === reqId) setDeliveryPending(false)
      }
    },
    [respond, clearError],
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
