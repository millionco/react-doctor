import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const logicalReceiverCases = [
  {
    name: "older-1955-direct-logical-same-receiver-v1",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const ReceiverPanel = ({ first, fallback, other }: { first: Emitter | null; fallback: Emitter; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  
  (first || fallback).on("data", handler);
  return () => { (first || fallback).off("data", handler); };
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "older-1955-direct-nullish-same-receiver-v1",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const ReceiverPanel = ({ first, fallback, other }: { first: Emitter | null; fallback: Emitter; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  
  (first ?? fallback).on("data", handler);
  return () => { (first ?? fallback).off("data", handler); };
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "older-1955-logical-different-receiver-v1",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const ReceiverPanel = ({ first, fallback, other }: { first: Emitter | null; fallback: Emitter; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  
  (first || fallback).on("data", handler);
  return () => { (first || other).off("data", handler); };
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1955-aliased-logical-control-v1",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const ReceiverPanel = ({ first, fallback, other }: { first: Emitter | null; fallback: Emitter; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  const target = first || fallback;
  target.on("data", handler);
  return () => { target.off("data", handler); };
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "older-1955-mutable-logical-input-v1",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const MutableReceiverPanel = ({ first, fallback, other }: { first: Emitter; fallback: Emitter; other: Emitter }) => {
 let selected = first;
 useEffect(() => {
  const handler = () => {};
  const target = selected || fallback;
  target.on("data", handler);
  selected = other;
  return () => (selected || fallback).off("data", handler);
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "older-1955-known-navigation-logical-v1",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
export const NativeNavigationPanel = () => {
 const navigation = useNavigation();
 useEffect(() => {
  const parent = navigation.getParent();
  const unsubscribe = (parent ?? navigation).addListener("transitionEnd", () => {});
  return () => unsubscribe();
 }, [navigation]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "older-1955-opaque-or-known-navigation-v1",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  const target = opaque || navigation;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "wrapped-mutable-logical-input",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const MutableReceiverPanel = ({ first, fallback, other }: { first: Emitter; fallback: Emitter; other: Emitter }) => {
 let selected = first;
 useEffect(() => {
  const handler = () => {};
  const target = selected || fallback;
  target.on("data", handler);
  (selected as Emitter) = other;
  return () => (selected || fallback).off("data", handler);
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "const-alias-of-mutated-logical-input",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const MutableReceiverPanel = ({ first, fallback, other }: { first: Emitter; fallback: Emitter; other: Emitter }) => {
 let selected = first;
 useEffect(() => {
  const handler = () => {};
  const captured = selected;
  const target = captured || fallback;
  target.on("data", handler);
  selected = other;
  return () => (selected || fallback).off("data", handler);
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "stable-snapshot-receiver-after-input-write",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const MutableReceiverPanel = ({ first, fallback, other }: { first: Emitter; fallback: Emitter; other: Emitter }) => {
 let selected = first;
 useEffect(() => {
  const handler = () => {};
  const target = selected || fallback;
  target.on("data", handler);
  selected = other;
  return () => target.off("data", handler);
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "readonly-contributor-alias",
    source: `import { useEffect } from "react";
interface Emitter {
 on: (event: string, callback: () => void) => void;
 off: (event: string, callback: () => void) => void;
}
export const ReceiverPanel = ({ first, fallback, other }: { first: Emitter | null; fallback: Emitter; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  const selected = first;
  const target = selected || fallback;
  target.on("data", handler);
  return () => { target.off("data", handler); };
 }, [first, fallback, other]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "opaque-nullish-known-navigation",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  const target = opaque ?? navigation;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "known-navigation-or-opaque",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  const target = navigation || opaque;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "known-navigation-nullish-opaque",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  const target = navigation ?? opaque;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "two-repeated-known-navigation-providers",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  const target = navigation || navigation;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "known-navigation-const-alias",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  const alias = navigation;
  const target = alias ?? navigation;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "reassigned-provider-alias",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  let selected: typeof navigation | OpaqueProvider | null = navigation;
  selected = opaque;
  const target = selected || navigation;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "known-navigation-and-selected-right",
    source: `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription { remove: () => void; }
interface OpaqueProvider { addListener: (event: string, callback: () => void) => Subscription; }
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
 const navigation = useNavigation();
 useEffect(() => {
  if (!opaque) return;
  const target = opaque && navigation;
  const subscription = target.addListener("event", () => {});
  return () => subscription();
 }, [opaque, navigation]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "readonly-logical-member-roots",
    source: `import { useEffect } from "react";
interface Emitter { on: (event: string, callback: () => void) => void; off: (event: string, callback: () => void) => void; }
export const HolderPanel = ({ holder, other }: { holder: { first: Emitter | null; fallback: Emitter }; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  (holder.first || holder.fallback).on("data", handler);
  
  return () => (holder.first || holder.fallback).off("data", handler);
 }, [holder, other]);
 return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "written-logical-member-root",
    source: `import { useEffect } from "react";
interface Emitter { on: (event: string, callback: () => void) => void; off: (event: string, callback: () => void) => void; }
export const HolderPanel = ({ holder, other }: { holder: { first: Emitter | null; fallback: Emitter }; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  (holder.first || holder.fallback).on("data", handler);
  (holder.first as Emitter | null) = other;
  return () => (holder.first || holder.fallback).off("data", handler);
 }, [holder, other]);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "this-member-visible-write",
    source: `import { useEffect } from "react";
interface Emitter { on: (event: string, callback: () => void) => void; off: (event: string, callback: () => void) => void; }
interface Holder { first: Emitter | null; fallback: Emitter; }
const useBoundEmitterSubscription = function(this: Holder, other: Emitter) {
 useEffect(() => {
  const handler = () => {};
  (this.first || this.fallback).on("data", handler);
  this.first = other;
  return () => (this.first || this.fallback).off("data", handler);
 }, [other]);
};
export const BoundEmitterPanel = ({ holder, other }: { holder: Holder; other: Emitter }) => {
 useBoundEmitterSubscription.call(holder, other);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "this-member-readonly-frontier",
    source: `import { useEffect } from "react";
interface Emitter { on: (event: string, callback: () => void) => void; off: (event: string, callback: () => void) => void; }
interface Holder { first: Emitter | null; fallback: Emitter; }
const useBoundEmitterSubscription = function(this: Holder, other: Emitter) {
 useEffect(() => {
  const handler = () => {};
  (this.first || this.fallback).on("data", handler);
  
  return () => (this.first || this.fallback).off("data", handler);
 }, [other]);
};
export const BoundEmitterPanel = ({ holder, other }: { holder: Holder; other: Emitter }) => {
 useBoundEmitterSubscription.call(holder, other);
 return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "global-member-visible-write",
    source: `import { useEffect } from "react";
interface Emitter { on: (event: string, callback: () => void) => void; off: (event: string, callback: () => void) => void; }
export const GlobalEmitterPanel = ({ fallback, other }: { fallback: Emitter; other: Emitter }) => {
 useEffect(() => {
  const handler = () => {};
  (globalThis.emitter || fallback).on("data", handler);
  globalThis.emitter = other;
  return () => (globalThis.emitter || fallback).off("data", handler);
 }, [fallback, other]);
 return null;
};
`,
    expectedCount: 1,
  },
];

describe("effect-needs-cleanup logical receiver stability", () => {
  for (const testCase of logicalReceiverCases) {
    it(testCase.name, () => {
      const result = runRule(wrapWithSemanticContext(effectNeedsCleanup), testCase.source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
      expect(result).toEqual(runRule(effectNeedsCleanup, testCase.source));
    });
  }
});
