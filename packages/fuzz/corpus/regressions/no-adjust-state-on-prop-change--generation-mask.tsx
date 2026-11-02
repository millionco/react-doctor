import { useCallback, useEffect, useRef, useState } from "react";
interface Props {
  recordId: string;
  onLoad?: () => void | Promise<void>;
  hasRows: boolean;
  status?: "running" | "failed";
}
export const Panel = ({ recordId, onLoad, hasRows, status }: Props) => {
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const tag = useRef(-1);
  const previousRecord = useRef(recordId);
  const previousLoad = useRef(onLoad);
  const previousRows = useRef(hasRows);
  const previousStatus = useRef(status);
  {
    let invalid = false;
    if (previousRecord.current !== recordId) {
      invalid = true;
      previousRecord.current = recordId;
    }
    if (previousLoad.current !== onLoad) {
      invalid = true;
      previousLoad.current = onLoad;
    }
    if (previousRows.current !== hasRows) {
      invalid = true;
      previousRows.current = hasRows;
    }
    if (previousStatus.current !== status) {
      invalid = true;
      previousStatus.current = status;
    }
    if (invalid) {
      epoch.current += 1;
    }
  }
  const visible = busy && tag.current === epoch.current;
  useEffect(() => {
    setBusy(false);
  }, [recordId, onLoad, hasRows, status]);
  const begin = useCallback(() => {
    if (!onLoad) return;
    const captured = epoch.current;
    const result = onLoad();
    if (result && typeof result.then === "function") {
      setBusy(true);
      tag.current = captured;
      result.then(
        () => setBusy(false),
        () => setBusy(false),
      );
    }
  }, [onLoad]);
  return <button onClick={begin}>{visible ? "busy" : "idle"}</button>;
};
