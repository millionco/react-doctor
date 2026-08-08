// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit e2e9586c3d26b3e3ef77c4be23d246068144ab96c25234ea5ccf76a52276c524
import type { InteractRequest, InteractResult } from '../../../../types/interaction'
import type { PermissionRequest } from '../../../../types/sidecar-protocol'
import { ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../../../utils/cn'
import { InteractiveCardShell } from './InteractiveCardShell'

// Re-export the canonical delivery contracts so card consumers can import
// them from the same module as the component.
export type { InteractRequest, InteractResult }

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

/** Failure metadata from the most recent delivery attempt. */
interface DeliveryError {
  status?: number
  reason?: string
}

/**
 * Builds the delivery-failure message. `status`/`reason` are optional — the
 * message must never contain the literal text `undefined`.
 */
function deliveryFailureMessage(error: DeliveryError): string {
  const detail = [
    typeof error.status === 'number' ? `HTTP ${error.status}` : null,
    error.reason ? error.reason : null,
  ]
    .filter(Boolean)
    .join(': ')
  return detail
    ? `We couldn't deliver your response (${detail}) — please try again.`
    : "We couldn't deliver your response — please try again."
}

export interface PermissionCardProps {
  permission: PermissionRequest
  onRespond?: (requestId: string, allowed: boolean) => void
  onAlwaysAllow?: (requestId: string, allowed: boolean, updatedPermissions: unknown[]) => void
  /**
   * Optional async responder. When provided, Allow/Deny deliver
   * `{ variant: 'permission', requestId, allowed }` and the card surfaces
   * delivery failures inline (retry stays possible). A confirmed delivery
   * (`ok: true`) never resolves the card locally — only the interaction
   * data (the `resolved` prop) marks it resolved.
   */
  respond?: (request: InteractRequest) => Promise<InteractResult>
  resolved?: { allowed: boolean }
}

export function PermissionCard({
  permission,
  onRespond,
  onAlwaysAllow,
  respond,
  resolved,
}: PermissionCardProps) {
  const totalSeconds = Math.max(0, Math.ceil(permission.timeoutMs / 1000))
  const [countdown, setCountdown] = useState(totalSeconds)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const requestId = permission.requestId
  const timeoutMs = permission.timeoutMs

  // Interactive whenever a response path exists — either the async `respond`
  // responder or the legacy fire-and-forget `onRespond` callback.
  const interactive = !!respond || !!onRespond

  // ── Delivery state ─────────────────────────────────────────────
  // The error survives pending retries and repeated failures; it clears
  // ONLY after a confirmed (`ok: true`) delivery, and never carries over
  // to another request.
  const [isSending, setIsSending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<DeliveryError | null>(null)

  // Track the currently-displayed request so a late in-flight result from a
  // previous request can never leak its outcome onto the new one.
  const activeRequestRef = useRef(requestId)
  activeRequestRef.current = requestId

  useEffect(() => {
    setDeliveryError(null)
    setIsSending(false)
  }, [requestId])

  // ── Countdown ──────────────────────────────────────────────────
  // The timer is informational only: it ticks down to zero and STOPS. An
  // expired countdown never submits a response — an interactive prompt
  // stays pending (and keeps waiting) for any elapsed time.
  useEffect(() => {
    if (resolved || !interactive) return

    setCountdown(Math.max(0, Math.ceil(timeoutMs / 1000)))

    timerRef.current = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [requestId, timeoutMs, resolved, interactive])

  // ── Delivery ───────────────────────────────────────────────────
  const deliver = useCallback(
    async (request: InteractRequest) => {
      if (!respond) return
      setIsSending(true)
      try {
        const result = await respond(request)
        // Ignore results that arrive after the card moved to another request.
        if (activeRequestRef.current !== request.requestId) return
        if (result.ok) {
          // Confirmed delivery — clear any previous error, but do NOT
          // resolve/disable/hide the prompt locally. The card shows as
          // resolved only when the interaction data marks it resolved.
          setDeliveryError(null)
        } else {
          setDeliveryError({ status: result.status, reason: result.reason })
        }
      } catch (e) {
        if (activeRequestRef.current !== request.requestId) return
        setDeliveryError({ reason: e instanceof Error ? e.message : String(e) })
      } finally {
        if (activeRequestRef.current === request.requestId) {
          setIsSending(false)
        }
      }
    },
    [respond],
  )

  const handleAllow = useCallback(() => {
    if (respond) {
      void deliver({ variant: 'permission', requestId, allowed: true })
    } else {
      onRespond?.(requestId, true)
    }
  }, [respond, deliver, onRespond, requestId])

  const handleDeny = useCallback(() => {
    if (respond) {
      void deliver({ variant: 'permission', requestId, allowed: false })
    } else {
      onRespond?.(requestId, false)
    }
  }, [respond, deliver, onRespond, requestId])

  const handleAlwaysAllow = useCallback(() => {
    if (!permission.suggestions) return
    if (respond) {
      void deliver({
        variant: 'permission',
        requestId,
        allowed: true,
        updatedPermissions: permission.suggestions,
      })
    } else if (onAlwaysAllow) {
      onAlwaysAllow(requestId, true, permission.suggestions)
    }
  }, [respond, deliver, onAlwaysAllow, requestId, permission.suggestions])

  const toolDisplay = getToolDisplay(permission.toolName, permission.toolInput)

  const resolvedState = resolved
    ? resolved.allowed
      ? { label: 'Allowed', variant: 'success' as const }
      : { label: 'Denied', variant: 'denied' as const }
    : undefined

  const hasSuggestions = permission.suggestions && permission.suggestions.length > 0
  const showActions = interactive && !resolved
  const showAlwaysAllow = hasSuggestions && (!!respond || !!onAlwaysAllow)

  return (
    <InteractiveCardShell
      variant="permission"
      header="Permission Required"
      icon={<ShieldAlert className="w-4 h-4" />}
      resolved={resolvedState}
      actions={
        showActions ? (
          <>
            <button
              type="button"
              onClick={handleDeny}
              className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            >
              Deny
            </button>
            {showAlwaysAllow && (
              <button
                type="button"
                onClick={handleAlwaysAllow}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              >
                Always Allow
              </button>
            )}
            <button
              type="button"
              onClick={handleAllow}
              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors"
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

        {!resolved && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-1000 ease-linear',
                  countdown < 10 ? 'bg-red-500 animate-pulse' : 'bg-amber-500',
                )}
                style={{ width: `${totalSeconds > 0 ? (countdown / totalSeconds) * 100 : 0}%` }}
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
        )}

        {/* An interactive prompt stays pending for any elapsed time — the
            countdown expiring never answers it. */}
        {showActions && (
          <p role="status" className="text-xs text-gray-500 dark:text-gray-400">
            waiting for your response{isSending ? ' — delivering…' : ''}
          </p>
        )}

        {/* Delivery failure — survives pending retries and repeated failed
            attempts; clears only after a confirmed (`ok: true`) delivery. */}
        {deliveryError && !resolved && (
          <div role="alert" className="text-xs text-red-600 dark:text-red-400">
            {deliveryFailureMessage(deliveryError)}
          </div>
        )}
      </div>
    </InteractiveCardShell>
  )
}
