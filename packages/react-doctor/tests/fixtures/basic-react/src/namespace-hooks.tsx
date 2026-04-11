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

const NamespaceCascadingSetState = () => {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [age, setAge] = React.useState(0);

  React.useEffect(() => {
    setName("John");
    setEmail("john@example.com");
    setAge(30);
  }, []);

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

const NamespaceDerivedUseState = ({ initialName }: { initialName: string }) => {
  const [name, setName] = React.useState(initialName);
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
};

const NamespaceLazyInit = () => {
  const [value, setValue] = React.useState(JSON.parse("{}"));
  return <div>{JSON.stringify(value)}</div>;
};

const NamespaceFunctionalSetState = () => {
  const [count, setCount] = React.useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
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
