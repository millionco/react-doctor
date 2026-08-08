// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 2da6b12dbf0c306566dbcaa4e5f97833a2a7d9e4b79ad0f4c1b7c2396c475393
import type { PermissionRequest } from '../../../../types/sidecar-protocol'
import type { InteractRequest, InteractResult } from '../../../../hooks/useInteractionResponder'
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

export interface PermissionCardProps {
  permission: PermissionRequest
  /**
   * Optional async responder. When provided, Allow/Deny/Always-Allow are
   * delivered through this callback and the card tracks delivery state
   * (pending, failure, retry). When absent the card is read-only.
   */
  respond?: (request: InteractRequest) => Promise<InteractResult>
  /** Legacy synchronous Allow/Deny callback (fire-and-forget). */
  onRespond?: (requestId: string, allowed: boolean) => void
  /** Legacy synchronous Always-Allow callback (fire-and-forget). */
  onAlwaysAllow?: (requestId: string, allowed: boolean, updatedPermissions: unknown[]) => void
  /**
   * Resolved state. `true` renders a neutral "Resolved" badge (used when only
   * the interaction data marks resolution). `{ allowed: boolean }` renders an
   * "Allowed"/"Denied" badge. `undefined`/`false` leaves the card interactive.
   */
  resolved?: boolean | { allowed: boolean }
}

interface DeliveryError {
  status?: number
  reason?: string
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const requestId = permission.requestId
  const timeoutMs = permission.timeoutMs
  const isInteractive = !!respond || !!onRespond

  // ── Delivery state (only meaningful when `respond` is supplied) ──
  const [isPending, setIsPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<DeliveryError | null>(null)

  // Guards against stale async results after the request id changes and
  // against concurrent deliveries (double-click before re-render).
  const inFlightRef = useRef<string | null>(null)
  const deliveringRef = useRef(false)

  // Reset delivery state whenever the request id changes — a delivery error
  // must never carry over to another request.
  useEffect(() => {
    setDeliveryError(null)
    setIsPending(false)
    deliveringRef.current = false
    inFlightRef.current = null
    setCountdown(Math.ceil(timeoutMs / 1000))
  }, [requestId, timeoutMs])

  // Countdown timer — only for interactive, unresolved prompts. Never
  // auto-denies; when it reaches zero the card shows "waiting for your
  // response" and remains pending for any elapsed time.
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

  // Async delivery through `respond`. The previous error survives the new
  // pending state and repeated failures; it is cleared only on `ok: true`.
  const deliver = useCallback(
    async (request: InteractRequest) => {
      if (!respond || deliveringRef.current) return
      deliveringRef.current = true
      inFlightRef.current = request.requestId
      setIsPending(true)
      try {
        const result = await respond(request)
        // Ignore the result if the request id changed while in flight.
        if (inFlightRef.current !== request.requestId) return
        if (result.ok) {
          // Confirmed delivery: clear any prior error but do NOT resolve,
          // disable, or hide the prompt locally — the card only shows
          // resolved when the interaction data itself marks it resolved.
          setDeliveryError(null)
        } else {
          setDeliveryError({
            status: result.status,
            reason: result.reason,
          })
        }
      } catch (e) {
        if (inFlightRef.current !== request.requestId) return
        setDeliveryError({ reason: String(e) })
      } finally {
        if (inFlightRef.current === request.requestId) {
          deliveringRef.current = false
          inFlightRef.current = null
          setIsPending(false)
        }
      }
    },
    [respond],
  )

  // The countdown is a purely visual indicator — it never triggers an
  // auto-deny. It keeps ticking through delivery attempts so that an expired
  // prompt surfaces "waiting for your response" regardless of pending state.
  const handleAllow = useCallback(() => {
    if (respond) {
      void deliver({ variant: 'permission', requestId, allowed: true })
    } else {
      onRespond?.(requestId, true)
    }
  }, [respond, onRespond, requestId, deliver])

  const handleDeny = useCallback(() => {
    if (respond) {
      void deliver({ variant: 'permission', requestId, allowed: false })
    } else {
      onRespond?.(requestId, false)
    }
  }, [respond, onRespond, requestId, deliver])

  const handleAlwaysAllow = useCallback(() => {
    const updatedPermissions = permission.suggestions ?? []
    if (respond) {
      void deliver({
        variant: 'permission',
        requestId,
        allowed: true,
        updatedPermissions,
      })
    } else {
      onAlwaysAllow?.(requestId, true, updatedPermissions)
    }
  }, [respond, onAlwaysAllow, requestId, permission.suggestions, deliver])

  const toolDisplay = getToolDisplay(permission.toolName, permission.toolInput)

  const resolvedState = (() => {
    if (resolved === true) return { label: 'Resolved', variant: 'neutral' as const }
    if (resolved && typeof resolved === 'object') {
      return resolved.allowed
        ? { label: 'Allowed', variant: 'success' as const }
        : { label: 'Denied', variant: 'denied' as const }
    }
    return undefined
  })()

  const isResolved = !!resolvedState
  const hasSuggestions = permission.suggestions && permission.suggestions.length > 0
  const expired = isInteractive && !isResolved && countdown === 0

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
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              Deny
            </button>
            {hasSuggestions && (onAlwaysAllow || respond) && (
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

        {/* Delivery failure — persists across pending/retries, clears on ok: true */}
        {deliveryError && (
          <div
            role="alert"
            className="rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 text-xs text-red-700 dark:text-red-400"
          >
            <span>Couldn&apos;t deliver your response</span>
            {deliveryError.reason ? <span>. {deliveryError.reason}</span> : null}
            {deliveryError.status != null ? (
              <span> (status {deliveryError.status})</span>
            ) : null}
            <span className="block mt-0.5 text-red-600/80 dark:text-red-400/80">
              You can retry the action.
            </span>
          </div>
        )}

        {/* Countdown / waiting status — interactive prompts only */}
        {isInteractive && !isResolved && !expired && (
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

        {expired && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span>Timed out — waiting for your response.</span>
          </div>
        )}
      </div>
    </InteractiveCardShell>
  )
}
