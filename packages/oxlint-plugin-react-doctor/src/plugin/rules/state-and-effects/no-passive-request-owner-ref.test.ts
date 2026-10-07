import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassiveRequestOwnerRef } from "./no-passive-request-owner-ref.js";

describe("no-passive-request-owner-ref", () => {
  it("reports a post-await commit guarded by an owner ref synchronized in useEffect", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `import { useCallback, useEffect, useRef, useState } from "react";
const History = ({ viewId, open }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refreshHistory = useCallback(async () => {
    const versions = await loadVersions(viewId);
    if (activeViewIdRef.current !== viewId || !open) return;
    setVersions(versions);
  }, [open, viewId]);
  return <button onClick={refreshHistory}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports aliased passive effects and reversed owner comparisons", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `import { useEffect as useAfterPaint, useRef, useReducer } from "react";
const History = ({ documentId }) => {
  const documentIdRef = useRef(documentId);
  const [, dispatch] = useReducer(reducer, null);
  useAfterPaint(() => {
    documentIdRef.current = documentId;
  }, [documentId]);
  const refresh = async () => {
    const result = await load(documentId);
    if (documentId != documentIdRef.current) return;
    dispatch({ type: "loaded", result });
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps render-time owner synchronization outside this rule", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  activeViewIdRef.current = viewId;
  const [, setVersions] = useState([]);
  const refresh = async () => {
    const versions = await load(viewId);
    if (activeViewIdRef.current !== viewId) return;
    setVersions(versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a layout-effect owner synchronization", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useLayoutEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    const versions = await load(viewId);
    if (activeViewIdRef.current !== viewId) return;
    setVersions(versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores an effect that does not depend on the owner", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, []);
  const refresh = async () => {
    const versions = await load(viewId);
    if (activeViewIdRef.current !== viewId) return;
    setVersions(versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a guard checked only before suspension", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    if (activeViewIdRef.current !== viewId) return;
    const versions = await load(viewId);
    setVersions(versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores passive synchronization without a post-await state commit", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    const versions = await load(viewId);
    if (activeViewIdRef.current !== viewId) return;
    cache.set(viewId, versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a request generation ref unrelated to the passively synchronized owner", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  const requestIdRef = useRef(0);
  const [, setVersions] = useState([]);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    const requestId = ++requestIdRef.current;
    const versions = await load(viewId);
    if (requestId !== requestIdRef.current) return;
    setVersions(versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores an owner guard and setter on exclusive branches", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId, shouldLoad }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    if (shouldLoad) {
      await load(viewId);
      if (activeViewIdRef.current !== viewId) return;
    } else {
      setVersions([]);
    }
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores an owner guard and setter under contradictory sequential guards", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId, shouldLoad }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    if (shouldLoad) {
      await load(viewId);
      if (activeViewIdRef.current !== viewId) return;
    }
    if (!shouldLoad) {
      setVersions([]);
    }
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a state update inside the owner-mismatch bailout", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setWasSuperseded] = useState(false);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    await load(viewId);
    if (activeViewIdRef.current !== viewId) {
      setWasSuperseded(true);
      return;
    }
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a state commit in the owner-match else branch", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ viewId }) => {
  const activeViewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    const versions = await load(viewId);
    if (activeViewIdRef.current !== viewId) {
      return;
    } else {
      setVersions(versions);
    }
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a later passive owner synchronization in the same effect", () => {
    const result = runRule(
      noPassiveRequestOwnerRef,
      `const History = ({ documentId, viewId }) => {
  const documentIdRef = useRef(documentId);
  const viewIdRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    documentIdRef.current = documentId;
    viewIdRef.current = viewId;
  }, [documentId, viewId]);
  const refresh = async () => {
    const versions = await load(viewId);
    if (viewIdRef.current !== viewId) return;
    setVersions(versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
