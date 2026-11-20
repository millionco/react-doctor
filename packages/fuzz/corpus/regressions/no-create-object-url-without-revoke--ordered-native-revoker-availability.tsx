// rule: no-create-object-url-without-revoke
// verdict: safe
import { useCallback, useEffect, useRef, useState } from "react";

export function AttachmentPreview({ blob }: { blob: Blob | null }) {
  const currentUrl = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const display = useCallback((next: string) => {
    if (
      currentUrl.current &&
      currentUrl.current !== next &&
      typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(currentUrl.current);
    }
    currentUrl.current = next;
    setPreviewUrl(next);
  }, []);

  useEffect(() => {
    return () => {
      if (currentUrl.current && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const next = blob && URL.createObjectURL(blob);
    if (next) display(next);
  }, [blob, display]);

  return <img src={previewUrl ?? undefined} alt="Attachment preview" />;
}
