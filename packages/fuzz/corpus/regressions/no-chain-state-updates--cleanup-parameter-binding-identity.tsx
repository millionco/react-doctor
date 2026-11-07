// rule: no-chain-state-updates
// weakness: alias-guard
// related-weaknesses: default-parameter, name-heuristic
// source: PR #2308 independent adversarial review
// verdict: pass
import { useEffect, useState, useRef } from "react";

const CleanupMutableLambda = () => {
  const editorRef = useRef(null);
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (editor) return;
    setEditor(createEditor(editorRef.current));
    let cleanup = () => {};
    cleanup = () => {
      cancelled = true;
    };
    return cleanup;
  }, [editor]);
  return <div ref={editorRef} />;
};

const CleanupMutableSubscribe = () => {
  const editorRef = useRef(null);
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (editor) return;
    setEditor(createEditor(editorRef.current));
    let cleanup = () => {};
    cleanup = subscribe();
    return cleanup;
  }, [editor]);
  return <div ref={editorRef} />;
};

const CleanupDefaultParameter = () => {
  const editorRef = useRef(null);
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (editor) return;
    setEditor(createEditor(editorRef.current));
    return (value = unsubscribe()) => {};
  }, [editor]);
  return <div ref={editorRef} />;
};

const CleanupDestructuringDefault = () => {
  const editorRef = useRef(null);
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (editor) return;
    setEditor(createEditor(editorRef.current));
    return ({ value = unsubscribe() } = {}) => {};
  }, [editor]);
  return <div ref={editorRef} />;
};

const CleanupNamedNoopTernary = () => {
  const editorRef = useRef(null);
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (editor) return;
    setEditor(createEditor(editorRef.current));
    const noop = () => {};
    return isEnabled ? subscribe() : noop;
  }, [editor]);
  return <div ref={editorRef} />;
};

const CleanupFakeUsecallbackFactory = () => {
  const editorRef = useRef(null);
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (editor) return;
    setEditor(createEditor(editorRef.current));
    const api = {
      useCallback: (_callback) => () => {
        cancelled = true;
      },
    };
    const cleanup = api.useCallback(() => {});
    return cleanup;
  }, [editor]);
  return <div ref={editorRef} />;
};
