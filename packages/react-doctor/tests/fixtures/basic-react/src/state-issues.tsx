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

const EffectNeedsCleanupComponent = () => {
  const [, setNow] = useState(0);
  useEffect(() => {
    setInterval(() => setNow(Date.now()), 1000);
  }, []);
  return <span />;
};

const MirrorPropEffectComponent = ({ value }: { value: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};

const MutableInDepsComponent = ({ token }: { token: string }) => {
  void token;
  useEffect(() => {
    document.title = location.pathname;
  }, [location.pathname]);
  return <div />;
};

const PreferUseEffectEventComponent = ({ onSearch }: { onSearch: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(id);
  }, [query, onSearch]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
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

declare const post: (url: string, body: unknown) => void;

const EventTriggerStateComponent = () => {
  const [firstName, setFirstName] = useState("");
  const [jsonToSubmit, setJsonToSubmit] = useState<{ firstName: string } | null>(null);
  useEffect(() => {
    if (jsonToSubmit !== null) {
      post("/api/register", jsonToSubmit);
    }
  }, [jsonToSubmit]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setJsonToSubmit({ firstName });
      }}
    >
      <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
    </form>
  );
};

interface Card {
  gold: boolean;
}

const EffectChainComponent = ({ card }: { card: Card | null }) => {
  const [goldCount, setGoldCount] = useState(0);
  const [round, setRound] = useState(1);
  useEffect(() => {
    if (card !== null && card.gold) {
      setGoldCount((c) => c + 1);
    }
  }, [card]);
  useEffect(() => {
    if (goldCount > 3) {
      setRound((r) => r + 1);
    }
  }, [goldCount]);
  return (
    <div>
      {goldCount} {round}
    </div>
  );
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
  EffectNeedsCleanupComponent,
  MirrorPropEffectComponent,
  MutableInDepsComponent,
  PreferUseEffectEventComponent,
  SubscribeStorePatternComponent,
  EventTriggerStateComponent,
  EffectChainComponent,
  UncontrolledInputComponent,
};
