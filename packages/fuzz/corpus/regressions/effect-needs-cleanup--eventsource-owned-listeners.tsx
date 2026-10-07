// verdict: pass
// rule: effect-needs-cleanup
// weakness: copy-tracking
// source: GACWR/OpenUBA app/jobs/[id]/page.tsx:146 at 57e8a7fcadc5f851fd8e9a8647f5fbf34e9975f6
import { useEffect, useRef } from "react";

interface JobEventsProps {
  jobId: string;
}

export const JobEvents = ({ jobId }: JobEventsProps) => {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    eventSourceRef.current = source;
    source.addEventListener("progress", () => {});
    source.addEventListener("complete", () => {});
    source.addEventListener("error", () => {});

    return () => source.close();
  }, [jobId]);

  return null;
};
