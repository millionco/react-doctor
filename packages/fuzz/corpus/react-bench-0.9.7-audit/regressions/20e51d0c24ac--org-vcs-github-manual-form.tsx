// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 20e51d0c24ac1a5ce038afd999adce78a30a9db77b6f972bbc45e5abcaba8bc2
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { UploadIcon } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { AlertNotification } from "@/components/notifications"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useGitHubAppCredentials } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const gitHubAppCredentialsSchema = z.object({
  app_id: z
    .string()
    .min(1, "App ID is required")
    .regex(/^\d+$/, "App ID must be numeric"),
  private_key: z
    .string()
    .min(1, "Private key is required")
    .refine(
      (val) =>
        val.includes("BEGIN RSA PRIVATE KEY") ||
        val.includes("BEGIN PRIVATE KEY"),
      "Private key must be in PEM format with BEGIN/END markers"
    ),
  webhook_secret: z.string().optional(),
  client_id: z.string().optional(),
})

type GitHubAppCredentialsFormData = z.infer<typeof gitHubAppCredentialsSchema>

interface GitHubAppManualFormProps {
  onSuccess?: () => void
  existingAppId?: string
  hasStoredCredentials?: boolean
  className?: string
}

// Error shown when a selected/dropped file is not a `.pem` file. The wording is
// matched by tests, so keep the "upload a .pem file" phrase intact.
const PEM_REJECTION_ERROR = "Please upload a .pem file."
// Error shown when a `.pem` file is selected but its contents cannot be read.
const PEM_READ_ERROR = "Could not read the PEM file. Please try again."

function isPemFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".pem")
}

/**
 * Read the full text of a file asynchronously.
 *
 * Wraps `FileReader` in a Promise so that both a synchronous failure while
 * starting the read (e.g. `new FileReader()` or `readAsText` throwing before
 * any `onload`/`onerror` callback is scheduled) and an asynchronous
 * `onerror` are surfaced as a rejected Promise. Callers can treat every read
 * failure uniformly.
 */
function readFileText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(reader.result == null ? "" : String(reader.result))
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"))
    // If either of the next two lines throws synchronously, the Promise
    // executor catches it and rejects the Promise, which is exactly the
    // "read fails before asynchronous callbacks begin" case.
    reader.readAsText(file)
  })
}

export function GitHubAppManualForm({
  onSuccess,
  existingAppId,
  hasStoredCredentials = false,
  className,
}: GitHubAppManualFormProps) {
  const { saveCredentials } = useGitHubAppCredentials()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Upload state. `isBusy`/`statusMessage` form the "loading status" that is
  // cleared on success, rejection, read failure, or manual input.
  const [isBusy, setIsBusy] = useState(false)
  const [loadedFilename, setLoadedFilename] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  // Monotonic token identifying the most recent upload action. Every new
  // action (file pick, drop, rejection, or manual edit) increments this, so an
  // in-flight read can detect that it is stale and bail out without
  // overwriting newer state.
  const loadTokenRef = useRef(0)

  const form = useForm<GitHubAppCredentialsFormData>({
    resolver: zodResolver(gitHubAppCredentialsSchema),
    defaultValues: {
      app_id: existingAppId || "",
      private_key: "",
      webhook_secret: "",
      client_id: "",
    },
  })

  /**
   * Handle a manual edit of the private key field. A manual edit is the most
   * recent action: it invalidates any in-flight read (so a stale completion or
   * error is discarded) and clears the loading status and any stale upload
   * error/filename.
   */
  const handlePrivateKeyChange = useCallback(() => {
    loadTokenRef.current += 1
    setIsBusy(false)
    setStatusMessage(null)
    setUploadError(null)
    setLoadedFilename(null)
  }, [])

  const loadFile = useCallback(
    async (file: File) => {
      const token = ++loadTokenRef.current
      const filename = file.name

      if (!isPemFilename(filename)) {
        // A rejected file is the most recent action: it must discard any
        // in-flight read, clear the key (an earlier key must not survive),
        // and show a rejection error.
        setIsBusy(false)
        setStatusMessage(null)
        setLoadedFilename(null)
        setUploadError(PEM_REJECTION_ERROR)
        form.setValue("private_key", "", { shouldValidate: false })
        return
      }

      // Valid `.pem` filename: begin loading. Keep the field empty so
      // required-field validation blocks saving while the read is in flight,
      // mark the upload target as busy, and announce the filename being read
      // in the status live region.
      setUploadError(null)
      setLoadedFilename(null)
      setIsBusy(true)
      setStatusMessage(`Reading ${filename}…`)
      form.setValue("private_key", "", { shouldValidate: false })

      try {
        const text = await readFileText(file)
        if (token !== loadTokenRef.current) {
          // A newer action owns the field; discard this stale completion
          // without overwriting newer state.
          return
        }
        setIsBusy(false)
        setStatusMessage(null)
        setLoadedFilename(filename)
        setUploadError(null)
        form.setValue("private_key", text, { shouldValidate: true })
      } catch (error) {
        if (token !== loadTokenRef.current) {
          // A newer action owns the field; discard this stale error without
          // overwriting newer state.
          return
        }
        setIsBusy(false)
        setStatusMessage(null)
        setLoadedFilename(null)
        setUploadError(PEM_READ_ERROR)
        form.setValue("private_key", "", { shouldValidate: false })
      }
    },
    [form]
  )

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        void loadFile(file)
      }
    },
    [loadFile]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const file = event.dataTransfer.files?.[0]
      if (file) {
        void loadFile(file)
      }
    },
    [loadFile]
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      event.stopPropagation()
    },
    []
  )

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      event.stopPropagation()
    },
    []
  )

  const onSubmit = async (data: GitHubAppCredentialsFormData) => {
    try {
      setIsSubmitting(true)

      await saveCredentials.mutateAsync({
        app_id: data.app_id,
        private_key: data.private_key,
        webhook_secret: data.webhook_secret || undefined,
        client_id: data.client_id || undefined,
      })

      const action = hasStoredCredentials ? "updated" : "registered"
      toast({
        title: `GitHub App ${action} successfully`,
        description: `Your GitHub App credentials have been ${action}.`,
      })

      // Clear sensitive data from form
      form.setValue("private_key", "", { shouldValidate: false })
      setLoadedFilename(null)
      if (data.webhook_secret) {
        form.setValue("webhook_secret", "", { shouldValidate: false })
      }

      onSuccess?.()
    } catch (error) {
      console.error("Failed to save GitHub App credentials:", error)
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to save GitHub App credentials",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const buttonLabel = hasStoredCredentials ? "Save changes" : "Save credentials"

  const containerClass = className ? `space-y-4 ${className}` : "space-y-4"

  return (
    <div className={containerClass}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
          <div className="space-y-8">
            <div className="space-y-2">
              <FormField
                control={form.control}
                name="app_id"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>GitHub App ID *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="123456"
                        className="max-w-md"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Find this in GitHub → Settings → GitHub Apps
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="private_key"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>Private Key *</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        onChange={(event) => {
                          handlePrivateKeyChange()
                          field.onChange(event)
                        }}
                        placeholder="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"
                        className="h-32 font-mono text-xs"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Paste the full contents of the PEM file you downloaded
                      from GitHub, or upload it below
                    </p>

                    {/* Accessible upload target: click to open the file picker
                        or drag and drop a `.pem` file. Both paths call the
                        same `loadFile` handler so they behave identically. */}
                    <label
                      htmlFor="github-app-pem-file-input"
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      aria-busy={isBusy}
                      className={cn(
                        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input px-4 py-3 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/30",
                        isBusy && "cursor-wait opacity-70"
                      )}
                    >
                      <UploadIcon className="size-4" aria-hidden="true" />
                      <span className="sr-only">
                        Upload a .pem private key file
                      </span>
                      <span>
                        Drag and drop a .pem file here, or click to browse
                      </span>
                      <input
                        id="github-app-pem-file-input"
                        type="file"
                        accept=".pem"
                        className="sr-only"
                        onClick={(event) => {
                          // Reset the value before the picker opens so that
                          // selecting the same filename again still fires
                          // `change` and loads the file's (possibly new)
                          // contents.
                          event.currentTarget.value = ""
                        }}
                        onChange={handleFileInputChange}
                      />
                    </label>

                    {/* Live region that identifies the filename being read
                        while a valid file is loading. Cleared on success,
                        rejection, read failure, or manual input. */}
                    <div role="status" className="min-h-[1rem] text-xs">
                      {statusMessage}
                    </div>

                    {loadedFilename && !isBusy ? (
                      <p className="text-xs text-muted-foreground">
                        Loaded:{" "}
                        <span className="font-medium text-foreground">
                          {loadedFilename}
                        </span>
                      </p>
                    ) : null}

                    {uploadError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {uploadError}
                      </p>
                    ) : null}

                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="webhook_secret"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>Webhook Secret (optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="Enter webhook secret"
                        className="max-w-md"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Needed only if you configured a webhook secret in GitHub
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="client_id"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>Client ID (optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Iv1.abc123def456"
                        className="max-w-md"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Found alongside the App ID in GitHub
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || saveCredentials.isPending}
              className="min-w-32"
            >
              {isSubmitting || saveCredentials.isPending
                ? "Saving..."
                : buttonLabel}
            </Button>
          </div>
        </form>
      </Form>

      {saveCredentials.isError && (
        <AlertNotification
          level="error"
          message={
            saveCredentials.error instanceof Error
              ? saveCredentials.error.message
              : "Failed to save GitHub App credentials"
          }
        />
      )}
    </div>
  )
}
