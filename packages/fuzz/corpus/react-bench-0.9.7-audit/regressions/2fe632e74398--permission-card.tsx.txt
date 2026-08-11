// rule: no-loading-flag-reset-outside-finally
// file-path: packages/shared/src/components/conversation/blocks/shared/PermissionCard.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 2fe632e743980f7873a0f4f5860a1aaeaf56cc81fd3fff826c1239d6c9835edb
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
   * Optional async responder (live / monitor flow). When provided the card is
   * interactive and owns delivery: it tracks pending/error state, never
   * auto-denies on countdown expiry, and does NOT resolve locally on a
   * successful send — the `resolved` prop (interaction data) is the only
   * thing that resolves it, so actions stay available until the data marks
   * the interaction resolved.
   *
   * Allow sends `{ variant: 'permission', requestId, allowed: true }`; Deny
   * sends the same payload with `allowed: false`.
   */
  respond?: (request: InteractRequest) => Promise<InteractResult>
  /**
   * Legacy sync handler (chat flow). When provided the card is interactive;
   * the parent owns optimistic resolution via the `resolved` prop.
   */
  onRespond?: (requestId: string, allowed: boolean) => void
  onAlwaysAllow?: (requestId: string, allowed: boolean, updatedPermissions: unknown[]) => void
  resolved?: { allowed: boolean }
}

export function PermissionCard({
  permission,
  respond,
  onRespond,
  onAlwaysAllow,
  resolved,
}: PermissionCardProps) {
  const totalSeconds = Math.ceil(permission.timeoutMs / 1000)
  const requestId = permission.requestId
  const timeoutMs = permission.timeoutMs

  const interactive = Boolean(respond || onRespond)

  const [countdown, setCountdown] = useState(totalSeconds)
  const [expired, setExpired] = useState(false)
  const [pending, setPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<{
    status?: number
    reason?: string
  } | null>(null)

  // Stable refs so the timer / async delivery don't capture stale props.
  const respondRef = useRef(respond)
  respondRef.current = respond
  const onRespondRef = useRef(onRespond)
  onRespondRef.current = onRespond
  const onAlwaysAllowRef = useRef(onAlwaysAllow)
  onAlwaysAllowRef.current = onAlwaysAllow
  const requestIdRef = useRef(requestId)
  requestIdRef.current = requestId

  // Delivery state never carries over to another request: a new requestId
  // clears pending + any outstanding error.
  useEffect(() => {
    setPending(false)
    setDeliveryError(null)
  }, [requestId])

  // Countdown timer — only for interactive, unresolved prompts. When it
  // elapses we surface a "waiting for your response" status and STAY pending;
  // we never submit an automatic Deny.
  useEffect(() => {
    if (!interactive || resolved) return
    setCountdown(Math.ceil(timeoutMs / 1000))
    setExpired(false)
    const id = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [interactive, resolved, requestId, timeoutMs])

  useEffect(() => {
    if (countdown === 0 && interactive && !resolved && !expired) {
      setExpired(true)
    }
  }, [countdown, interactive, resolved, expired])

  /**
   * Deliver a permission response via the async responder. A prior delivery
   * error is intentionally preserved across pending + repeated failed
   * attempts (it is NOT cleared here); it clears only on `ok: true`.
   */
  const send = useCallback(
    async (allowed: boolean, updatedPermissions?: unknown[]) => {
      const responder = respondRef.current
      if (!responder) return
      const sentRequestId = requestId
      setPending(true)
      try {
        const result = await responder({
          variant: 'permission',
          requestId: sentRequestId,
          allowed,
          updatedPermissions,
        })
        // Ignore stale results from a previous request id.
        if (requestIdRef.current !== sentRequestId) return
        if (result.ok) {
          setDeliveryError(null)
        } else {
          setDeliveryError({
            status: result.status,
            reason: result.reason,
          })
        }
      } catch (e) {
        if (requestIdRef.current !== sentRequestId) return
        setDeliveryError({ reason: String(e) })
      } finally {
        if (requestIdRef.current === sentRequestId) {
          setPending(false)
        }
      }
    },
    [requestId],
  )

  const handleAllow = useCallback(() => {
    if (respond) {
      void send(true)
    } else {
      onRespondRef.current?.(requestId, true)
    }
  }, [respond, requestId, send])

  const handleDeny = useCallback(() => {
    if (respond) {
      void send(false)
    } else {
      onRespondRef.current?.(requestId, false)
    }
  }, [respond, requestId, send])

  const handleAlwaysAllow = useCallback(() => {
    const suggestions = permission.suggestions
    if (respond) {
      void send(true, suggestions)
    } else if (suggestions) {
      onAlwaysAllowRef.current?.(requestId, true, suggestions)
    }
  }, [respond, requestId, permission.suggestions, send])

  const toolDisplay = getToolDisplay(permission.toolName, permission.toolInput)

  const resolvedState = resolved
    ? resolved.allowed
      ? { label: 'Allowed', variant: 'success' as const }
      : { label: 'Denied', variant: 'denied' as const }
    : undefined

  const hasSuggestions = permission.suggestions && permission.suggestions.length > 0
  const showAlwaysAllow = hasSuggestions && (Boolean(respond) || Boolean(onAlwaysAllow))
  const showActions = interactive && !resolved
  // Actions stay visible while delivery is pending or has failed (so a failure
  // can be retried). They are only disabled mid-delivery to prevent concurrent
  // duplicate sends; a confirmed delivery (ok: true) re-enables them.
  const actionsDisabled = pending

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
              disabled={actionsDisabled}
              className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              Deny
            </button>
            {showAlwaysAllow && (
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

        {/* Countdown / waiting status — only for interactive, unresolved prompts. */}
        {interactive && !resolved && !expired && (
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

        {interactive && !resolved && (
          <p
            role="status"
            className="text-xs font-medium text-amber-700 dark:text-amber-300"
          >
            waiting for your response
          </p>
        )}

        {/* Delivery failure (async responder only). The error survives pending
            and repeated failed attempts and clears only on ok: true. */}
        {deliveryError && (
          <p
            role="alert"
            className="text-xs font-medium text-red-700 dark:text-red-300"
          >
            {"couldn't deliver your response"}
            {typeof deliveryError.status === 'number' && (
              <span className="font-mono"> (status {deliveryError.status})</span>
            )}
            {deliveryError.reason ? (
              <span className="font-normal">: {deliveryError.reason}</span>
            ) : null}
          </p>
        )}

        {pending && (
          <p className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            Sending&hellip;
          </p>
        )}
      </div>
    </InteractiveCardShell>
  )
}
