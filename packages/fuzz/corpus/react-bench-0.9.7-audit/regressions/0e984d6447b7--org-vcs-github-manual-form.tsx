// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 0e984d6447b722b93c4635ce37b4afcb9c9c8e2cc5db113203cd1c8d1fa08835
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import type { ChangeEvent, DragEvent } from "react"
import { useRef, useState } from "react"
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

const INVALID_PEM_FILE_MESSAGE = "Please upload a .pem file."
const PEM_READ_ERROR_MESSAGE = "Unable to read the PEM file. Please try again."

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }

      reject(new Error("The PEM file could not be read as text."))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error("The PEM file could not be read."))
    }
    reader.onabort = () => {
      reject(new Error("The PEM file read was cancelled."))
    }

    try {
      reader.readAsText(file)
    } catch (error) {
      reject(error)
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
  const [isPrivateKeyLoading, setIsPrivateKeyLoading] = useState(false)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [privateKeyUploadError, setPrivateKeyUploadError] = useState<
    string | null
  >(null)
  const privateKeyFileInputRef = useRef<HTMLInputElement>(null)
  const privateKeyReadIdRef = useRef(0)

  const form = useForm<GitHubAppCredentialsFormData>({
    resolver: zodResolver(gitHubAppCredentialsSchema),
    defaultValues: {
      app_id: existingAppId || "",
      private_key: "",
      webhook_secret: "",
      client_id: "",
    },
  })

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

  const clearPrivateKeyUploadState = () => {
    setIsPrivateKeyLoading(false)
    setLoadingFileName(null)
    setUploadedFileName(null)
    setPrivateKeyUploadError(null)
  }

  const handlePrivateKeyManualChange = (
    event: ChangeEvent<HTMLTextAreaElement>,
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  ) => {
    privateKeyReadIdRef.current += 1
    clearPrivateKeyUploadState()
    onChange(event)
  }

  const loadPrivateKeyFile = async (file: File | undefined) => {
    const readId = ++privateKeyReadIdRef.current

    if (!file || !file.name.toLowerCase().endsWith(".pem")) {
      form.setValue("private_key", "", {
        shouldDirty: true,
        shouldValidate: true,
      })
      setIsPrivateKeyLoading(false)
      setLoadingFileName(null)
      setUploadedFileName(null)
      setPrivateKeyUploadError(INVALID_PEM_FILE_MESSAGE)
      return
    }

    form.setValue("private_key", "", {
      shouldDirty: true,
      shouldValidate: true,
    })
    setIsPrivateKeyLoading(true)
    setLoadingFileName(file.name)
    setUploadedFileName(null)
    setPrivateKeyUploadError(null)

    try {
      const privateKey = await readFileAsText(file)

      if (privateKeyReadIdRef.current !== readId) {
        return
      }

      form.setValue("private_key", privateKey, {
        shouldDirty: true,
        shouldValidate: true,
      })
      setIsPrivateKeyLoading(false)
      setLoadingFileName(null)
      setUploadedFileName(file.name)
    } catch {
      if (privateKeyReadIdRef.current !== readId) {
        return
      }

      form.setValue("private_key", "", {
        shouldDirty: true,
        shouldValidate: true,
      })
      setIsPrivateKeyLoading(false)
      setLoadingFileName(null)
      setUploadedFileName(null)
      setPrivateKeyUploadError(PEM_READ_ERROR_MESSAGE)
    }
  }

  const handlePrivateKeyFileChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    // Resetting permits selecting a file with the same name again.
    event.target.value = ""
    void loadPrivateKeyFile(file)
  }

  const handlePrivateKeyFileDrop = (
    event: DragEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    void loadPrivateKeyFile(event.dataTransfer.files[0])
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
                          handlePrivateKeyManualChange(event, field.onChange)
                        }
                        placeholder="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"
                        className="h-32 font-mono text-xs"
                      />
                    </FormControl>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={privateKeyFileInputRef}
                        type="file"
                        accept=".pem"
                        aria-label="Choose PEM file"
                        className="sr-only"
                        onChange={handlePrivateKeyFileChange}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        aria-busy={isPrivateKeyLoading}
                        aria-describedby="private-key-upload-status"
                        onClick={() => privateKeyFileInputRef.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handlePrivateKeyFileDrop}
                      >
                        Upload PEM file
                      </Button>
                      {uploadedFileName && (
                        <span className="text-xs text-muted-foreground">
                          Loaded: {uploadedFileName}
                        </span>
                      )}
                    </div>
                    <p
                      id="private-key-upload-status"
                      role="status"
                      aria-live="polite"
                      className="sr-only"
                    >
                      {isPrivateKeyLoading && loadingFileName
                        ? `Reading ${loadingFileName}`
                        : ""}
                    </p>
                    {privateKeyUploadError && (
                      <p className="text-sm font-medium text-destructive" role="alert">
                        {privateKeyUploadError}
                      </p>
                    )}
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
