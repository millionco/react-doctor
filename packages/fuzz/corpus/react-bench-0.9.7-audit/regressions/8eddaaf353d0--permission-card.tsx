// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 8eddaaf353d0025c9f79ce5bc1aaabee640efe4770ad14ec3db9dca7214531c3
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
 * Builds the delivery-failure message. `status` and `reason` are optional on
 * `InteractResult` failures — never render the literal text `undefined`.
 */
function buildDeliveryMessage(result: { ok: false; status?: number; reason?: string }): string {
  let msg = "Couldn't deliver your response"
  if (typeof result.status === 'number') msg += ` (status ${result.status})`
  if (typeof result.reason === 'string' && result.reason.length > 0) msg += `: ${result.reason}`
  return msg
}

export interface PermissionCardProps {
  permission: PermissionRequest
  /**
   * Promise-based responder (live interactive flow). When provided, the card
   * tracks delivery end-to-end: it never auto-denies on countdown expiry,
   * shows a "waiting for your response" status, and surfaces retryable
   * delivery failures. A confirmed delivery (`ok: true`) does NOT resolve,
   * disable, or hide the prompt locally — the card only becomes resolved when
   * the `resolved` prop (sourced from the interaction data) is set.
   */
  respond?: (request: InteractRequest) => Promise<InteractResult>
  /**
   * Legacy fire-and-forget handler (transcript/Chat/Developer flow). The parent
   * owns the resolved state and re-renders with `resolved` once it knows the
   * outcome. Mutually exclusive with `respond`; `respond` takes precedence.
   */
  onRespond?: (requestId: string, allowed: boolean) => void
  onAlwaysAllow?: (requestId: string, allowed: boolean, updatedPermissions: unknown[]) => void
  /**
   * Resolved state sourced from the interaction data. `true` (no decision
   * recorded) renders a neutral "Resolved" badge; `{ allowed: true | false }`
   * renders "Allowed" / "Denied". When absent the prompt stays interactive.
   */
  resolved?: boolean | { allowed: boolean }
}

export function PermissionCard({
  permission,
  respond,
  onRespond,
  onAlwaysAllow,
  resolved,
}: PermissionCardProps) {
  const totalSeconds = Math.ceil(permission.timeoutMs / 1000)
  const [countdown, setCountdown] = useState(totalSeconds)
  const [pending, setPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Tracks the currently-rendered requestId so an in-flight delivery whose
  // request has since been replaced can be discarded (never carry an error or
  // pending state over to another request).
  const requestIdRef = useRef(permission.requestId)
  requestIdRef.current = permission.requestId

  const requestId = permission.requestId
  const timeoutMs = permission.timeoutMs

  // `respond` is the authoritative responder when present; otherwise fall back
  // to the legacy fire-and-forget `onRespond`.
  const hasRespond = !!respond
  const hasLegacy = !respond && !!onRespond
  const isInteractive = hasRespond || hasLegacy

  // Countdown is purely visual — it never auto-denies. An interactive prompt
  // remains pending for any elapsed time and surfaces a "waiting for your
  // response" status once the timer lapses.
  useEffect(() => {
    if (resolved || !isInteractive) return

    const secs = Math.ceil(timeoutMs / 1000)
    setCountdown(secs)

    timerRef.current = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [requestId, timeoutMs, resolved, isInteractive])

  // A delivery error must never carry over to another request. Reset
  // pending/error state whenever the requestId changes.
  useEffect(() => {
    setPending(false)
    setDeliveryError(null)
  }, [requestId])

  // Drive the delivery round-trip. The error survives pending and repeated
  // failed attempts — it is cleared ONLY on a confirmed delivery (`ok: true`).
  const sendRequest = useCallback(
    async (request: InteractRequest) => {
      if (!respond) return
      const targetRequestId = request.requestId
      setPending(true)
      try {
        const result = await respond(request)
        // If the user has moved on to a different request, discard the result
        // so a failure (or success) never carries over to the new prompt.
        if (requestIdRef.current !== targetRequestId) return
        if (result.ok) {
          // Confirmed delivery: clear any prior error. Do NOT resolve, disable,
          // or hide the prompt locally — resolution comes from the interaction
          // data (`resolved` prop), so the actions stay available.
          setDeliveryError(null)
        } else {
          setDeliveryError(buildDeliveryMessage(result))
        }
      } finally {
        if (requestIdRef.current === targetRequestId) setPending(false)
      }
    },
    [respond],
  )

  const handleAllow = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (respond) {
      void sendRequest({ variant: 'permission', requestId, allowed: true })
    } else {
      onRespond?.(requestId, true)
    }
  }, [respond, onRespond, requestId, sendRequest])

  const handleDeny = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (respond) {
      void sendRequest({ variant: 'permission', requestId, allowed: false })
    } else {
      onRespond?.(requestId, false)
    }
  }, [respond, onRespond, requestId, sendRequest])

  const handleAlwaysAllow = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (respond) {
      void sendRequest({
        variant: 'permission',
        requestId,
        allowed: true,
        updatedPermissions: permission.suggestions,
      })
    } else if (permission.suggestions && onAlwaysAllow) {
      onAlwaysAllow(requestId, true, permission.suggestions)
    }
  }, [respond, onAlwaysAllow, requestId, permission.suggestions])

  const toolDisplay = getToolDisplay(permission.toolName, permission.toolInput)

  const resolvedState = !resolved
    ? undefined
    : resolved === true
      ? { label: 'Resolved', variant: 'neutral' as const }
      : resolved.allowed
        ? { label: 'Allowed', variant: 'success' as const }
        : { label: 'Denied', variant: 'denied' as const }

  const isResolved = !!resolved
  const hasSuggestions = permission.suggestions && permission.suggestions.length > 0

  // Disable the action buttons while a delivery is in flight so the same
  // response isn't sent twice; they remain visible (never hidden) so the user
  // can retry after a failure.
  const actionsDisabled = hasRespond && pending

  return (
    <InteractiveCardShell
      variant="permission"
      header="Permission Required"
      icon={<ShieldAlert className="w-4 h-4" />}
      resolved={resolvedState}
      actions={
        isInteractive && !isResolved ? (
          <>
            <button
              type="button"
              onClick={handleDeny}
              disabled={actionsDisabled}
              className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              Deny
            </button>
            {hasSuggestions && (onAlwaysAllow || respond) && (
              <button
                type="button"
                onClick={handleAlwaysAllow}
                disabled={actionsDisabled}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                Always Allow
              </button>
            )}
            <button
              type="button"
              onClick={handleAllow}
              disabled={actionsDisabled}
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

        {/* Countdown — visual only, never auto-denies */}
        {isInteractive && !isResolved && (
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
        )}

        {/* Standing status for interactive prompts — remains pending for any
            elapsed time instead of auto-denying on timeout. */}
        {isInteractive && !isResolved && (
          <p
            className="text-xs text-gray-500 dark:text-gray-400"
            data-testid="permission-waiting-status"
          >
            waiting for your response{pending ? ' · delivering…' : ''}
          </p>
        )}

        {/* Delivery failure — retryable; survives pending and repeated failed
            attempts, cleared only after a confirmed delivery. */}
        {deliveryError && (
          <div
            role="alert"
            data-testid="permission-delivery-error"
            className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-md px-2 py-1.5"
          >
            {deliveryError}
          </div>
        )}
      </div>
    </InteractiveCardShell>
  )
}
