// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 43daf7e2f154fd3aae4b3034edfbb219c0d4d1d752561a351d1ec0738cd1ea90
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { type ChangeEvent, useRef, useState } from "react"
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
  const [isPrivateKeyLoading, setIsPrivateKeyLoading] = useState(false)
  const [privateKeyFilename, setPrivateKeyFilename] = useState<string | null>(
    null
  )
  const [privateKeyStatus, setPrivateKeyStatus] = useState<string | null>(null)
  const [privateKeyUploadError, setPrivateKeyUploadError] = useState<
    string | null
  >(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const privateKeyActionRef = useRef(0)

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

  const handlePrivateKeyFile = async (file: File | undefined) => {
    const action = ++privateKeyActionRef.current
    form.setValue("private_key", "", {
      shouldDirty: true,
      shouldValidate: true,
    })
    setPrivateKeyFilename(null)
    setPrivateKeyStatus(null)
    setPrivateKeyUploadError(null)
    setIsPrivateKeyLoading(false)

    if (!file || !/\.pem$/i.test(file.name)) {
      setPrivateKeyUploadError("Please upload a .pem file.")
      return
    }

    setIsPrivateKeyLoading(true)
    setPrivateKeyStatus(`Reading ${file.name}`)

    try {
      const contents = await file.text()
      if (action !== privateKeyActionRef.current) {
        return
      }
      form.setValue("private_key", contents, {
        shouldDirty: true,
        shouldValidate: true,
      })
      setPrivateKeyFilename(file.name)
      setPrivateKeyStatus(null)
      setIsPrivateKeyLoading(false)
    } catch {
      if (action !== privateKeyActionRef.current) {
        return
      }
      form.setValue("private_key", "", {
        shouldDirty: true,
        shouldValidate: true,
      })
      setPrivateKeyFilename(null)
      setPrivateKeyStatus(null)
      setIsPrivateKeyLoading(false)
      setPrivateKeyUploadError("Unable to read the .pem file.")
    }
  }

  const handlePrivateKeyInput = (
    fieldOnChange: (value: string) => void,
    event: ChangeEvent<HTMLTextAreaElement>
  ) => {
    ++privateKeyActionRef.current
    setIsPrivateKeyLoading(false)
    setPrivateKeyFilename(null)
    setPrivateKeyStatus(null)
    setPrivateKeyUploadError(null)
    fieldOnChange(event.target.value)
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
                          handlePrivateKeyInput(field.onChange, event)
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
                    <div className="flex flex-col items-start gap-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pem"
                        className="sr-only"
                        aria-label="Upload private key PEM file"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ""
                          void handlePrivateKeyFile(file)
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        aria-busy={isPrivateKeyLoading}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          void handlePrivateKeyFile(
                            event.dataTransfer.files?.[0]
                          )
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            fileInputRef.current?.click()
                          }
                        }}
                      >
                        Upload PEM file
                      </Button>
                      {privateKeyFilename && !isPrivateKeyLoading && (
                        <span className="text-xs text-muted-foreground">
                          Loaded {privateKeyFilename}
                        </span>
                      )}
                      {privateKeyStatus && (
                        <span role="status" className="text-xs">
                          {privateKeyStatus}
                        </span>
                      )}
                      {privateKeyUploadError && (
                        <span role="alert" className="text-xs text-destructive">
                          {privateKeyUploadError}
                        </span>
                      )}
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
