import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

interface StreamMutationEdit {
  readonly file: string;
  readonly before: string;
  readonly after: string;
}
interface StreamMutationFixture {
  readonly name: string;
  readonly count: number;
  readonly edits: ReadonlyArray<StreamMutationEdit>;
  readonly files: Readonly<Record<string, string>>;
}

const BASE_FILES: Readonly<Record<string, string>> = {
  "package.json":
    '{"name": "fixture-channel-editor", "version": "0.0.1", "dependencies": {"react": "17.0.2", "stream-chat": "4.1.0", "stream-chat-react": "6.5.1"}}',
  "tsconfig.json": '{"compilerOptions": {"jsx": "react-jsx"}}',
  "editor.tsx":
    'import { useState } from "react";\nimport { useChatContext } from "stream-chat-react";\nexport const Panel = () => {\n  const { channel } = useChatContext();\n  const [label, setLabel] = useState("");\n  const save = async () => {\n    await channel.update({ name: "Next" });\n    setLabel("Saved");\n  };\n  return <div><button onClick={save}>Save</button><span>{label}</span></div>;\n};\n',
  "application.tsx":
    'import { StreamChat } from "stream-chat";\nimport { Chat } from "stream-chat-react";\nimport { Panel } from "./editor";\nconst connection = StreamChat.getInstance("fixture-key");\nexport const Application = () => <Chat client={connection}><Panel /></Chat>;\n',
};
const STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE =
  'import { useEffect, useState } from "react";\nimport { useChatContext } from "stream-chat-react";\nconst Row = ({ item, kind, publish, client }) => {\n  if (kind === "room") {\n    return <button onClick={() => publish(item)}>{item.id}</button>;\n  }\n  return <button onClick={() => { const fresh = client.channel("team", { members: [item.id] }); publish(fresh); }}>{item.name}</button>;\n};\nconst Results = ({ rooms, people, publish, client }) => <><section>{rooms.map(item => <Row item={item} kind="room" publish={publish} client={client} />)}</section><section>{people.map(item => <Row item={item} kind="person" publish={publish} client={client} />)}</section></>;\nexport const Search = () => {\n  const { client, setActiveChannel } = useChatContext();\n  const [rooms, setRooms] = useState([]);\n  useEffect(() => { const load = async () => { const request = client.queryChannels({}); const [items] = await Promise.all([request]); setRooms(items); }; load(); }, []);\n  const publish = item => setActiveChannel(item);\n  return <Results rooms={rooms} people={[{ id: "reader", name: "Reader" }]} publish={publish} client={client} />;\n};\n';
const cases: ReadonlyArray<StreamMutationFixture> = [
  {
    name: "canonical selected channel update",
    count: 1,
    edits: [],
    files: {},
  },
  {
    name: "canonical selected channel add members",
    count: 1,
    edits: [
      {
        file: "editor.tsx",
        before: 'channel.update({ name: "Next" })',
        after: 'channel.addMembers(["entry"])',
      },
    ],
    files: {},
  },
  {
    name: "readonly selected channel alias",
    count: 1,
    edits: [
      {
        file: "editor.tsx",
        before: "  const save =",
        after: "  const selected = channel;\n  const save =",
      },
      {
        file: "editor.tsx",
        before: "await channel.update",
        after: "await selected.update",
      },
    ],
    files: {},
  },
  {
    name: "renamed genuine hook import",
    count: 1,
    edits: [
      {
        file: "editor.tsx",
        before: "{ useChatContext }",
        after: "{ useChatContext as useChannel }",
      },
      {
        file: "editor.tsx",
        before: "useChatContext();",
        after: "useChannel();",
      },
    ],
    files: {},
  },
  {
    name: "same name own hook is unknown",
    count: 0,
    edits: [
      {
        file: "editor.tsx",
        before: 'from "stream-chat-react"',
        after: 'from "./fake"',
      },
    ],
    files: {
      "fake.ts": "export const useChatContext = () => ({ channel: { update: async () => {} } });\n",
    },
  },
  {
    name: "wrong SDK version",
    count: 0,
    edits: [],
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "stream-chat": "5.0.0", "stream-chat-react": "6.5.1"}}',
    },
  },
  {
    name: "custom context provider is not canonical",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "{ Chat }",
        after: "{ ChatProvider as Chat }",
      },
    ],
    files: {},
  },
  {
    name: "custom client object is not canonical",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: 'const connection = StreamChat.getInstance("fixture-key");',
        after: "const connection = { channel: () => ({ update: async () => {} }) };",
      },
    ],
    files: {},
  },
  {
    name: "canonical factory replacement through alias declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts":
        'import { StreamChat as Factory } from "stream-chat";\nFactory.getInstance = () => replacement;\n',
    },
  },
  {
    name: "channel method replacement declines",
    count: 0,
    edits: [
      {
        file: "editor.tsx",
        before: "  const save =",
        after: "  channel.update = replacement;\n  const save =",
      },
    ],
    files: {},
  },
  {
    name: "client request replacement declines",
    count: 0,
    edits: [],
    files: {
      "poison.tsx":
        'import { useChatContext } from "stream-chat-react";\nexport const Poison = () => { const { client } = useChatContext(); client.post = replacement; return null; };\n',
    },
  },
  {
    name: "mock active channel publication declines",
    count: 0,
    edits: [],
    files: {
      "poison.tsx":
        'import { useChatContext } from "stream-chat-react";\nexport const Poison = () => { const { setActiveChannel } = useChatContext(); setActiveChannel({ update: async () => {} }); return null; };\n',
    },
  },
  {
    name: "active setter escape declines",
    count: 0,
    edits: [],
    files: {
      "poison.tsx":
        'import { useChatContext } from "stream-chat-react";\nexport const Poison = () => { const { setActiveChannel } = useChatContext(); configure(setActiveChannel); return null; };\n',
    },
  },
  {
    name: "prototype mutation declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts":
        'import { StreamChat } from "stream-chat";\nStreamChat.prototype.post = replacement;\n',
    },
  },
  {
    name: "explicit mocking API declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts": 'jest.mock("stream-chat-react", () => replacement);\n',
    },
  },
  {
    name: "method extraction is not a direct mutation",
    count: 0,
    edits: [
      {
        file: "editor.tsx",
        before: "  const save =",
        after: "  const invoke = channel.update;\n  const save =",
      },
      {
        file: "editor.tsx",
        before: 'await channel.update({ name: "Next" })',
        after: 'await invoke({ name: "Next" })',
      },
    ],
    files: {},
  },
  {
    name: "no owner state after await stays quiet",
    count: 0,
    edits: [
      {
        file: "editor.tsx",
        before: '    setLabel("Saved");',
        after: "    void label;",
      },
    ],
    files: {},
  },
  {
    name: "read only SDK query is not a mutation",
    count: 0,
    edits: [
      {
        file: "editor.tsx",
        before: "{ channel }",
        after: "{ client }",
      },
      {
        file: "editor.tsx",
        before: 'channel.update({ name: "Next" })',
        after: "client.queryChannels({})",
      },
    ],
    files: {},
  },
  {
    name: "leading state busy guard with disabled control stays quiet",
    count: 0,
    edits: [
      {
        file: "editor.tsx",
        before: "  const save =",
        after: "  const [busy, setBusy] = useState(false);\n  const save =",
      },
      {
        file: "editor.tsx",
        before: "    await channel.update",
        after: "    if (busy) return;\n    setBusy(true);\n    await channel.update",
      },
      {
        file: "editor.tsx",
        before: "<button onClick={save}>",
        after: "<button disabled={busy} onClick={save}>",
      },
    ],
    files: {},
  },
  {
    name: "only one canonical provider is supported",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "<Panel /></Chat>",
        after:
          "<Panel /></Chat>;\nexport const Other = () => <Chat client={connection}><Panel /></Chat>",
      },
    ],
    files: {},
  },
  {
    name: "own channel factory and known empty prop spread preserve origin",
    count: 1,
    edits: [],
    files: {
      "bridge.tsx":
        'import { useChatContext } from "stream-chat-react";\nconst Entry = ({ channel, activate }) => <button onClick={() => activate(channel)}>Open</button>;\nexport const Creator = () => {\n  const { client, setActiveChannel } = useChatContext();\n  const selected = client.channel("team", "fixture");\n  return <Entry channel={selected} activate={setActiveChannel} {...{}} />;\n};\n',
    },
  },
  {
    name: "canonical Preview and readonly subset preserve origins",
    count: 1,
    edits: [],
    files: {
      "navigation.tsx":
        'import { ChannelList } from "stream-chat-react";\nconst Entry = ({ channel, setActiveChannel }) => <button onClick={() => setActiveChannel(channel)}>{channel.id}</button>;\nconst filter = entries => entries.filter(entry => entry.type === "team");\nexport const Navigation = () => <ChannelList channelRenderFilterFn={filter} Preview={entryProps => <Entry {...entryProps} />} />;\n',
    },
  },
  {
    name: "query tuple through own state and map preserves origins",
    count: 1,
    edits: [],
    files: {
      "query.tsx":
        'import { useEffect, useState } from "react";\nimport { useChatContext } from "stream-chat-react";\nexport const Picker = () => {\n  const { client, setActiveChannel } = useChatContext();\n  const [entries, setEntries] = useState([]);\n  useEffect(() => {\n    const load = async () => {\n      const request = client.queryChannels({});\n      const [items] = await Promise.all([request]);\n      setEntries(items);\n    };\n    load();\n  }, []);\n  return entries.map(entry => <button onClick={() => setActiveChannel(entry)}>{entry.id}</button>);\n};\n',
    },
  },
  {
    name: "custom filter returning fake channel declines",
    count: 0,
    edits: [],
    files: {
      "navigation.tsx":
        'import { ChannelList } from "stream-chat-react";\nconst filter = entries => [{ update: async () => {} }];\nexport const Navigation = () => <ChannelList channelRenderFilterFn={filter} />;\n',
    },
  },
  {
    name: "unknown function active channel argument declines",
    count: 0,
    edits: [],
    files: {
      "publisher.tsx":
        'import { useChatContext } from "stream-chat-react";\nexport const Publish = () => { const { setActiveChannel } = useChatContext(); setActiveChannel(acquire()); return null; };\n',
    },
  },
  {
    name: "custom named channel publisher remains unknown even beside real input",
    count: 0,
    edits: [],
    files: {
      "publisher.tsx":
        'import { useChatContext } from "stream-chat-react";\nexport const Publish = () => { const { client, setActiveChannel } = useChatContext(); const send = value => setActiveChannel(value); send(client.channel("team","fixture")); external(send); return null; };\n',
    },
  },
  {
    name: "own component wrapper remains inside canonical provider",
    count: 1,
    edits: [
      {
        file: "application.tsx",
        before: "export const Application = () => <Chat client={connection}><Panel /></Chat>;",
        after:
          "const Wrapper = () => <Panel />;\nexport const Application = () => <Chat client={connection}><Wrapper /></Chat>;",
      },
    ],
    files: {},
  },
  {
    name: "selected hook owner outside separate canonical provider stays quiet",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "<Chat client={connection}><Panel /></Chat>",
        after: "<><Chat client={connection}><span /></Chat><Panel /></>",
      },
    ],
    files: {},
  },
  {
    name: "own publisher callback transferred through readonly component prop",
    count: 1,
    edits: [],
    files: {
      "publisher.tsx":
        'import { useChatContext } from "stream-chat-react";\nconst Relay = ({ handler, channel }) => <button onClick={() => handler(channel)}>Open</button>;\nexport const Publish = () => { const { client, setActiveChannel } = useChatContext(); const send = value => setActiveChannel(value); const channel = client.channel("team", "fixture"); return <Relay handler={send} channel={channel} />; };\n',
    },
  },
  {
    name: "own publisher callback escape through own component declines",
    count: 0,
    edits: [],
    files: {
      "publisher.tsx":
        'import { useChatContext } from "stream-chat-react";\nconst Relay = ({ handler }) => { external(handler); return null; };\nexport const Publish = () => { const { client, setActiveChannel } = useChatContext(); const send = value => setActiveChannel(value); send(client.channel("team", "fixture")); return <Relay handler={send} />; };\n',
    },
  },
  {
    name: "Stream React CRACO provider alias declines",
    count: 0,
    edits: [],
    files: {
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "stream-chat-react": resolvePath("./replacement") } } };\n',
    },
  },
  {
    name: "Stream client CRACO provider alias declines",
    count: 0,
    edits: [],
    files: {
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "stream-chat": resolvePath("./replacement") } } };\n',
    },
  },
  {
    name: "canonical SDK static stylesheet side effect remains ordinary",
    count: 1,
    edits: [],
    files: {
      "styles.ts": 'import "stream-chat-react/dist/css/index.css";\n',
    },
  },
  {
    name: "SDK stylesheet alias remap declines",
    count: 0,
    edits: [],
    files: {
      "styles.ts": 'import "stream-chat-react/dist/css/index.css";\n',
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "stream-chat-react/dist/css/index.css": resolvePath("./replacement") } } };\n',
    },
  },
  {
    name: "SDK stylesheet cannot provide runtime bindings",
    count: 0,
    edits: [],
    files: {
      "styles.ts": 'import replacement from "stream-chat-react/dist/css/index.css";\n',
    },
  },
  {
    name: "unused earlier singleton custom options decline",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "const connection =",
        after:
          'StreamChat.getInstance("fixture-key", { adapter: replacement });\nconst connection =',
      },
    ],
    files: {},
  },
  {
    name: "custom JSX factory declines",
    count: 0,
    edits: [],
    files: {
      "tsconfig.json": '{"compilerOptions": {"jsx": "react", "jsxFactory": "h"}}',
    },
  },
  {
    name: "custom JSX import source declines",
    count: 0,
    edits: [],
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "jsxImportSource": "alternate-jsx"}}',
    },
  },
  {
    name: "source JSX pragma declines",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "import { StreamChat }",
        after: "/** @jsx h */\nimport { StreamChat }",
      },
    ],
    files: {},
  },
  {
    name: "classic lexical React replacement declines",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "const connection =",
        after: "const React = { createElement: replacement };\nconst connection =",
      },
    ],
    files: {
      "tsconfig.json": '{"compilerOptions": {"jsx": "react"}}',
    },
  },
  {
    name: "React factory namespace mutation declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts": 'import React from "react"; React.createElement = replacement;\n',
    },
  },
  {
    name: "global Promise all replacement declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts": "Promise.all = async () => [[{ update: async () => {} }]];\n",
    },
  },
  {
    name: "global namespace Promise replacement declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts": "window.Promise = replacement;\n",
    },
  },
  {
    name: "global Promise alias escape declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts": "const constructor = Promise; configure(constructor);\n",
    },
  },
  {
    name: "channel argument cannot escape to arbitrary callback",
    count: 0,
    edits: [
      {
        file: "editor.tsx",
        before: "  const save =",
        after: "  external(channel);\n  const save =",
      },
    ],
    files: {},
  },
  {
    name: "channel cannot occupy another activation argument",
    count: 0,
    edits: [],
    files: {
      "poison.tsx":
        'import { useChatContext } from "stream-chat-react"; export const Poison = () => { const {client,setActiveChannel}=useChatContext(); const entry=client.channel("team","fixture"); setActiveChannel(null,entry); return null; };\n',
    },
  },
  {
    name: "unknown state dispatcher cannot receive canonical channels",
    count: 0,
    edits: [],
    files: {
      "poison.tsx":
        'import { useChatContext } from "stream-chat-react"; export const Poison = () => { const {client}=useChatContext(); const load=async()=>{const entries=await client.queryChannels({}); external(entries);}; return null; };\n',
    },
  },
  {
    name: "query promise then replacement declines",
    count: 0,
    edits: [],
    files: {
      "query.tsx":
        'import { useEffect, useState } from "react";\nimport { useChatContext } from "stream-chat-react";\nexport const Picker = () => {\n  const { client, setActiveChannel } = useChatContext();\n  const [entries, setEntries] = useState([]);\n  useEffect(() => {\n    const load = async () => {\n      const request = client.queryChannels({});\n      request.then = replacement;\n      const [items] = await Promise.all([request]);\n      setEntries(items);\n    };\n    load();\n  }, []);\n  return entries.map(entry => <button onClick={() => setActiveChannel(entry)}>{entry.id}</button>);\n};\n',
    },
  },
  {
    name: "query promise escape declines",
    count: 0,
    edits: [],
    files: {
      "query.tsx":
        'import { useEffect, useState } from "react";\nimport { useChatContext } from "stream-chat-react";\nexport const Picker = () => {\n  const { client, setActiveChannel } = useChatContext();\n  const [entries, setEntries] = useState([]);\n  useEffect(() => {\n    const load = async () => {\n      const request = client.queryChannels({});\n      external(request);\n      const [items] = await Promise.all([request]);\n      setEntries(items);\n    };\n    load();\n  }, []);\n  return entries.map(entry => <button onClick={() => setActiveChannel(entry)}>{entry.id}</button>);\n};\n',
    },
  },
  {
    name: "tuple channels setter mixed opaque writer declines",
    count: 0,
    edits: [],
    files: {
      "query.tsx":
        'import { useEffect, useState } from "react";\nimport { useChatContext } from "stream-chat-react";\nexport const Picker = () => {\n  const { client, setActiveChannel } = useChatContext();\n  const [entries, setEntries] = useState([]);\n  useEffect(() => {\n    const load = async () => {\n      const request = client.queryChannels({});\n      const [items] = await Promise.all([request]);\n      setEntries(items);\n      setEntries(acquire());\n    };\n    load();\n  }, []);\n  return entries.map(entry => <button onClick={() => setActiveChannel(entry)}>{entry.id}</button>);\n};\n',
    },
  },
  {
    name: "tuple channels setter escape declines",
    count: 0,
    edits: [],
    files: {
      "query.tsx":
        'import { useEffect, useState } from "react";\nimport { useChatContext } from "stream-chat-react";\nexport const Picker = () => {\n  const { client, setActiveChannel } = useChatContext();\n  const [entries, setEntries] = useState([]);\n  useEffect(() => {\n    const load = async () => {\n      const request = client.queryChannels({});\n      const [items] = await Promise.all([request]);\n      setEntries(items);\n      external(setEntries);\n    };\n    load();\n  }, []);\n  return entries.map(entry => <button onClick={() => setActiveChannel(entry)}>{entry.id}</button>);\n};\n',
    },
  },
  {
    name: "reflected global Promise replacement declines",
    count: 0,
    edits: [],
    files: {
      "poison.ts":
        'Object.defineProperty(window, "Promise", { value: { all: async () => [[{ update: async () => {} }]] } });\n',
    },
  },
  {
    name: "readonly global object alias cannot escape into reflection",
    count: 0,
    edits: [],
    files: {
      "poison.ts":
        'const root = self; Object.defineProperty(root, "Promise", { value: replacement });\n',
    },
  },
  {
    name: "raw global object cannot escape to unknown configurator",
    count: 0,
    edits: [],
    files: {
      "poison.ts": "configure(window);\n",
    },
  },
  {
    name: "ordinary native reload does not escape global object",
    count: 1,
    edits: [],
    files: {
      "reload.ts": "export const reload = () => window.location.reload();\n",
    },
  },
  {
    name: "unused JSX provider expression is not a returned publication",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "export const Application = () => <Chat client={connection}><Panel /></Chat>;",
        after:
          "export const Application = () => { <Chat client={connection}><Panel /></Chat>; return null; };",
      },
    ],
    files: {},
  },
  {
    name: "ordinary returned component wrapper establishes provider path",
    count: 1,
    edits: [
      {
        file: "application.tsx",
        before: "export const Application = () => <Chat client={connection}><Panel /></Chat>;",
        after:
          "const Wrapper = () => { return <Panel />; };\nexport const Application = () => { return <Chat client={connection}><Wrapper /></Chat>; };",
      },
    ],
    files: {},
  },
  {
    name: "nonfinal sequence provider JSX is discarded",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "export const Application = () => <Chat client={connection}><Panel /></Chat>;",
        after:
          "export const Application = () => { return (<Chat client={connection}><Panel /></Chat>, null); };",
      },
    ],
    files: {},
  },
  {
    name: "void provider JSX is discarded",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "export const Application = () => <Chat client={connection}><Panel /></Chat>;",
        after:
          "export const Application = () => { return void <Chat client={connection}><Panel /></Chat>; };",
      },
    ],
    files: {},
  },
  {
    name: "final sequence provider JSX preserves returned value",
    count: 1,
    edits: [
      {
        file: "application.tsx",
        before: "export const Application = () => <Chat client={connection}><Panel /></Chat>;",
        after:
          "export const Application = () => { return (null, <Chat client={connection}><Panel /></Chat>); };",
      },
    ],
    files: {},
  },
  {
    name: "provider JSX used as logical test is not returned",
    count: 0,
    edits: [
      {
        file: "application.tsx",
        before: "export const Application = () => <Chat client={connection}><Panel /></Chat>;",
        after:
          "export const Application = () => { return <Chat client={connection}><Panel /></Chat> && null; };",
      },
    ],
    files: {},
  },
  {
    name: "canonical data-only message context import is ordinary",
    count: 1,
    edits: [],
    files: {
      "message.tsx":
        'import { useMessageContext } from "stream-chat-react"; export const Message = () => { const {message}=useMessageContext(); return <span>{message.text}</span>; };\n',
    },
  },
  {
    name: "message context import binding replacement declines",
    count: 0,
    edits: [],
    files: {
      "message.ts":
        'import { useMessageContext } from "stream-chat-react"; useMessageContext = replacement;\n',
    },
  },
  {
    name: "canonical client direct truthiness test is readonly",
    count: 1,
    edits: [],
    files: {
      "guard.tsx":
        'import { useChatContext } from "stream-chat-react"; export const Guard = () => { const {client}=useChatContext(); if(client) return <span>Ready</span>; return null; };\n',
    },
  },
  {
    name: "canonical selected channel direct and negated tests are readonly",
    count: 1,
    edits: [
      {
        file: "editor.tsx",
        before: "  const save =",
        after: "  if (!channel) return null;\n  if (channel) void label;\n  const save =",
      },
    ],
    files: {},
  },
  {
    name: "canonical client conditional test is readonly",
    count: 1,
    edits: [],
    files: {
      "guard.tsx":
        'import { useChatContext } from "stream-chat-react"; export const Guard = () => { const {client}=useChatContext(); return client ? <span>Ready</span> : null; };\n',
    },
  },
  {
    name: "negated canonical client can only expose a boolean",
    count: 1,
    edits: [],
    files: {
      "guard.tsx":
        'import { useChatContext } from "stream-chat-react"; export const Guard = () => { const {client}=useChatContext(); inspect(!client); return null; };\n',
    },
  },
  {
    name: "raw canonical client escape remains unsupported",
    count: 0,
    edits: [],
    files: {
      "guard.tsx":
        'import { useChatContext } from "stream-chat-react"; export const Guard = () => { const {client}=useChatContext(); inspect(client); return null; };\n',
    },
  },
  {
    name: "cyclic own aliases do not invent channel origin",
    count: 0,
    edits: [],
    files: {
      "publisher.tsx":
        'import { useChatContext } from "stream-chat-react"; const first=second; const second=first; export const Publish=()=>{const {setActiveChannel}=useChatContext();setActiveChannel(first);return null;};\n',
    },
  },
  {
    name: "literal sibling facts separate channel and data inputs",
    count: 1,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE,
    },
  },
  {
    name: "literal tag does not assert fake input is canonical channel",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        '<Row item={item} kind="room" publish={publish} client={client} />',
        '<Row item={{ update: async () => {} }} kind="room" publish={publish} client={client} />',
      ),
    },
  },
  {
    name: "unguarded mixed activation is not specialized",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        '  if (kind === "room") {',
        '  publish(item);\n  if (kind === "room") {',
      ),
    },
  },
  {
    name: "canonical channel cannot be called as a function under a literal tag",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        "onClick={() => publish(item)}",
        "onClick={() => item()}",
      ),
    },
  },
  {
    name: "mixed publication unknown tag remains incomplete",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        '<Row item={item} kind="room" publish={publish} client={client} />',
        "<Row item={item} kind={runtimeKind} publish={publish} client={client} />",
      ),
    },
  },
  {
    name: "mixed publication duplicate tag remains incomplete",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        '<Row item={item} kind="room" publish={publish} client={client} />',
        '<Row item={item} kind="person" kind="room" publish={publish} client={client} />',
      ),
    },
  },
  {
    name: "mixed publication unknown spread remains incomplete",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        '<Row item={item} kind="room" publish={publish} client={client} />',
        '<Row item={item} {...unknownProps} kind="room" publish={publish} client={client} />',
      ),
    },
  },
  {
    name: "mixed publication known tag followed by unknown spread remains incomplete",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        '<Row item={item} kind="room" publish={publish} client={client} />',
        '<Row item={item} kind="room" {...unknownProps} publish={publish} client={client} />',
      ),
    },
  },
  {
    name: "readonly tag binding is required",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        '  if (kind === "room") {',
        '  kind = "room";\n  if (kind === "room") {',
      ),
    },
  },
  {
    name: "data branch cannot directly activate unknown item",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        'const fresh = client.channel("team", { members: [item.id] }); publish(fresh);',
        "publish(item);",
      ),
    },
  },
  {
    name: "canonical channel alias cannot escape specialized closure",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        "onClick={() => publish(item)}",
        "onClick={() => { const borrowed = item; external(borrowed); publish(item); }}",
      ),
    },
  },
  {
    name: "nonterminal preceding branch cannot skip channel references",
    count: 0,
    edits: [],
    files: {
      "mixed.tsx": STREAM_CHANNEL_MIXED_PUBLICATION_SOURCE.replace(
        "return <button onClick={() => publish(item)}>{item.id}</button>;",
        "void kind;",
      ).replace(
        'const fresh = client.channel("team", { members: [item.id] }); publish(fresh);',
        'const fresh = client.channel("team", { members: [item.id] }); publish(item);',
      ),
    },
  },
  {
    name: "genuine React effect dependency read preserves canonical client",
    count: 1,
    edits: [],
    files: {
      "dependencies.tsx":
        'import { useEffect } from "react"; import { useChatContext } from "stream-chat-react"; export const Dependencies = () => { const { client } = useChatContext(); useEffect(() => { void client.userID; }, [client]); return null; };\n',
    },
  },
  {
    name: "own fake effect dependency array cannot receive canonical client",
    count: 0,
    edits: [],
    files: {
      "dependencies.tsx":
        'import { useChatContext } from "stream-chat-react"; const useEffect = (callback, dependencies) => inspect(dependencies); export const Dependencies = () => { const { client } = useChatContext(); useEffect(() => { void client.userID; }, [client]); return null; };\n',
    },
  },
];
const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-stream-mutation-"));
const owner = path.join(directory, "editor.tsx");
beforeEach(() => {
  for (const entry of fs.readdirSync(directory))
    fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  for (const [name, body] of Object.entries(BASE_FILES))
    fs.writeFileSync(path.join(directory, name), body);
  resetFilesystemCaches();
});
afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});
describe("canonical SDK channel mutation", () => {
  for (const fixture of cases)
    it(fixture.name, () => {
      const files: Record<string, string> = { ...BASE_FILES, ...fixture.files };
      for (const edit of fixture.edits) {
        expect(files[edit.file]).toContain(edit.before);
        files[edit.file] = files[edit.file].replaceAll(edit.before, edit.after);
      }
      for (const [name, body] of Object.entries(files))
        fs.writeFileSync(path.join(directory, name), body);
      resetFilesystemCaches();
      const result = runRule(noAsyncEventHandlerWithoutReentryGuard, files["editor.tsx"], {
        filename: owner,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.count);
    });
  it("refreshes same namespace provider poison across normal filesystem epochs", () => {
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["editor.tsx"], { filename: owner })
        .diagnostics,
    ).toHaveLength(1);
    const poison = path.join(directory, "poison.ts");
    fs.writeFileSync(
      poison,
      'import { StreamChat as Factory } from "stream-chat"; Factory.getInstance = replacement;',
    );
    resetFilesystemCaches();
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["editor.tsx"], { filename: owner })
        .diagnostics,
    ).toEqual([]);
    fs.rmSync(poison);
    resetFilesystemCaches();
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["editor.tsx"], { filename: owner })
        .diagnostics,
    ).toHaveLength(1);
  });
});
