// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: ReactBench fix-react-rdh-appflowy-io-appflowy-web-documenthistorymodal
import { useEffect, useRef, useState } from "react";

export const Preview = ({ loadPreview, selectedVersionId, viewId }) => {
  const [, setActiveDoc] = useState(null);
  const activeViewIdRef = useRef(viewId);
  const selectedVersionIdRef = useRef(selectedVersionId);

  useEffect(() => {
    let cancelled = false;
    const requestViewId = viewId;
    const previewVersionId = selectedVersionId;
    const isCurrentRequest = () =>
      !cancelled &&
      activeViewIdRef.current === requestViewId &&
      selectedVersionIdRef.current === previewVersionId;

    void (async () => {
      const document = await loadPreview(requestViewId, previewVersionId);
      if (!isCurrentRequest()) {
        document?.destroy();
        return;
      }
      setActiveDoc(document);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPreview, selectedVersionId, viewId]);

  return null;
};
