import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const deferredSubscriptionCases = [
  {
    name: "older-1959-nullable-optional-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "older-1959-explicit-null-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      if (subscription !== null) subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "older-1959-handle-and-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      subscription && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "older-1959-false-and-skipped-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      false && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1959-unrelated-and-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      const allowRelease = false; allowRelease && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1959-nested-unrelated-and-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      subscription && (false && subscription.remove());
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1959-missing-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      void subscription;
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1959-nested-uninvoked-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      const deferredRelease = () => subscription?.remove(); void deferredRelease;
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1959-repeated-acquisition-single-release-v1",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1959-existing-deferred-timer-v1",
    source: `import { useEffect } from "react";
export const AsyncTimerPanel = () => {
 useEffect(() => {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  void Promise.resolve().then(() => {
   if (cancelled) return;
   timer = setTimeout(() => {}, 1000);
  });
  return () => { cancelled = true; if (timer !== null) clearTimeout(timer); };
 }, []);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "non-null-comparison",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      subscription !== null && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "transparent-handle-and-release",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      (subscription as Subscription | null) && (subscription.remove() as void);
    };
  }, []);
  return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "compound-false-left-guard",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      (subscription && false) && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "compound-unrelated-false-left-guard",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      const allowRelease = false; (subscription && allowRelease) && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "invalid-null-snapshot-before-acquisition-logical-guard",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    const captured = subscription;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      captured && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "invalid-null-snapshot-before-acquisition-explicit-if",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    const captured = subscription;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      if (captured) subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "invalid-null-snapshot-before-acquisition-optional-alias-release",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    const captured = subscription;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      captured?.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "unsupported-direct-binding-boundary-after-acquisition-cleanup-snapshot",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      const captured = subscription; captured && subscription.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "unsupported-direct-binding-boundary-after-acquisition-optional-alias-release",
    source: `import { useEffect } from "react";
interface Subscription { remove: () => void; }
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      const captured = subscription; captured?.remove();
    };
  }, []);
  return null;
};
`,
    expectedCount: 1,
  },
];

describe("effect-needs-cleanup deferred subscription release guards", () => {
  it.each(deferredSubscriptionCases)("$name", ({ source, expectedCount }) => {
    const result = runRule(wrapWithSemanticContext(effectNeedsCleanup), source);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
