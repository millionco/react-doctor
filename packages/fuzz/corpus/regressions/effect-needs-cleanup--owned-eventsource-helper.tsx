import { useCallback, useEffect, useRef } from "react";

export function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {
  const channel = useRef<EventSource | null>(null);
  const openChannel = useCallback(() => {
    if (!enabled) return;
    const source = new EventSource(endpoint);
    channel.current = source;
    source.addEventListener("done", () => {
      source.close();
    });
    source.onopen = () => {};
    source.onerror = () => {
      source.close();
    };
  }, [endpoint, enabled]);
  useEffect(() => {
    openChannel();
    return () => {
      channel.current?.close();
    };
  }, [openChannel]);
  return null;
}
