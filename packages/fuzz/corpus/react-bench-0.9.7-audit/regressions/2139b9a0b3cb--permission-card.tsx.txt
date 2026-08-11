// rule: no-loading-flag-reset-outside-finally
// file-path: packages/shared/src/components/conversation/blocks/shared/PermissionCard.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 2139b9a0b3cb92f362d1a8faf079b762a01c048d5f553591f6c08743bbd1a6b4
import type { PermissionRequest } from '../../../../types/sidecar-protocol'
import { ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InteractResult } from '../../../../types/interaction-response'
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
  onRespond?: (requestId: string, allowed: boolean) => void | Promise<InteractResult>
  onAlwaysAllow?: (
    requestId: string,
    allowed: boolean,
    updatedPermissions: unknown[],
  ) => void | Promise<InteractResult>
  resolved?: { allowed: boolean }
}

export function PermissionCard({
  permission,
  onRespond,
  onAlwaysAllow,
  resolved,
}: PermissionCardProps) {
  const requestId = permission.requestId
  const currentRequestIdRef = useRef(requestId)
  const [deliveryPending, setDeliveryPending] = useState(false)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)

  useEffect(() => {
    currentRequestIdRef.current = requestId
    setDeliveryPending(false)
    setDeliveryError(null)
  }, [requestId])

  const deliver = useCallback(
    async (send: () => void | Promise<InteractResult>) => {
      const attemptedRequestId = requestId
      let delivery: void | Promise<InteractResult>

      try {
        delivery = send()
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        setDeliveryError(`Couldn't deliver your response${reason ? `: ${reason}` : '.'}`)
        return
      }

      // Legacy conversation callbacks return void. Only promise-returning
      // responders expose a delivery acknowledgement to track.
      if (delivery === undefined) return
      setDeliveryPending(true)

      try {
        const result = await delivery
        if (currentRequestIdRef.current !== attemptedRequestId) return

        if (result.ok) {
          setDeliveryError(null)
        } else {
          const details = [
            result.status !== undefined ? `status ${result.status}` : null,
            result.reason || null,
          ].filter((detail): detail is string => detail !== null)
          setDeliveryError(
            `Couldn't deliver your response${details.length ? `: ${details.join(' — ')}` : '.'}`,
          )
        }
      } catch (error) {
        if (currentRequestIdRef.current === attemptedRequestId) {
          const reason = error instanceof Error ? error.message : String(error)
          setDeliveryError(`Couldn't deliver your response${reason ? `: ${reason}` : '.'}`)
        }
      } finally {
        if (currentRequestIdRef.current === attemptedRequestId) setDeliveryPending(false)
      }
    },
    [requestId],
  )

  const handleAllow = useCallback(() => {
    if (onRespond) void deliver(() => onRespond(requestId, true))
  }, [deliver, onRespond, requestId])

  const handleDeny = useCallback(() => {
    if (onRespond) void deliver(() => onRespond(requestId, false))
  }, [deliver, onRespond, requestId])

  const handleAlwaysAllow = useCallback(() => {
    if (permission.suggestions && onAlwaysAllow) {
      void deliver(() => onAlwaysAllow(requestId, true, permission.suggestions ?? []))
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

        {!resolved && onRespond && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {deliveryPending ? 'Sending response; ' : ''}waiting for your response
          </p>
        )}

        {deliveryError && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-400">
            {deliveryError}
          </p>
        )}
      </div>
    </InteractiveCardShell>
  )
}
