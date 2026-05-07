import { useState, useEffect, useCallback } from "react";

const DerivedStateComponent = ({ items }: { items: string[] }) => {
  const [filteredItems, setFilteredItems] = useState<string[]>([]);

  useEffect(() => {
    setFilteredItems(items);
  }, [items]);

  return <div>{filteredItems.join(",")}</div>;
};

const StateResetComponent = ({ visible }: { visible: boolean }) => {
  const [inputValue, setInputValue] = useState("");
  useEffect(() => {
    setInputValue("");
  }, [visible]);
  return <input value={inputValue} onChange={(event) => setInputValue(event.target.value)} />;
};

const FetchInEffectComponent = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/api/data")
      .then((response) => response.json())
      .then((json) => setData(json));
  }, []);

  return <div>{JSON.stringify(data)}</div>;
};

const LazyInitComponent = () => {
  const [value, setValue] = useState(JSON.parse("{}"));
  return <div>{JSON.stringify(value)}</div>;
};

const CascadingSetStateComponent = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState(0);

  useEffect(() => {
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

const EffectEventHandlerComponent = ({ isOpen }: { isOpen: boolean }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("modal-open");
    }
  }, [isOpen]);

  return <div />;
};

const DerivedUseStateComponent = ({ initialName }: { initialName: string }) => {
  const [name, setName] = useState(initialName);
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
};

const PreferUseReducerComponent = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState(0);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <div>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <input value={email} onChange={(event) => setEmail(event.target.value)} />
      <input value={age} type="number" onChange={(event) => setAge(Number(event.target.value))} />
      <input value={address} onChange={(event) => setAddress(event.target.value)} />
      <input value={phone} onChange={(event) => setPhone(event.target.value)} />
    </div>
  );
};

const FunctionalSetStateComponent = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};

const DependencyLiteralComponent = () => {
  useEffect(() => {}, [{}]);
  useCallback(() => {}, [[]]);
  return <div />;
};

const DirectStateMutationComponent = () => {
  const [items, setItems] = useState<string[]>([]);
  const [profile, setProfile] = useState({ nested: { tags: [] as string[] } });

  void setItems;
  void setProfile;

  const onAddItem = (next: string) => {
    items.push(next);
    items[0] = next;
    profile.nested.tags.push(next);
  };

  const buildLocal = (raw: string) => {
    // Locally-bound `items` shadows the state — must NOT be flagged.
    const items = raw.split(",");
    items.push("extra");
    return items;
  };
  void buildLocal;

  return <button onClick={() => onAddItem("hello")}>{items.length}</button>;
};

const SetStateInRenderComponent = () => {
  const [name, setName] = useState("");
  setName("Alice");
  return <h1>{name}</h1>;
};

const ConditionalSetStateInRenderComponent = ({ count }: { count: number }) => {
  const [prevCount, setPrevCount] = useState(count);
  if (prevCount !== count) {
    setPrevCount(count);
  }
  return <h1>{prevCount}</h1>;
};

declare const externalStore: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
};

const SubscribeStorePatternComponent = () => {
  const [snapshot, setSnapshot] = useState(externalStore.getSnapshot());
  useEffect(() => {
    const unsubscribe = externalStore.subscribe(() => {
      setSnapshot(externalStore.getSnapshot());
    });
    return unsubscribe;
  }, []);
  return <div>{snapshot}</div>;
};

const UncontrolledInputComponent = () => {
  // HACK: explicit `<string | undefined>` keeps TypeScript happy while the
  // RUNTIME initializer stays undefined — that's what trips the
  // no-uncontrolled-input "flip from uncontrolled to controlled" check.
  const [first, setFirst] = useState<string | undefined>();
  const [second, setSecond] = useState("");
  void setFirst;
  return (
    <form>
      <input value={first} onChange={(event) => setFirst(event.target.value)} />
      <input
        value={second}
        defaultValue="hello"
        onChange={(event) => setSecond(event.target.value)}
      />
      <input value="frozen" />
    </form>
  );
};

export {
  DerivedStateComponent,
  StateResetComponent,
  FetchInEffectComponent,
  LazyInitComponent,
  CascadingSetStateComponent,
  EffectEventHandlerComponent,
  DerivedUseStateComponent,
  PreferUseReducerComponent,
  FunctionalSetStateComponent,
  DependencyLiteralComponent,
  DirectStateMutationComponent,
  SetStateInRenderComponent,
  ConditionalSetStateInRenderComponent,
  SubscribeStorePatternComponent,
  UncontrolledInputComponent,
};
