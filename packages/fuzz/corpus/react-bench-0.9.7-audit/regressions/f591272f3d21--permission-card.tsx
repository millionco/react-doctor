// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit f591272f3d21770b0cda7b8325d0c9399daea057d3663b8413c322e5262f5c11
import type { PermissionRequest } from '../../../../types/sidecar-protocol'
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
  onRespond?: (requestId: string, allowed: boolean) => Promise<InteractResult> | void
  onAlwaysAllow?: (
    requestId: string,
    allowed: boolean,
    updatedPermissions: unknown[],
  ) => Promise<InteractResult> | void
  resolved?: { allowed: boolean }
}

type InteractResult =
  | { ok: true }
  | { ok: false; status?: number; reason?: string }

export function PermissionCard({
  permission,
  onRespond,
  onAlwaysAllow,
  resolved,
}: PermissionCardProps) {
  const totalSeconds = Math.ceil(permission.timeoutMs / 1000)
  const [countdown, setCountdown] = useState(totalSeconds)
  const [deliveryPending, setDeliveryPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onRespondRef = useRef(onRespond)
  onRespondRef.current = onRespond
  const requestIdRef = useRef(permission.requestId)
  requestIdRef.current = permission.requestId
  const toolNameRef = useRef(permission.toolName)
  toolNameRef.current = permission.toolName

  const requestId = permission.requestId
  const timeoutMs = permission.timeoutMs

  useEffect(() => {
    if (resolved) return

    const secs = Math.ceil(timeoutMs / 1000)
    setCountdown(secs)

    timerRef.current = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [requestId, timeoutMs, resolved])

  useEffect(() => {
    setDeliveryError(null)
    setDeliveryPending(false)
  }, [requestId])

  useEffect(() => {
    if (countdown === 0 && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [countdown])

  const deliver = useCallback(
    async (action: () => Promise<InteractResult> | void) => {
      const attemptRequestId = requestId
      setDeliveryPending(true)
      try {
        const result = await action()
        if (requestIdRef.current !== attemptRequestId) return
        if (result?.ok !== true) {
          const failure = result?.ok === false ? result : undefined
          const details = [
            typeof failure?.status === 'number' ? `status ${failure.status}` : null,
            typeof failure?.reason === 'string' ? failure.reason : null,
          ].filter(Boolean)
          setDeliveryError(
            `Couldn\'t deliver your response${details.length ? ` (${details.join(': ')})` : ''}. Please try again.`,
          )
        } else {
          setDeliveryError(null)
        }
      } catch (error) {
        if (requestIdRef.current !== attemptRequestId) return
        setDeliveryError(
          `Couldn\'t deliver your response${error instanceof Error && error.message ? ` (${error.message})` : ''}. Please try again.`,
        )
      } finally {
        if (requestIdRef.current === attemptRequestId) setDeliveryPending(false)
      }
    },
    [requestId],
  )

  const handleAllow = useCallback(() => {
    return deliver(() => onRespondRef.current?.(requestId, true))
  }, [deliver, requestId])

  const handleDeny = useCallback(() => {
    return deliver(() => onRespondRef.current?.(requestId, false))
  }, [deliver, requestId])

  const handleAlwaysAllow = useCallback(() => {
    if (permission.suggestions && onAlwaysAllow) {
      return deliver(() => onAlwaysAllow(requestId, true, permission.suggestions!))
    }
  }, [deliver, onAlwaysAllow, requestId, permission.suggestions])

  const toolDisplay = getToolDisplay(permission.toolName, permission.toolInput)

  const resolvedState = resolved
    ? resolved.allowed
      ? { label: 'Allowed', variant: 'success' as const }
      : { label: 'Denied', variant: 'denied' as const }
    : undefined

  const hasSuggestions = permission.suggestions && permission.suggestions.length > 0

  return (
    <InteractiveCardShell
      variant="permission"
      header="Permission Required"
      icon={<ShieldAlert className="w-4 h-4" />}
      resolved={resolvedState}
      actions={
        onRespond ? (
          <>
            <button
              type="button"
              onClick={handleDeny}
              disabled={deliveryPending}
              className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            >
              Deny
            </button>
            {hasSuggestions && onAlwaysAllow && (
              <button
                type="button"
                onClick={handleAlwaysAllow}
                disabled={deliveryPending}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              >
                Always Allow
              </button>
            )}
            <button
              type="button"
              onClick={handleAllow}
              disabled={deliveryPending}
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
          <>
            {onRespond && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Waiting for your response
              </p>
            )}
            {deliveryError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {deliveryError}
              </p>
            )}
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
          </>
        )}
      </div>
    </InteractiveCardShell>
  )
}
