// rule: no-reset-all-state-on-prop-change
// weakness: cross-file
// source: Synthetic native-frame readiness request; absolute multi-file replay in tests/native-frame-readiness.test.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetSourceUploader as TransferQueue } from "@sanity/types";
import { useChannel as usePeer } from "./channel";
import { Frame } from "./Frame";
interface TransferProps {
  open: boolean;
  endpoint: string;
  queue?: TransferQueue;
}
export function TransferPanel(props: TransferProps) {
  const { open, endpoint, queue } = props;
  const active = useRef(null);
  const [ready, setReady] = useState(false);
  const receive = useCallback(
    (packet) => {
      if (!open) return;
      if (packet.kind === "engine-online" && packet.route === "transfer") {
        setReady(true);
      }
      if (packet.kind === "engine-offline" && packet.route === "transfer") {
        setReady(false);
      }
    },
    [open],
  );
  const { transmit, bindFrame } = usePeer(endpoint, receive);
  useEffect(() => {
    if (open && queue) {
      if (ready) {
        if (
          queue.getFiles().length > 0 &&
          queue.getFiles().every((row) => row.status === "waiting")
        ) {
          transmit({ kind: "begin", files: queue.getFiles() });
          setReady(false);
        }
      }
      const subscribe = () =>
        queue.subscribe((event) => {
          if (event.type === "aborted") transmit({ kind: "abort", id: "current" });
        });
      active.current = { uploader: queue, unsubscribe: subscribe() };
      return active.current.unsubscribe;
    }
    return active.current?.unsubscribe();
  }, [open, ready, transmit, queue, active]);
  if (!open) return null;
  return <Frame ref={bindFrame} src={endpoint} hidden />;
}
