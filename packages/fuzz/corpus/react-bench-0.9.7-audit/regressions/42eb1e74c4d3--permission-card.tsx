// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 42eb1e74c4d341e0423b9e4fa7192c3554a4abee66d4b86d5fdab87633a96f93
import type { PermissionRequest } from '../../../../types/sidecar-protocol'
import type {
  InteractRequest,
  InteractResult,
} from '../../../../hooks/useInteractionResponder'
import { ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../../../utils/cn'
import { InteractiveCardShell } from './InteractiveCardShell'

function getToolDisplay(
  toolName: string,
  toolInput: Record<string, unknown>,
): { label: string; content: string } {
  switch (toolName) {
    case 'Bash':
      return { label: 'Command', content: String(toolInput.command ?? '') }
    case 'Edit':
    case 'Write':
      return {
        label: `File: ${String(toolInput.file_path ?? toolInput.filePath ?? 'unknown')}`,
        content: toolInput.new_string
          ? `Replace:\n${String(toolInput.old_string ?? '')}\n\nWith:\n${String(toolInput.new_string)}`
          : String(toolInput.content ?? JSON.stringify(toolInput, null, 2)),
      }
    case 'Read':
      return { label: 'File', content: String(toolInput.file_path ?? toolInput.filePath ?? '') }
    default:
      return { label: toolName, content: JSON.stringify(toolInput, null, 2) }
  }
}

/**
 * Delivery state for an async `respond` flow.
 *
 * - `isPending` — a request is in flight. The prompt and actions stay
 *   visible (disabled) so the user sees their decision is being delivered.
 * - `deliveryError` — the last delivery failed. It survives pending and
 *   repeated failed attempts, clearing ONLY after `ok: true`. It never
 *   carries over to another `requestId`.
 */
interface DeliveryError {
  status?: number
  reason?: string
}

export interface PermissionCardProps {
  permission: PermissionRequest
  /**
   * Optional async responder. When present the prompt is interactive:
   * Allow/Deny send `{ variant: 'permission', requestId, allowed }` and the
   * card tracks delivery (pending / error / confirmed). A confirmed delivery
   * (`ok: true`) does NOT resolve, disable, or hide the prompt locally — the
   * card only shows as resolved when the interaction data itself marks it
   * resolved (via the `resolved` prop). When absent, the prompt is read-only
   * and noninteractive.
   */
  respond?: (request: InteractRequest) => Promise<InteractResult>
  /** Resolved state, driven by the interaction data (never by a local click). */
  resolved?: { allowed: boolean }
}

export function PermissionCard({ permission, respond, resolved }: PermissionCardProps) {
  const totalSeconds = Math.ceil(permission.timeoutMs / 1000)
  const [countdown, setCountdown] = useState(totalSeconds)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const requestId = permission.requestId
  const timeoutMs = permission.timeoutMs

  const interactive = Boolean(respond)

  // ── Delivery state (async flow only) ───────────────────────────────
  const [isPending, setIsPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<DeliveryError | null>(null)

  // Stable refs so the send callback can stay keyed on requestId only.
  const respondRef = useRef(respond)
  respondRef.current = respond
  // Track the current requestId so a stale delivery (from a previous
  // request) can't write state after the user has moved on to a new one.
  const requestIdRef = useRef(requestId)
  requestIdRef.current = requestId

  // A delivery error must never carry over to another request.
  useEffect(() => {
    setIsPending(false)
    setDeliveryError(null)
  }, [requestId])

  // ── Countdown ──────────────────────────────────────────────────────
  // Interactive prompts count down but NEVER auto-deny: when the time
  // elapses the prompt remains pending and shows "waiting for your
  // response". Read-only prompts are noninteractive (no countdown).
  useEffect(() => {
    if (resolved || !interactive) return

    const secs = Math.ceil(timeoutMs / 1000)
    setCountdown(secs)

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [requestId, timeoutMs, resolved, interactive])

  const send = useCallback(
    async (allowed: boolean, updatedPermissions?: unknown[]): Promise<void> => {
      const responder = respondRef.current
      if (!responder) return

      const request: InteractRequest = {
        variant: 'permission',
        requestId,
        allowed,
        ...(updatedPermissions ? { updatedPermissions } : {}),
      }

      // Mark pending WITHOUT clearing the error — a delivery error must
      // survive pending and repeated failed attempts, clearing only on
      // `ok: true`.
      setIsPending(true)
      try {
        const result = await responder(request)
        // Ignore results that arrive after the user has moved to a different
        // request — a delivery error must never carry over to another request.
        if (requestIdRef.current !== requestId) return
        if (result.ok) {
          setDeliveryError(null)
        } else {
          setDeliveryError({
            status: result.status,
            reason: result.reason,
          })
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setIsPending(false)
        }
      }
    },
    [requestId],
  )

  const handleAllow = useCallback(() => {
    void send(true)
  }, [send])

  const handleDeny = useCallback(() => {
    void send(false)
  }, [send])

  const handleAlwaysAllow = useCallback(() => {
    if (permission.suggestions) {
      void send(true, permission.suggestions)
    }
  }, [send, permission.suggestions])

  const toolDisplay = getToolDisplay(permission.toolName, permission.toolInput)

  const resolvedState = resolved
    ? resolved.allowed
      ? { label: 'Allowed', variant: 'success' as const }
      : { label: 'Denied', variant: 'denied' as const }
    : undefined

  const hasSuggestions = permission.suggestions && permission.suggestions.length > 0
  const elapsed = countdown <= 0

  // Build the delivery-error alert text without ever rendering "undefined".
  const errorStatusText =
    typeof deliveryError?.status === 'number' ? ` (status ${deliveryError.status})` : ''
  const errorReasonText =
    typeof deliveryError?.reason === 'string' && deliveryError.reason.length > 0
      ? ` — ${deliveryError.reason}`
      : ''

  return (
    <InteractiveCardShell
      variant="permission"
      header="Permission Required"
      icon={<ShieldAlert className="w-4 h-4" />}
      resolved={resolvedState}
      actions={
        interactive ? (
          <>
            <button
              type="button"
              onClick={handleDeny}
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              Deny
            </button>
            {hasSuggestions && (
              <button
                type="button"
                onClick={handleAlwaysAllow}
                disabled={isPending}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                Always Allow
              </button>
            )}
            <button
              type="button"
              onClick={handleAllow}
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              Allow
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-mono font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded">
            {permission.toolName}
          </span>
        </div>

        {permission.decisionReason && (
          <p className="text-xs text-gray-700 dark:text-gray-300">{permission.decisionReason}</p>
        )}

        <div className="rounded border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          {toolDisplay.label && (
            <div className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/30">
              {toolDisplay.label}
            </div>
          )}
          <pre className="px-2 py-1.5 text-xs text-gray-800 dark:text-gray-200 overflow-x-auto max-h-32 whitespace-pre-wrap font-mono">
            {toolDisplay.content}
          </pre>
        </div>

        <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
          ID: {permission.toolUseID}
        </span>

        {permission.blockedPath && (
          <div className="text-xs text-red-600 dark:text-red-400">
            Blocked: {permission.blockedPath}
          </div>
        )}

        {permission.agentID && (
          <div className="text-xs text-indigo-600 dark:text-indigo-400">
            Agent: {permission.agentID}
          </div>
        )}

        {/* Delivery failure — rendered as an alert so assistive tech
            announces it. Persists across retries until `ok: true`. */}
        {deliveryError && (
          <div
            role="alert"
            className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded px-2 py-1"
          >
            couldn&apos;t deliver your response{errorStatusText}{errorReasonText}. Try again.
          </div>
        )}

        {/* Pending indicator — actions stay visible (disabled) above. */}
        {isPending && (
          <div className="text-xs text-gray-500 dark:text-gray-400">Delivering…</div>
        )}

        {/* Countdown / waiting status — interactive prompts only. */}
        {interactive && !resolved && (
          elapsed ? (
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
              waiting for your response
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-1000 ease-linear',
                    countdown < 10 ? 'bg-red-500 animate-pulse' : 'bg-amber-500',
                  )}
                  style={{ width: `${(countdown / totalSeconds) * 100}%` }}
                />
              </div>
              <span
                className={cn(
                  'text-xs font-mono tabular-nums w-6 text-right',
                  countdown < 10
                    ? 'text-red-500 dark:text-red-400 font-bold'
                    : 'text-gray-500 dark:text-gray-400',
                )}
              >
                {countdown}s
              </span>
            </div>
          )
        )}
      </div>
    </InteractiveCardShell>
  )
}
