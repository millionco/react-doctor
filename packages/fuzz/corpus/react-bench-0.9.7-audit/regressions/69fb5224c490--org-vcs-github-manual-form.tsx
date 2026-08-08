// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 69fb5224c4907a2f428006365b71ebb91a6d8026bb586f6666ba283a504c1ffa
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
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

  // --- PEM upload state ---
  const fileInputRef = useRef<HTMLInputElement>(null)
  const readVersionRef = useRef(0)
  const [isLoadingPem, setIsLoadingPem] = useState(false)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [pemUploadError, setPemUploadError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handlePemFile = useCallback(
    async (file: File) => {
      const currentVersion = ++readVersionRef.current

      // Reject non-.pem extension
      if (!file.name.toLowerCase().endsWith(".pem")) {
        form.setValue("private_key", "", { shouldValidate: true })
        setLoadedFileName(null)
        setIsLoadingPem(false)
        setLoadingFileName(null)
        setPemUploadError("Please upload a .pem file")
        return
      }

      // Valid file: start loading, keep field empty so required validation blocks submit
      setPemUploadError(null)
      setLoadedFileName(null)
      setIsLoadingPem(true)
      setLoadingFileName(file.name)
      form.setValue("private_key", "", { shouldValidate: false })

      let text: string
      try {
        const maybePromise = file.text()
        text = await maybePromise
      } catch {
        if (readVersionRef.current !== currentVersion) {
          return
        }
        // Synchronous or async read failure - clear busy, filename, value
        setIsLoadingPem(false)
        setLoadingFileName(null)
        setLoadedFileName(null)
        form.setValue("private_key", "", { shouldValidate: false })
        setPemUploadError("Failed to read file")
        return
      }

      if (readVersionRef.current !== currentVersion) {
        return
      }

      form.setValue("private_key", text, { shouldValidate: true })
      setLoadedFileName(file.name)
      setIsLoadingPem(false)
      setLoadingFileName(null)
      setPemUploadError(null)
    },
    [form]
  )

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Allow same filename to be selected again and load its new contents
      e.target.value = ""
      if (file) {
        void handlePemFile(file)
      }
    },
    [handlePemFile]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) {
        void handlePemFile(file)
      }
    },
    [handlePemFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handlePrivateKeyManualChange = useCallback(
    (
      e: React.ChangeEvent<HTMLTextAreaElement>,
      originalOnChange: (...args: unknown[]) => void
    ) => {
      // Newer manual edit discards any stale completion or error
      readVersionRef.current += 1
      setIsLoadingPem(false)
      setLoadingFileName(null)
      // clear loading status per spec; also clear previous upload error / loaded name is optional UX
      // Loading status is cleared, but we keep filename? Clearing it avoids stale UI.
      // We will clear error and keep filename? To be safe, clear loaded name when user overwrites.
      // However spec only requires loading status cleared; clearing filename is reasonable.
      // We'll clear error to not show stale upload error after manual typing.
      setPemUploadError(null)
      // Note: we keep loadedFileName? Let's clear it when user starts typing to avoid confusion.
      // If they typed, the content no longer matches the file, so clear.
      setLoadedFileName(null)
      // @ts-ignore - react-hook-form field onChange signature
      originalOnChange(e)
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
                    <div
                      aria-busy={isLoadingPem ? "true" : "false"}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm transition-colors ${
                        isDragOver
                          ? "border-primary bg-accent/50"
                          : "border-muted-foreground/25"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          ref={fileInputRef}
                          type="file"
                          accept=".pem"
                          className="hidden"
                          onChange={handleFileInputChange}
                          aria-label="Upload PEM file"
                        />
                        <span className="text-xs text-muted-foreground">
                          Drag and drop a .pem file here or
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isLoadingPem}
                        >
                          Browse
                        </Button>
                      </div>
                      {isLoadingPem && loadingFileName ? (
                        <div
                          role="status"
                          className="text-xs text-muted-foreground"
                        >
                          Loading {loadingFileName}...
                        </div>
                      ) : null}
                      {loadedFileName && !isLoadingPem ? (
                        <div className="text-xs text-muted-foreground">
                          Loaded: {loadedFileName}
                        </div>
                      ) : null}
                      {pemUploadError ? (
                        <div className="text-xs text-destructive">
                          {pemUploadError}
                        </div>
                      ) : null}
                    </div>

                    <FormControl>
                      <Textarea
                        {...field}
                        onChange={(e) =>
                          handlePrivateKeyManualChange(e, field.onChange)
                        }
                        placeholder="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"
                        className="h-32 font-mono text-xs"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Paste the full contents of the PEM file you downloaded
                      from GitHub
                    </p>
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
