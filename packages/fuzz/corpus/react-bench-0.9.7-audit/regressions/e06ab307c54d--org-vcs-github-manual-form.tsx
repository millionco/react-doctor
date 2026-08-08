// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit e06ab307c54dd24001a082b6813e8f3c4817e3e386e87a7c279622600f44557d
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Upload } from "lucide-react"
import { type ChangeEvent, type DragEvent, useRef, useState } from "react"
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

/** Filename extension that identifies an uploadable PEM private key. */
const PEM_FILENAME = /\.pem$/i

/**
 * Read the complete text of a PEM file with a FileReader.
 *
 * The returned promise rejects when reading fails, including the case where
 * `readAsText` throws before any asynchronous callback begins, so callers can
 * treat every read failure uniformly.
 */
function readPemFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      resolve(typeof result === "string" ? result : "")
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read the PEM file."))
    reader.onabort = () => reject(new Error("Failed to read the PEM file."))
    try {
      reader.readAsText(file)
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error("Failed to read the PEM file.")
      )
    }
  })
}

interface GitHubAppManualFormProps {
  onSuccess?: () => void
  existingAppId?: string
  hasStoredCredentials?: boolean
  className?: string
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

  const form = useForm<GitHubAppCredentialsFormData>({
    resolver: zodResolver(gitHubAppCredentialsSchema),
    defaultValues: {
      app_id: existingAppId || "",
      private_key: "",
      webhook_secret: "",
      client_id: "",
    },
  })

  // File-upload state for the private key field.
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Monotonic id that owns the private key field. Every file load and every
  // manual edit bumps this value; asynchronous read completions compare their
  // captured id against the current value and discard themselves when stale.
  const loadIdRef = useRef(0)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

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
      form.setValue("private_key", "")
      if (data.webhook_secret) {
        form.setValue("webhook_secret", "")
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

  /** Clear all loading-status state for the upload target. */
  const clearLoadingStatus = () => {
    setIsLoadingFile(false)
    setLoadingFileName(null)
  }

  /**
   * Load a file selected or dropped into the private key field.
   *
   * The most recent call owns the field: any in-flight read from an earlier
   * call is discarded once it completes, and rejection, read failure, success,
   * or a manual edit each clear the loading status.
   */
  const loadFile = async (file: File | undefined | null) => {
    if (!file) {
      return
    }

    // This action now owns the private key field.
    const currentLoadId = ++loadIdRef.current
    const fileName = file.name

    if (!PEM_FILENAME.test(fileName)) {
      // Rejection is the current action: clear loading, filename, and any
      // previously loaded key so it cannot survive.
      clearLoadingStatus()
      setLoadedFileName(null)
      setUploadError("Please upload a .pem file.")
      form.setValue("private_key", "", { shouldValidate: false })
      return
    }

    // Valid filename: enter loading state and keep the field empty so
    // required-field validation blocks saving while the read is pending.
    setIsLoadingFile(true)
    setLoadingFileName(fileName)
    setLoadedFileName(null)
    setUploadError(null)
    form.setValue("private_key", "", { shouldValidate: false })

    try {
      const text = await readPemFile(file)
      // A newer file, rejection, or manual edit has taken ownership.
      if (loadIdRef.current !== currentLoadId) {
        return
      }
      clearLoadingStatus()
      setLoadedFileName(fileName)
      setUploadError(null)
      form.setValue("private_key", text, { shouldValidate: true })
    } catch {
      // A newer action owns the field; discard the stale failure.
      if (loadIdRef.current !== currentLoadId) {
        return
      }
      clearLoadingStatus()
      setLoadedFileName(null)
      form.setValue("private_key", "", { shouldValidate: false })
      setUploadError("Failed to read the PEM file.")
    }
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset immediately so selecting the same filename again fires another
    // change event and loads its (possibly new) contents.
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    void loadFile(file)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragOver(false)
    void loadFile(event.dataTransfer?.files?.[0])
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy"
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragOver(false)
  }

  const handleManualInput = (
    event: ChangeEvent<HTMLTextAreaElement>,
    next: (value: string) => void
  ) => {
    // Manual typing/pasting takes ownership of the field and discards any
    // stale upload completion or error without overwriting newer state.
    loadIdRef.current++
    clearLoadingStatus()
    setLoadedFileName(null)
    setUploadError(null)
    next(event.target.value)
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
                        onChange={(event) =>
                          handleManualInput(event, field.onChange)
                        }
                        placeholder={"-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"}
                        className="h-32 font-mono text-xs"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Paste the full contents of the PEM file you downloaded
                      from GitHub
                    </p>

                    <div
                      role="group"
                      aria-busy={isLoadingFile}
                      aria-label="PEM private key upload"
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={cn(
                        "flex flex-col gap-2 rounded-md border border-dashed p-3 transition-colors",
                        isDragOver
                          ? "border-foreground bg-muted/60"
                          : "border-muted-foreground/30 bg-muted/40 hover:border-muted-foreground/50"
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="mr-2 size-4" />
                          Upload .pem file
                        </Button>
                        {loadedFileName && !isLoadingFile ? (
                          <p className="text-xs font-medium text-foreground">
                            Loaded: {loadedFileName}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Drop a .pem file here or pick one from your computer
                          </p>
                        )}
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pem"
                        aria-label="Upload PEM private key file"
                        className="sr-only"
                        onChange={handleFileInputChange}
                      />

                      {isLoadingFile && loadingFileName ? (
                        <p
                          role="status"
                          className="text-xs text-muted-foreground"
                        >
                          Reading {loadingFileName}…
                        </p>
                      ) : null}

                      {uploadError ? (
                        <p role="alert" className="text-xs text-destructive">
                          {uploadError}
                        </p>
                      ) : null}
                    </div>

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
