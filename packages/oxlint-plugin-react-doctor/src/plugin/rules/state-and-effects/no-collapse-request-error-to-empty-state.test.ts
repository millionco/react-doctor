import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCollapseRequestErrorToEmptyState } from "./no-collapse-request-error-to-empty-state.js";

const run = (code: string) => runRule(noCollapseRequestErrorToEmptyState, code);

describe("no-collapse-request-error-to-empty-state", () => {
  it.each([
    [
      "a direct empty-array write correlated with an early empty-result return",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p className="text-sm">No results found</p>;
         return <ResultList items={items} />;
       };`,
    ],
    [
      "a strict zero-length guard",
      `import { useState } from "react";
       const Inbox = () => {
         const [messages, setMessages] = useState([]);
         const load = async () => {
           try { setMessages(await (await fetch("/api/messages")).json()); }
           catch (error) { setMessages([]); }
         };
         if (messages.length === 0) {
           return <section class="py-4">Nothing here</section>;
         }
         return <MessageList messages={messages} />;
       };`,
    ],
    [
      "a reversed strict zero-length guard",
      `import { useState } from "react";
       const Files = () => {
         const [files, setFiles] = useState([]);
         const load = async () => {
           try { setFiles(await (await globalThis.fetch("/api/files")).json()); }
           catch { setFiles([]); }
         };
         if (0 === files.length) return <div>No files</div>;
         return <FileList files={files} />;
       };`,
    ],
    [
      "a functional empty-array write",
      `import { useState } from "react";
       const Orders = () => {
         const [orders, setOrders] = useState([]);
         const load = async () => {
           try { setOrders(await (await window.fetch("/api/orders")).json()); }
           catch { setOrders((previousOrders) => []); }
         };
         return !orders.length ? <p>No orders</p> : <OrderList orders={orders} />;
       };`,
    ],
    [
      "block-bodied empty-array updater and lazy initializer",
      `import React from "react";
       const Events = () => {
         const [events, setEvents] = React.useState(() => { return []; });
         const load = async () => {
           try { setEvents(await (await fetch("/api/events")).json()); }
           catch { setEvents(() => { return []; }); }
         };
         return events.length === 0 ? <aside>No events</aside> : <EventList events={events} />;
       };`,
    ],
    [
      "an inverse length ternary",
      `import * as React from "react";
       const Tasks = () => {
         const [tasks, setTasks] = React.useState([]);
         const load = async () => {
           try { setTasks(await (await fetch("/api/tasks")).json()); }
           catch { setTasks([]); }
         };
         return tasks.length ? <TaskList tasks={tasks} /> : <div>Nothing to show</div>;
       };`,
    ],
    [
      "a returned JSX tree containing the ternary",
      `import { useState } from "react";
       const Products = () => {
         const [products, setProducts] = useState([]);
         const load = async () => {
           try { setProducts(await (await fetch("/api/products")).json()); }
           catch { setProducts([]); }
         };
         return <main>{products.length ? <ProductGrid products={products} /> : <p>No products</p>}</main>;
       };`,
    ],
    [
      "nested static intrinsic empty-result copy",
      `import { useState } from "react";
       const Records = () => {
         const [records, setRecords] = useState([]);
         const load = async () => {
           try { setRecords(await (await fetch("/api/records")).json()); }
           catch { setRecords([]); }
         };
         if (!records.length) return <section><p>No <span>records</span> found</p></section>;
         return <RecordTable records={records} />;
       };`,
    ],
    [
      "an aliased React useState import with transparent TypeScript wrappers",
      `import { useState as useCollectionState } from "react";
       interface Item { id: string }
       const Items = () => {
         const [items, setItems] = useCollectionState<Item[]>([] as Item[]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems(([] as Item[])); }
         };
         return items.length ? <ItemList items={items} /> : <div>No items</div>;
       };`,
    ],
    [
      "an awaited exact local request helper",
      `import { useState } from "react";
       const requestItems = async () => {
         const response = await fetch("/api/items");
         return response.json();
       };
       const Items = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await requestItems()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <ItemList items={items} />;
       };`,
    ],
    [
      "an exact expression-bodied fetch helper",
      `import { useState } from "react";
       const requestItems = () => fetch("/api/items").then((response) => response.json());
       const Items = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await requestItems()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <ItemList items={items} />;
       };`,
    ],
    [
      "a fetch rejection handler that rethrows",
      `import { useState } from "react";
       const Items = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await fetch("/api/items").catch((error) => { throw error; })); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <ItemList items={items} />;
       };`,
    ],
    [
      "an inner catch that unconditionally rethrows",
      `import { useState } from "react";
       const Items = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try {
             try { setItems(await (await fetch("/api/items")).json()); }
             catch (error) { throw error; }
           } catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <ItemList items={items} />;
       };`,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a catch that records the error",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const [, setError] = useState(null);
         try { setItems(readItems()); }
         catch (error) { setError(error); setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a catch that delegates to a toast",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch (error) { toast.error(error); setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a catch that rethrows",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch (error) { setItems([]); throw error; }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a conditional abort branch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch (error) { if (error.name === "AbortError") setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a conditional 404 fallback",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch (error) { if (error.status === 404) setItems([]); else throw error; }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an object sentinel",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems({}); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a null sentinel",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems(null); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a non-empty initial collection",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState(initialItems);
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an unsafe lazy initializer with another statement",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState(() => { track(); return []; });
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a custom hook setter",
      `const Search = () => {
         const [items, setItems] = useItems();
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a reducer dispatcher",
      `import { useReducer } from "react";
       const Search = () => {
         const [items, setItems] = useReducer(reducer, []);
         try { setItems({ type: "replace", items: readItems() }); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an imported setter",
      `import { items, setItems } from "./store";
       const Search = () => {
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a local setter alias",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const clearItems = setItems;
         try { setItems(readItems()); }
         catch { clearItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a shadowed setter inside the catch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { const setItems = clearCache; setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a functional write with an unknown side effect",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems(() => { auditFallback(); return []; }); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a shadowed useState function",
      `const useState = (value) => [value, () => {}];
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a Promise catch callback",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         readItems().then(setItems).catch(() => setItems([]));
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "no correlated empty render",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         return <List items={items} />;
       };`,
    ],
    [
      "a different collection drives the empty render",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const [filteredItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!filteredItems.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a compound empty guard",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length && hasLoaded) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a derived empty guard",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const hasNoItems = !items.length;
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (hasNoItems) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an opaque EmptyState component",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <EmptyState>No items</EmptyState>;
         return <List items={items} />;
       };`,
    ],
    [
      "dynamic empty-result copy",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <p>{emptyMessage}</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "unrecognized static fallback copy",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         if (!items.length) return <p>Please change your filters</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a conditional used outside rendered output",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         const label = items.length ? <span>Available</span> : <span>No items</span>;
         return <List items={items} label={label} />;
       };`,
    ],
    [
      "a conditional used only as an attribute",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         return <List title={items.length ? <span>Available</span> : <span>No items</span>} items={items} />;
       };`,
    ],
    [
      "an empty render inside a nested callback",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(readItems()); }
         catch { setItems([]); }
         const renderEmpty = () => !items.length ? <p>No items</p> : null;
         return <List items={items} empty={renderEmpty} />;
       };`,
    ],
    [
      "a synchronous JSON parse failure with no request evidence",
      `import { useState } from "react";
       const Search = ({ rawItems }) => {
         const [items, setItems] = useState([]);
         try { setItems(JSON.parse(rawItems)); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a localStorage failure with no request evidence",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         try { setItems(JSON.parse(localStorage.getItem("items"))); }
         catch { setItems([]); }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a shadowed fetch function",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const fetch = async () => readFixture();
         const load = async () => {
           try { setItems(await fetch()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an unreachable catch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           return;
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an unreachable request await",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { if (false) await fetch("/api/items"); setItems(JSON.parse(raw)); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a fetch inside an uncalled nested callback",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { const later = async () => fetch("/api/items"); setItems(JSON.parse(raw)); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an unreachable empty-result return",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         return <List items={items} />;
         if (!items.length) return <p>No items</p>;
       };`,
    ],
    [
      "a try statement with a finalizer",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
           finally { stopLoading(); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an async empty-array updater",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems(async () => []); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a generator empty-array updater",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems(function* () { return []; }); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a hidden empty-result branch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p hidden>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an aria-hidden empty-result branch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p aria-hidden="true">No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a Tailwind-hidden empty-result branch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p className="md:hidden">No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an empty-result branch with unknown classes",
      `import { useState } from "react";
       const Search = ({ emptyClassName }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p className={emptyClassName}>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an empty-result branch with unknown aria-hidden state",
      `import { useState } from "react";
       const Search = ({ isEmptyHidden }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p aria-hidden={isEmptyHidden}>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an empty-result branch with unknown spread visibility",
      `import { useState } from "react";
       const Search = ({ emptyProps }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p {...emptyProps}>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an empty-result branch inside a hidden ancestor",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         return <main hidden>{items.length ? <List items={items} /> : <p>No items</p>}</main>;
       };`,
    ],
    [
      "imperative copy containing bare Empty",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>Empty the local cache</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an explicit prior error return",
      `import { useState } from "react";
       const Search = ({ requestError }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (requestError) return <p>Request failed</p>;
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "mutually exclusive if and else routes",
      `import { useState } from "react";
       const Search = async ({ remoteMode }) => {
         const [items, setItems] = useState([]);
         if (remoteMode) {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         } else {
           if (!items.length) return <p>No items</p>;
         }
         return <List items={items} />;
       };`,
    ],
    [
      "contradictory guarded routes",
      `import { useState } from "react";
       const Search = async ({ remoteMode }) => {
         const [items, setItems] = useState([]);
         if (remoteMode) {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         }
         if (!remoteMode) {
           if (!items.length) return <p>No items</p>;
         }
         return <List items={items} />;
       };`,
    ],
    [
      "a local request helper that swallows its own fetch rejection",
      `import { useState } from "react";
       const requestItems = async () => {
         try { return await (await fetch("/api/items")).json(); }
         catch { return []; }
       };
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await requestItems()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a local request helper whose finalizer overrides rejection",
      `import { useState } from "react";
       const requestItems = async () => {
         try { return await (await fetch("/api/items")).json(); }
         finally { return []; }
       };
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await requestItems()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a responsive arbitrary Tailwind display-none branch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p className="md:[display:none]">No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "empty-result copy that also describes a request failure",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items because the request failed</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "empty-result copy that says files could not be loaded",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No files could be loaded because the request failed</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "empty-result copy that names a loading error",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items — error loading results</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "empty-result copy that names a network failure",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No results due to a network failure</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a directly absorbed fetch rejection",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await fetch("/api/items").catch(() => [])); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a fetch rejection absorbed by the second then callback",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await fetch("/api/items").then((response) => response.json(), () => [])); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a local request helper that absorbs a fetch rejection",
      `import { useState } from "react";
       const requestItems = () => fetch("/api/items").catch(() => []);
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await requestItems()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a generator request helper",
      `import { useState } from "react";
       function* requestItems() { return fetch("/api/items"); }
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await requestItems()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a prior rejected-status return",
      `import { useState } from "react";
       const Search = ({ status }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (status === "rejected") return <p>Try again</p>;
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a prior response-status return",
      `import { useState } from "react";
       const Search = ({ response }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!response.ok) return <p>Try again</p>;
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a prior switch route with an early return",
      `import { useState } from "react";
       const Search = ({ status }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         switch (status) {
           case "rejected": return <p>Try again</p>;
           case "pending": return <p>Loading</p>;
         }
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an alternate early return beside the empty-result route",
      `import { useState } from "react";
       const Search = ({ mayShowResults }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (mayShowResults) {
           if (!items.length) return <p>No items</p>;
         } else {
           return <p>Request unavailable</p>;
         }
         return <List items={items} />;
       };`,
    ],
    [
      "equality-based modes around a nested request handler",
      `import { useState } from "react";
       const Search = ({ mode }) => {
         const [items, setItems] = useState([]);
         if (mode === "remote") {
           const load = async () => {
             try { setItems(await (await fetch("/api/items")).json()); }
             catch { setItems([]); }
           };
         }
         if (mode !== "remote") {
           if (!items.length) return <p>No items</p>;
         }
         return <List items={items} />;
       };`,
    ],
    [
      "a trailing-important className visibility utility",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p className="md:hidden!">No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a trailing-important class visibility utility",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p class="hidden!">No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a trailing-important arbitrary visibility utility",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try { setItems(await (await fetch("/api/items")).json()); }
           catch { setItems([]); }
         };
         if (!items.length) return <p className="md:[display:none]!">No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a fetch in an unreachable conditional branch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try {
             const result = await (false ? fetch("/api/items") : Promise.resolve([]));
             setItems(result);
           } catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a fetch behind an unreachable logical right side",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try {
             await (false && fetch("/api/items"));
             setItems(JSON.parse(rawItems));
           } catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "a fetch rejection absorbed by an inner try catch",
      `import { useState } from "react";
       const Search = () => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try {
             try { await fetch("/api/items"); }
             catch { recoverFromRequestFailure(); }
             setItems(JSON.parse(rawItems));
           } catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
    [
      "an inner catch that only conditionally rethrows",
      `import { useState } from "react";
       const Search = ({ shouldRethrow }) => {
         const [items, setItems] = useState([]);
         const load = async () => {
           try {
             try { await fetch("/api/items"); }
             catch (error) { if (shouldRethrow) throw error; recoverFromRequestFailure(); }
             setItems(JSON.parse(rawItems));
           } catch { setItems([]); }
         };
         if (!items.length) return <p>No items</p>;
         return <List items={items} />;
       };`,
    ],
  ])("stays quiet for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
