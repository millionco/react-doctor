import * as React from "react";

const NamespaceDerivedState = ({ items }: { items: string[] }) => {
  const [filteredItems, setFilteredItems] = React.useState<string[]>([]);

  React.useEffect(() => {
    setFilteredItems(items);
  }, [items]);

  return <div>{filteredItems.join(",")}</div>;
};

const NamespaceFetchInEffect = () => {
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    fetch("/api/data")
      .then((response) => response.json())
      .then((json) => setData(json));
  }, []);

  return <div>{JSON.stringify(data)}</div>;
};

const NamespaceCascadingSetState = ({ trigger }: { trigger: string }) => {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [age, setAge] = React.useState(0);

  React.useEffect(() => {
    // Re-runs on `trigger` change — the init-only-effect skip
    // (empty-deps) doesn't apply here, so the rule fires on 3
    // cascading setStates.
    setName("John");
    setEmail("john@example.com");
    setAge(30);
  }, [trigger]);

  return (
    <div>
      {name} {email} {age}
    </div>
  );
};

const NamespaceEffectEventHandler = ({ isOpen }: { isOpen: boolean }) => {
  React.useEffect(() => {
    if (isOpen) {
      document.body.classList.add("modal-open");
    }
  }, [isOpen]);

  return <div />;
};

// Prop name `currentName` (NOT `initialName`) — the initial-only
// prop-name skip in `no-derived-useState` does NOT apply, so the
// rule correctly flags this as derived-from-prop.
const NamespaceDerivedUseState = ({ currentName }: { currentName: string }) => {
  const [name, setName] = React.useState(currentName);
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
};

const NamespaceLazyInit = () => {
  const [value, setValue] = React.useState(JSON.parse("{}"));
  return <div>{JSON.stringify(value)}</div>;
};

const NamespaceFunctionalSetState = () => {
  const [count, setCount] = React.useState(0);
  // Deferred (setTimeout) read of `count` — a real stale-closure trap.
  // A synchronous `onClick={() => setCount(count + 1)}` would NOT fire
  // (fresh state per render), so the deferred form keeps coverage of the
  // namespaced-setter arithmetic path.
  return <button onClick={() => setTimeout(() => setCount(count + 1), 0)}>{count}</button>;
};

const NamespaceDependencyLiteral = () => {
  React.useEffect(() => {}, [{}]);
  React.useCallback(() => {}, [[]]);
  return <div />;
};

const NamespaceHydrationFlicker = () => {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  return <div>{mounted ? "client" : "server"}</div>;
};

const NamespaceSimpleMemo = ({ count }: { count: number }) => {
  const doubled = React.useMemo(() => count * 2, [count]);
  return <div>{doubled}</div>;
};

const NamespacePreferUseReducer = () => {
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");
  const [c, setC] = React.useState(0);
  const [d, setD] = React.useState("");
  const [e, setE] = React.useState("");

  return (
    <div>
      <input value={a} onChange={(event) => setA(event.target.value)} />
      <input value={b} onChange={(event) => setB(event.target.value)} />
      <input value={c} type="number" onChange={(event) => setC(Number(event.target.value))} />
      <input value={d} onChange={(event) => setD(event.target.value)} />
      <input value={e} onChange={(event) => setE(event.target.value)} />
    </div>
  );
};

export {
  NamespaceDerivedState,
  NamespaceFetchInEffect,
  NamespaceCascadingSetState,
  NamespaceEffectEventHandler,
  NamespaceDerivedUseState,
  NamespaceLazyInit,
  NamespaceFunctionalSetState,
  NamespaceDependencyLiteral,
  NamespaceHydrationFlicker,
  NamespaceSimpleMemo,
  NamespacePreferUseReducer,
};
