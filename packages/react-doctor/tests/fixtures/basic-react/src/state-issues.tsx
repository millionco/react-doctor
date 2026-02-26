import { useState, useEffect, useMemo, useCallback } from "react";

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
};
