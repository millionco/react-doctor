// One positive-control fixture per registered rule: a minimal snippet the
// rule MUST report at least one finding on (see liveness.test.ts). Most
// snippets are lifted from the rule's own unit tests; the rest are the
// rule's canonical bad example, hand-written from its detection logic.
// `filePath` doubles as `filename` for AST rules and `relativePath` for
// scan rules.
export interface LivenessFixture {
  code: string;
  filePath?: string;
  settings?: Readonly<Record<string, unknown>>;
  forceJsx?: boolean;
  isGeneratedBundle?: boolean;
}

// Assembled at runtime so the canonical Stripe example key never appears as a
// contiguous literal — GitHub push protection rejects the raw token.
const stripeLiveSecretKey = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");

const giantComponentStatementCount = 301;

const giantComponentCode = [
  "function GiantComponent() {",
  ...Array.from(
    { length: giantComponentStatementCount },
    (_, statementIndex) => `  const value${statementIndex} = ${statementIndex};`,
  ),
  "  return <main />;",
  "}",
].join("\n");

const reactRouterFrameworkSettings = {
  "react-doctor": { capabilities: ["react-router-framework"] },
};

const reactRouterFrameworkRouteFixture = {
  filePath: "/project/app/routes/dashboard.tsx",
  settings: reactRouterFrameworkSettings,
};

export const livenessFixtures: Readonly<Record<string, LivenessFixture>> = {
  "active-static-asset": {
    code: '<svg xmlns="http://www.w3.org/2000/svg">\n  <script>alert(1)</script>\n</svg>\n',
    filePath: "public/logo.svg",
  },
  "activity-wraps-effect-heavy-subtree": {
    code: '\n      import { Activity, useEffect } from "react";\n      const EditProfileSheet = ({ user }) => {\n        useEffect(() => { subscribe(user.id); return () => unsubscribe(user.id); }, [user.id]);\n        useEffect(() => { trackOpen(user.id); }, [user.id]);\n        return null;\n      };\n      const Screen = ({ open, user }) => (\n        <Activity mode={open ? "visible" : "hidden"}>\n          <EditProfileSheet user={user} />\n        </Activity>\n      );\n    ',
  },
  "advanced-event-handler-refs": {
    code: "function C({ onResize }) {\n        useEffect(() => {\n          window.addEventListener('resize', onResize);\n          return () => window.removeEventListener('resize', onResize);\n        }, [onResize]);\n        return null;\n      }",
  },
  "agent-tool-capability-risk": {
    code: 'import { tool } from "ai";\nimport { exec } from "node:child_process";\nexport const runCommand = tool({\n  description: "Run a shell command on the host.",\n  inputSchema: z.object({ command: z.string() }),\n  execute: async ({ command }) => exec(command),\n});\n',
    filePath: "src/agents/tools/run-command.ts",
  },
  "alt-text": {
    code: 'export const Page = () => <div><img src="/bg.png" /></div>;',
    filePath: "/proj/app/page.tsx",
  },
  "anchor-ambiguous-text": {
    code: '<a href="/pricing">click here</a>',
    filePath: "src/components/pricing-banner.tsx",
  },
  "anchor-has-content": {
    code: 'const A = () => <a href="/p" />;',
  },
  "anchor-is-valid": {
    code: 'const B = () => <a href="#" onClick={go}>Go</a>;',
  },
  "aria-activedescendant-has-tabindex": {
    code: '<div contentEditable="false" aria-activedescendant={activeId} />',
  },
  "aria-props": {
    code: '<div aria-="foobar" />',
    forceJsx: true,
  },
  "aria-proptypes": {
    code: '<div aria-hidden="yes" />',
    forceJsx: true,
  },
  "aria-role": {
    code: 'export const A = () => <div role="datepicker" />;',
  },
  "aria-unsupported-elements": {
    code: "<base role {...props} />",
    forceJsx: true,
  },
  "artifact-baas-authority-surface": {
    code: 'var firebaseConfig={apiKey:"AIzaSyXXXXXXXXXXXXXXXXXXX",authDomain:"x.firebaseapp.com",projectId:"x"};initializeApp(firebaseConfig);collection("users");var u={isAdmin:true};',
    filePath: "dist/assets/index-def456.js",
    isGeneratedBundle: true,
  },
  "artifact-env-leak": {
    code: 'const config = { key: "NEXT_PUBLIC_SERVICE_ROLE_SECRET" };',
    filePath: "dist/assets/index-abc123.js",
    isGeneratedBundle: true,
  },
  "artifact-secret-leak": {
    code: `const stripe = Stripe("${stripeLiveSecretKey}");`,
    filePath: "dist/assets/index-abc123.js",
  },
  "async-await-in-loop": {
    code: "async function f(urls) { for (let i = 0; i < urls.length; i++) { await fetch(urls[i]); } }",
  },
  "async-defer-await": {
    code: "\n      declare const fetchRows: () => Promise<string[]>;\n      declare const shouldSkip: boolean;\n      export const load = async () => {\n        const rows = await fetchRows();\n        if (shouldSkip) return [];\n        return rows;\n      };\n    ",
  },
  "async-parallel": {
    code: "async function load(){ const a = await getA(); const b = await getB(); const c = await getC(); }",
  },
  "auth-token-in-web-storage": {
    code: 'localStorage.setItem("authToken", t);\nsessionStorage.setItem("accessToken", a);',
  },
  "autocomplete-valid": {
    code: 'const F = () => <input type="text" autoComplete="foo" />;',
  },
  "build-pipeline-secret-boundary": {
    code: "jobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: pnpm install\n        env:\n          FIREBASE_ADMIN_KEY: ${{ secrets.FIREBASE_ADMIN_KEY }}\n",
    filePath: ".github/workflows/release.yml",
  },
  "button-has-type": {
    code: "<button type />",
  },
  "checked-requires-onchange-or-readonly": {
    code: 'const C = ({ checked, locked }) => <input type="checkbox" checked={checked} disabled={locked} />;',
  },
  "click-events-have-key-events": {
    code: "export const A = ({ fileInputRef }) => (\n        <div onClick={() => fileInputRef.current?.click()} />\n      );",
  },
  "clickjacking-redirect-risk": {
    code: 'export const GET = (request) => redirect(request.nextUrl.searchParams.get("next"));\n',
    filePath: "src/redirect.ts",
  },
  "client-localstorage-no-version": {
    code: 'localStorage.setItem("userPrefs", JSON.stringify(prefs));',
  },
  "client-passive-event-listeners": {
    code: "let ticking = false;\nconst onDocumentWheel = (callback) => {\n  document.addEventListener('wheel', (evt) => {\n    if (!ticking) {\n      window.requestAnimationFrame(() => {\n        callbacks.forEach((cbObj) => cbObj.cb._execute(evt));\n        ticking = false;\n      });\n      ticking = true;\n    }\n  });\n};",
  },
  "command-execution-input-risk": {
    code: 'import { exec } from "node:child_process";\n\napp.post("/convert", (req, res) => {\n  exec("convert " + req.body.filename, handleResult);\n});\n',
    filePath: "src/server/convert.ts",
  },
  "class-component-missing-component-will-unmount-teardown": {
    code: "class Clock extends React.PureComponent { componentDidMount() { setInterval(() => this.tick(), 1000); } render() { return null; } }",
  },
  "context-provider-value-from-unmemoized-local-literal": {
    code: 'import { createContext } from "react"; const Ctx = createContext(null); function App() { const value = {}; return <Ctx.Provider value={value} />; }',
  },
  "control-has-associated-label": {
    code: '\n        const Demo = () => {\n          const fieldId = "amount";\n\n          return (\n            <div>\n              <FieldShell renderLabel={() => <label htmlFor={fieldId}>Amount</label>} />\n              <input id={fieldId} name="amount" type="number" />\n            </div>\n          );\n        };\n      ',
  },
  "cors-cookie-trust-risk": {
    code: 'res.setHeader("Access-Control-Allow-Credentials", "true");\nres.setHeader("Access-Control-Allow-Origin", "*");\n',
    filePath: "src/server/cors.ts",
  },
  "dangerous-html-sink": {
    code: "export const Raw = ({ unsafeHtml }: Props) => (\n  <div dangerouslySetInnerHTML={{ __html: unsafeHtml }} />\n);\n",
    filePath: "src/components/raw.tsx",
  },
  "design-no-em-dash-in-jsx-text": {
    code: "const C = () => <p>It's fast — blazingly fast — and simple to use.</p>;",
  },
  "design-no-redundant-padding-axes": {
    code: 'const El = () => <div className="px-4 py-4" />;',
  },
  "design-no-redundant-size-axes": {
    code: 'const C = () => (\n        <div>\n          <svg className="w-4 h-4" />\n          <svg className="w-4 h-4" />\n          <svg className="w-6 h-6" />\n          <img className="h-8 w-8" />\n        </div>\n      );',
  },
  "design-no-space-on-flex-children": {
    code: 'const El = () => <div className="flex space-x-4"><span /><span /></div>;',
  },
  "design-no-three-period-ellipsis": {
    code: "const El = () => <button>Loading...</button>;",
  },
  "design-no-vague-button-label": {
    code: "const El = () => <button>Click here</button>;",
  },
  "dialog-has-accessible-name": {
    code: "const M = () => <dialog open><p>Body</p></dialog>;",
  },
  "display-name": {
    code: '\n                    var Hello = createReactClass({\n                      render: function() {\n                        return React.createElement("div", {}, "text content");\n                      }\n                    });\n                  ',
    settings: { "react-doctor": { displayName: { ignoreTranspilerName: true } } },
    forceJsx: true,
  },
  "debounce-no-cleanup": {
    code: "import { debounce } from 'lodash'; function Title({ title }) { const apply = useMemo(() => debounce((value) => { document.title = value; }, 300), []); useEffect(() => { apply(title); }, [title, apply]); }",
  },
  "effect-listener-cleanup-mismatch": {
    code: 'import { useEffect } from "react";\nexport const Listener = () => {\n  useEffect(() => {\n    window.addEventListener("resize", () => resize());\n    return () => window.removeEventListener("resize", () => resize());\n  }, []);\n  return null;\n};',
  },
  "effect-listener-cleanup-reference-mismatch": {
    code: "useEffect(() => { appEvent.subscribe((event) => handle(event)); return () => appEvent.unsubscribe((event) => handle(event)); }, []);",
  },
  "effect-needs-cleanup": {
    code: 'import { useEffect } from "react";\nexport const WatchForm = ({ form }) => {\n  useEffect(() => form.watch((value) => {\n    console.log(value);\n  }), [form]);\n  return null;\n};',
  },
  "effect-observer-needs-disconnect": {
    code: "useEffect(() => { const observer = new ResizeObserver(() => measure()); observer.observe(element); }, []);",
  },
  "effect-raf-loop-needs-cancel": {
    code: "useEffect(() => { requestAnimationFrame(function tick() { update(); requestAnimationFrame(tick); }); }, []);",
  },
  "effect-remove-listener-inline-handler": {
    code: "emitter.on('data', handler); emitter.off('data', (data) => process(data));",
  },
  "exhaustive-deps": {
    code: "function MyComponent(props) {\n          useCallback(() => {\n            console.log(props.foo?.toString());\n          }, []);\n        }",
    forceJsx: true,
  },
  "expo-no-non-inlined-env": {
    code: 'const url = process.env["EXPO_PUBLIC_API_URL"];',
  },
  "firebase-client-owned-authz-field": {
    code: 'import { addDoc, collection } from "firebase/firestore";\nexport const createProject = (name: string, userId: string) =>\n  addDoc(collection(db, "projects"), { name, ownerId: userId, role: "admin" });\n',
    filePath: "src/features/projects/create-project.ts",
  },
  "firebase-permissive-rules": {
    code: "match /users/{uid} {\n  allow read, write: if true;\n}",
    filePath: "firestore.rules",
  },
  "firebase-query-filter-as-auth": {
    code: 'const q = db.collection("documents").where("uid", "==", user.uid);\n',
    filePath: "src/hooks/use-docs.ts",
  },
  "forbid-component-props": {
    code: '\n                    var First = createReactClass({\n                      propTypes: externalPropTypes,\n                      render: function() {\n                        return <Foo className="bar" />;\n                      }\n                    });\n                  ',
    settings: { "react-doctor": { forbidComponentProps: { forbid: ["className", "style"] } } },
    forceJsx: true,
  },
  "forbid-dom-props": {
    code: '\n                    var First = createReactClass({\n                      propTypes: externalPropTypes,\n                      render: function() {\n                        return <div id="bar" />;\n                      }\n                    });\n                  ',
    settings: { "react-doctor": { forbidDomProps: { forbid: ["id"] } } },
    forceJsx: true,
  },
  "forbid-elements": {
    code: "<button />",
    settings: { "react-doctor": { forbidElements: { forbid: ["button"] } } },
    forceJsx: true,
  },
  "forward-ref-uses-ref": {
    code: "\n\t\t\t        import { forwardRef } from 'react'\n\t\t\t        forwardRef((props) => {\n\t\t\t          return null;\n\t\t\t        });\n\t\t\t      ",
    forceJsx: true,
  },
  "git-provider-url-injection-risk": {
    code: "const apiUrl = `https://api.github.com/repos/${req.query.owner}/${req.query.repo}`;\n",
    filePath: "src/server/repos.ts",
  },
  "heading-has-content": {
    code: "const H = () => <h1 />;",
  },
  "hook-import-rename-loses-use-prefix": {
    code: 'import { useEffect as runEffect } from "react";\nconst App = () => { runEffect(() => {}, []); return null; };',
  },
  "jsx-numeric-and-leaked-render": {
    code: "const C = ({ count }) => <div>{(count - 1) && <More />}</div>;",
  },
  "hook-use-state": {
    code: "\n            import React from 'react';\n            export default function useColor() {\n                const color = React.useState();\n                return color;\n            }",
    forceJsx: true,
  },
  "hooks-no-nan-in-deps": {
    code: '\n      import { useEffect } from "react";\n      const Comp = () => {\n        useEffect(() => { doStuff(); }, [NaN]);\n        return null;\n      };\n      ',
  },
  "html-has-lang": {
    code: "<html />;",
    forceJsx: true,
  },
  "html-no-invalid-paragraph-child": {
    code: "\n      const Card = () => (\n        <p>\n          <div>oops</div>\n        </p>\n      );\n      ",
  },
  "html-no-invalid-table-nesting": {
    code: "\n      const Bad = () => (\n        <table>\n          <tbody>\n            <tr>\n              <table><tbody><tr><td>x</td></tr></tbody></table>\n            </tr>\n          </tbody>\n        </table>\n      );\n      ",
  },
  "html-no-nested-interactive": {
    code: '\n      const Card = () => (\n        <a href="/outer">\n          <a href="/inner">Inner</a>\n        </a>\n      );\n      ',
  },
  "iframe-has-title": {
    code: "<iframe {...props} />",
    forceJsx: true,
  },
  "iframe-missing-sandbox": {
    code: 'const Frame = (rest) => <iframe {...rest} src="https://third-party.example" />;',
  },
  "img-redundant-alt": {
    code: 'export const Page = () => <img src="/bg.png" alt="Image of a product card" />;',
    filePath: "/proj/app/page.tsx",
  },
  "import-metadata-execution-risk": {
    code: 'import { exec } from "node:child_process";\n\nexport const importArchive = (uploadPath: string) => {\n  exec(`unzip ${uploadPath} -d /tmp/import`);\n};\n',
    filePath: "src/server/import.ts",
  },
  "insecure-crypto-risk": {
    code: 'import { createHash } from "node:crypto";\n\nexport const hashPassword = (password: string) =>\n  createHash("md5").update(password).digest("hex");\n',
    filePath: "src/server/auth.ts",
  },
  "ink-ctrl-c-handler-requires-exit-option": {
    code: 'import {render,useInput} from "ink";const App=()=>{useInput((input,key)=>{if(key.ctrl&&input==="c")work()});return null};render(<App/>);',
  },
  "ink-no-bare-process-exit": {
    code: 'import {useInput} from "ink";const App=()=>{useInput(()=>process.exit(0));return null};',
  },
  "ink-no-direct-raw-mode": {
    code: 'import {useStdin} from "ink";const App=()=>{const {setRawMode}=useStdin();setRawMode(true);return null};',
  },
  "ink-no-dom-host-elements": {
    code: 'import {Box} from "ink";const App=()=> <Box><div/></Box>;',
  },
  "ink-no-dom-router": {
    code: 'import {Box} from "ink";import {Link} from "react-router-dom";const App=()=> <Box><Link to="/"/></Box>;',
  },
  "ink-no-focus-in-render": {
    code: 'import {useFocusManager} from "ink";const App=()=>{const manager=useFocusManager();manager.focus("name");return null};',
  },
  "ink-no-layout-inside-text": {
    code: 'import {Box,Text} from "ink";const App=()=> <Text><Box/></Text>;',
  },
  "ink-no-live-hooks-in-render-to-string": {
    code: 'import {renderToString,useInput} from "ink";const App=()=>{useInput(()=>{});return null};renderToString(<App/>);',
  },
  "ink-no-measure-element-in-render": {
    code: 'import {measureElement} from "ink";const App=({node})=>{measureElement(node);return null};',
  },
  "ink-no-multiple-static": {
    code: 'import {Static} from "ink";const App=()=> <><Static items={[]}/><Static items={[]}/></>;',
  },
  "ink-no-raw-text": {
    code: 'import {Box} from "ink";const App=()=> <Box>hello</Box>;',
  },
  "ink-no-repeated-render": {
    code: 'import {render} from "ink";render(null);render(null);',
  },
  "ink-prefer-use-animation": {
    code: 'import {useEffect,useState} from "react";import {Text} from "ink";const App=()=>{const [frame,setFrame]=useState(0);useEffect(()=>{const timer=setInterval(()=>setFrame(value=>value+1),80);return()=>clearInterval(timer)},[]);return <Text>{frame}</Text>};',
  },
  "ink-prefer-use-paste": {
    code: 'import {useInput} from "ink";const App=()=>{useInput(input=>{if(input.includes("\\n"))paste(input)});return null};',
  },
  "ink-static-is-append-only": {
    code: 'import {Static} from "ink";const App=({items})=> <Static items={items.toReversed()}/>;',
  },
  "ink-static-requires-key": {
    code: 'import {Static,Text} from "ink";const App=({items})=> <Static items={items}>{item=><Text>{item}</Text>}</Static>;',
  },
  "ink-use-reactive-window-size": {
    code: 'import {Text} from "ink";const App=()=> <Text>{process.stdout.columns}</Text>;',
  },
  "ink-use-string-width-for-cursor": {
    code: 'import {useCursor} from "ink";const App=({label})=>{const cursor=useCursor();cursor.setCursorPosition({x:label.length,y:0});return null};',
  },
  "ink-use-suspend-terminal": {
    code: 'import {useInput} from "ink";import {spawn} from "node:child_process";const App=()=>{useInput(()=>spawn("vim",[],{stdio:"inherit"}));return null};',
  },
  "ink-valid-aria-semantics": {
    code: 'import {Text} from "ink";const App=()=> <Text aria-role="dialog">open</Text>;',
  },
  "insecure-session-cookie": {
    code: 'res.cookie("session_token", token, { httpOnly: false, secure: false });\n',
    filePath: "src/server/session.ts",
  },
  "interactive-supports-focus": {
    code: 'const X = (p) => <div role="button" onClick={p.onPress} />;',
  },
  "jotai-derived-atom-returns-fresh-object": {
    code: 'import { atom } from "jotai"; const a = atom((get) => get(itemsAtom).slice().sort());',
  },
  "jotai-select-atom-in-render-body": {
    code: "import { selectAtom } from 'jotai/utils'; const MyComp = () => { const d = selectAtom(baseAtom, (s) => s.value); return useAtomValue(d); };",
  },
  "jotai-tq-use-raw-query-atom": {
    code: "import { atomWithQuery } from 'jotai-tanstack-query'; import { useAtomValue } from 'jotai'; const userAtom = atomWithQuery(() => ({ queryKey: ['u'] })); function C() { return useAtomValue(userAtom); }",
  },
  "js-async-reduce-without-awaited-acc": {
    code: "\n      const build = async (items) =>\n        items.reduce(async (acc, item) => {\n          acc[item.id] = await getItem(item);\n          return acc;\n        }, {});\n    ",
  },
  "js-batch-dom-css": {
    code: '\nfunction resizeRows(rows) {\n  for (const row of rows) {\n    const height = row.offsetHeight;\n    row.style.height = `${height}px`;\n    row.style.background = "red";\n  }\n}\n',
  },
  "js-cache-property-access": {
    code: "function f(state, results, n) { for (let i = 0; i < n; i++) { results.push(state.counter.value); results.push(state.counter.value); results.push(state.counter.value); } }",
  },
  "js-cache-storage": {
    code: 'function f(){ const a = localStorage.getItem("t"); const b = localStorage.getItem("t"); return a === b; }',
  },
  "js-combine-iterations": {
    code: "const r = rows.filter((r) => r !== headerRow).map((r) => bodyRows.indexOf(r)).filter((i) => i >= 0);",
  },
  "js-early-exit": {
    code: "function handle(a, b, c, d) {\n      if (a) {\n        if (b) {\n          if (c) {\n            if (d) {\n              run();\n            }\n          }\n        }\n      }\n    }",
  },
  "js-flatmap-filter": {
    code: "const result = items.map((item) => item.value).filter(Boolean);",
  },
  "js-hoist-intl": {
    code: "function fmt(locale, n) { return new Intl.NumberFormat(locale).format(n); }",
  },
  "js-hoist-regexp": {
    code: 'for (const line of lines) { const m = new RegExp("\\\\d+", "i"); m.test(line); }',
  },
  "js-index-maps": {
    code: "function g(ids, users){ const out=[]; for(const id of ids){ out.push(users.find((u)=> u.id === id)); } return out; }",
  },
  "js-length-check-first": {
    code: "function arraysEqual(a, b) {\n      return a.every((value, index) => value === b[index]);\n    }",
  },
  "js-min-max-loop": {
    code: "const smallest = [3, 1, 2].sort((a, b) => a - b)[0];",
  },
  "js-set-map-lookups": {
    code: "function f(users: Array<{ role: string }>, roles: string[]){ const a=[]; for(const u of users){ if(roles.includes(u.role)) a.push(u);} return a; }",
  },
  "js-tosorted-immutable": {
    code: "const arr = getItems();\nconst s = [...arr].sort();",
  },
  "jsx-boolean-value": {
    code: "<App foo={true} />;",
    settings: { "react-doctor": { jsxBooleanValue: { mode: "never" } } },
    forceJsx: true,
  },
  "jsx-curly-brace-presence": {
    code: "<App prop={`foo`} />",
    settings: { "react-doctor": { jsxCurlyBracePresence: { props: "never" } } },
    forceJsx: true,
  },
  "jsx-filename-extension": {
    code: "module.exports = function MyComponent() { return <div>\n<div />\n</div>; }",
    filePath: "foo.js",
    forceJsx: true,
  },
  "jsx-fragments": {
    code: "<Fragment><Foo /></Fragment>",
    forceJsx: true,
  },
  "jsx-handler-names": {
    code: "<TestComponent onChange={this.doSomethingOnChange} />",
    forceJsx: true,
  },
  "jsx-key": {
    code: "[<App />];",
    forceJsx: true,
  },
  "jsx-max-depth": {
    code: "\n\t\t\t        <App>\n\t\t\t          <foo />\n\t\t\t        </App>\n\t\t\t      ",
    settings: { "react-doctor": { jsxMaxDepth: { max: 0 } } },
    forceJsx: true,
  },
  "jsx-no-comment-textnodes": {
    code: "function Note({ value }) { return <div>{value} // visible to users</div>; }",
  },
  "jsx-no-constructed-context-values": {
    code: '\n      import { createContext } from "react";\n\n      const MyCtx = createContext(null);\n\n      function App() {\n        return <MyCtx value={{ a: 1, b: 2 }} />;\n      }\n    ',
    filePath: "fixture.jsx",
  },
  "jsx-no-duplicate-props": {
    code: "<App a a />;",
    forceJsx: true,
  },
  "jsx-no-jsx-as-prop": {
    code: 'import { memo } from "react";\nimport { Box, Text } from "ink";\nconst StatusBar = memo(({ total, unreadCount, keyHints, exitHint }) => (\n  <Text>\n    {total} issues, {unreadCount} unread {keyHints} {exitHint}\n  </Text>\n));\nconst DiagnosticList = ({ isMenuOpen }) => {\n  const keyHints = isMenuOpen ? (\n    <>\n      <Text dimColor>{"up/down select"}</Text>\n    </>\n  ) : (\n    <>\n      <Text dimColor>{"up/down move"}</Text>\n    </>\n  );\n  return (\n    <Box marginTop={1}>\n      <StatusBar total={12} unreadCount={3} keyHints={keyHints} exitHint="q quit" />\n    </Box>\n  );\n};',
  },
  "jsx-no-new-array-as-prop": {
    code: 'import { memo } from "react";\nconst Item = memo(() => null);\nconst Foo = () => <Item payload={[1, 2]} />;',
  },
  "jsx-no-new-function-as-prop": {
    code: 'import { memo } from "react";\nconst Item = memo(() => null);\nconst Foo = () => <Item prop={() => true} />;',
  },
  "jsx-no-new-object-as-prop": {
    code: 'import { memo } from "react";\nconst Item = memo(() => null);\nconst Foo = () => <Item foo={{ a: 1 }} />;',
  },
  "jsx-no-script-url": {
    code: 'const A = () => <a href="javascript:void(0)">x</a>;',
  },
  "jsx-no-target-blank": {
    code: 'const A = () => <a href="https://example.com" target="_blank">x</a>;',
    settings: {
      "react-doctor": { capabilities: ["target-blank-needs-explicit-protection"] },
    },
  },
  "jsx-no-undef": {
    code: "\n        interface Foo {}\n        type Bar = {};\n        const App = () => <><Foo /><Bar /></>;\n      ",
  },
  "jsx-no-useless-fragment": {
    code: "<></>",
    forceJsx: true,
  },
  "jsx-pascal-case": {
    code: "<X.bad_name />",
  },
  "jsx-props-no-spread-multi": {
    code: "\n          const props = {};\n          <App {...props} {...props} />\n        ",
    forceJsx: true,
  },
  "jsx-props-no-spreading": {
    code: "const One = (props) => <Button {...props} />;\n      const Two = (props) => <Card {...props} />;\n      const Three = (props) => <input {...props} />;",
  },
  "jwt-insecure-verification": {
    code: 'import jwt from "jsonwebtoken";\nconst payload = jwt.verify(token, secret, { algorithms: ["none"] });\n',
    filePath: "src/server/auth.ts",
  },
  "key-lifecycle-risk": {
    code: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7c1QpDK0N77BSO0FbGCPzcgMCS8ssCXd2eicCRb45fJsbiCe\nahGd0WOZHCSpwHcwgvT5ml0zXmkSO0Iqcm8m3aIp7DJBkLAA1MuYjvVLPyEDqGtR\n-----END RSA PRIVATE KEY-----\n",
    filePath: "config/deploy.pem",
  },
  "label-has-associated-control": {
    code: '\n        const FieldGroup = ({ label, children }) => (\n          <div>\n            <label className="block text-xs text-gray-500 uppercase mb-2">{label}</label>\n            {children}\n          </div>\n        );\n      ',
  },
  lang: {
    code: '<html lang="foo" />',
  },
  "local-rpc-native-bridge-risk": {
    code: 'const socket = new WebSocket("ws://127.0.0.1:9001");\nsocket.onmessage = ({ data }) => {\n  exec(JSON.parse(data).command);\n};\n',
    filePath: "src/bridge.ts",
  },
  "mcp-tool-capability-risk": {
    code: 'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nconst server = new McpServer({ name: "x", version: "1" });\nserver.tool("run", async ({ cmd }) => {\n  return execSync(cmd);\n});',
    filePath: "src/mcp/tools.ts",
  },
  "mdx-ssr-execution-risk": {
    code: 'import { compileMDX } from "next-mdx-remote/rsc";\n\nconst { content } = await compileMDX({ source: tenantDocumentSource });\n',
    filePath: "src/app/docs/page.tsx",
  },
  "media-has-caption": {
    code: 'const V = () => <video src="movie.mp4" />;',
  },
  "mobx-no-make-auto-observable-in-inheritance": {
    code: 'import { makeAutoObservable } from "mobx";\nclass ChildStore extends BaseStore { constructor() { super(); makeAutoObservable(this); } }',
  },
  "mobx-no-observer-wrapped-memo": {
    code: 'import { memo } from "react";\nimport { observer } from "mobx-react-lite";\nexport const Profile = observer(memo(ProfileView));',
    settings: {
      "react-doctor": { capabilities: ["mobx-react-lite-observer-memo-guard"] },
    },
  },
  "mobx-reaction-disposer-discarded": {
    code: 'import { reaction } from "mobx";\nclass Store { start() { reaction(() => externalStore.value, refresh); } }',
  },
  "mouse-events-have-key-events": {
    code: "<div onMouseOver={() => {}} />",
  },
  "nextjs-async-client-component": {
    code: '"use client";\nexport default async function Profile() {\n  const data = await loadProfile();\n  return <div>{data.name}</div>;\n}',
  },
  "nextjs-async-dynamic-api-not-awaited": {
    code: 'import { headers } from "next/headers";\nexport const read = () => headers().get("x-request-id");',
    filePath: "app/page.tsx",
  },
  "nextjs-error-boundary-missing-use-client": {
    code: "export default function ErrorBoundary({ error, reset }) {\n  return <div>{error.message}</div>;\n}",
    filePath: "/app/app/error.tsx",
    forceJsx: true,
  },
  "nextjs-global-error-missing-html-body": {
    code: "export default function GlobalError({ error }) {\n        return <div>{String(error)}</div>;\n      }",
    filePath: "/proj/app/global-error.tsx",
  },
  "nextjs-image-missing-sizes": {
    code: 'const C = () => <Image fill src="/a.png" alt="a" />;',
  },
  "nextjs-inline-script-missing-id": {
    code: 'const C = () => <Script>{"console.log(1)"}</Script>;',
  },
  "nextjs-missing-metadata": {
    code: "export default function Page() {\n  return <main>Home</main>;\n}",
    filePath: "app/page.tsx",
  },
  "nextjs-metadata-url-consistency": {
    code: 'export const metadata = { alternates: { canonical: "https://example.com/docs" }, openGraph: { url: "https://example.com/help" } };',
    filePath: "app/docs/page.tsx",
  },
  "nextjs-no-a-element": {
    code: 'export default function C() { return <a href="/about">About</a>; }',
    filePath: "app/page.tsx",
  },
  "nextjs-no-client-fetch-for-server-data": {
    code: '"use client";\nimport { useEffect } from "react";\nexport default function Page() {\n  useEffect(() => { fetch("/api/data"); }, []);\n  return null;\n}',
    filePath: "app/page.tsx",
  },
  "nextjs-no-client-side-redirect": {
    code: '"use client";\nimport { useEffect } from "react";\nexport default function Page() {\n  useEffect(() => { router.push("/x"); }, []);\n  return null;\n}',
    filePath: "app/page.tsx",
  },
  "nextjs-no-css-link": {
    code: 'const Head = () => <link rel="stylesheet" href="/styles.css" />;',
  },
  "nextjs-no-default-export-in-route-handler": {
    code: "export default function handler(req, res) {\n        res.json({ ok: true });\n      }",
    filePath: "/proj/app/api/hello/route.ts",
  },
  "nextjs-no-edge-og-runtime": {
    code: 'export const runtime = "edge";',
    filePath: "app/opengraph-image.tsx",
  },
  "nextjs-no-font-link": {
    code: 'export default function C() { return <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter" />; }',
    filePath: "app/layout.tsx",
  },
  "nextjs-no-google-analytics-script": {
    code: 'const a = <Script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ" />;',
  },
  "nextjs-no-head-import": {
    code: 'import Head from "next/head";',
    filePath: "/app/app/page.tsx",
    forceJsx: true,
  },
  "nextjs-no-img-element": {
    code: 'export const Hero = () => <img src="/hero.png" alt="hero" />;',
  },
  "nextjs-no-native-script": {
    code: 'const Layout = () => (\n        <head>\n          <script async blocking="render" src="https://widget.example.com/embed.js" />\n        </head>\n      );',
  },
  "nextjs-no-polyfill-script": {
    code: 'const El = () => <script src="https://polyfill.io/v3/polyfill.min.js" />;',
  },
  "nextjs-no-redirect-in-try-catch": {
    code: 'import { redirect } from "next/navigation";\nexport default async function Page() {\n  try {\n    redirect("/login");\n  } catch (e) {\n    log(e);\n  }\n}',
  },
  "nextjs-no-script-in-head": {
    code: 'export default function C() { return <Head><Script src="https://x.js" /></Head>; }',
    filePath: "pages/index.tsx",
  },
  "nextjs-no-side-effect-in-get-handler": {
    code: 'import { cookies } from "next/headers";\nexport async function GET() {\n  cookies().delete("session");\n  return Response.redirect("/");\n}',
    filePath: "app/logout/route.ts",
  },
  "nextjs-no-vercel-og-import": {
    code: 'import { ImageResponse } from "@vercel/og";',
  },
  "no-access-key": {
    code: '<button accessKey="s">Save</button>',
    filePath: "src/components/save-button.tsx",
  },
  "no-adjust-state-on-prop-change": {
    code: "function List({ items }) {\n        const [selection, setSelection] = useState(null);\n        useEffect(() => {\n          setSelection(null);\n        }, [items]);\n        return <div>{selection}</div>;\n      }",
  },
  "no-all-caps-body-text": {
    code: 'const Notice = () => <p className="uppercase">This paragraph contains enough readable copy that forcing every word into capitals makes it harder to scan.</p>;',
  },
  "no-arbitrary-px-font-size": {
    code: 'const Label = () => <p className="text-[13px]">Status</p>;',
  },
  "no-aria-hidden-on-focusable": {
    code: 'export const A = () => <button aria-hidden={true} type="button">x</button>;',
  },
  "no-arithmetic-on-optional-chained-operand": {
    code: "if (config?.limit * factor < threshold) {}",
  },
  "no-array-find-result-member-access-without-guard": {
    code: "const first = values.find(Boolean).id;",
  },
  "no-array-index-as-key": {
    code: 'const STEPS = [\n  { title: "Install", body: "npm i" },\n  { title: "Run", body: "npm start" },\n];\nconst Steps = () => (\n  <ol>\n    {STEPS.map((step, index) => (\n      <StepCard key={index} title={step.title} body={step.body} />\n    ))}\n  </ol>\n);\n',
  },
  "no-array-index-deref-without-bounds-or-empty-guard": {
    code: "const version = /v(\\d+)/.exec(input)[1].trim();",
  },
  "no-array-index-key": {
    code: "const rows = things.map((thing, index) => React.cloneElement(thing, { key: index }));",
  },
  "no-async-effect-callback": {
    code: "\n      const Profile = ({ id }) => {\n        useEffect(async () => {\n          const user = await load(id);\n          setUser(user);\n        }, [id]);\n        return null;\n      };\n      ",
  },
  "no-async-event-handler-without-reentry-guard": {
    code: 'import { useState } from "react"; const Form = () => { const [, setDone] = useState(false); return <form onSubmit={async () => { await fetch("/api/reset", { method: "PATCH" }); setDone(true); }} />; };',
  },
  "no-boolean-toggle-without-functional-update": {
    code: "const Poller=()=>{const[on,setOn]=useState(false);setTimeout(()=>setOn(!on),500)};",
  },
  "no-autofocus": {
    code: "export const SearchPage = () => (\n        <main>\n          <input autoFocus />\n        </main>\n      );",
  },
  "no-autoplay-without-muted": {
    code: 'const Hero = () => <video autoPlay loop src="/hero.mp4" />;',
  },
  "no-broken-image-source": {
    code: 'const Preview = () => <img src="" alt="Preview" />;',
  },
  "no-blocked-paste": {
    code: 'const Password = () => <input type="password" onPaste={(event) => event.preventDefault()} />;',
    filePath: "src/password.tsx",
  },
  "no-call-component-as-function": {
    code: "\n      const Row = ({ item }) => <li>{item}</li>;\n      const List = ({ items }) => (\n        <ul>{items.map((item) => Row({ item }))}</ul>\n      );\n      ",
  },
  "no-chain-state-updates": {
    code: 'export const Search = () => {\n        const [query, setQuery] = useState("");\n        const [highlighted, setHighlighted] = useState(-1);\n        const clearLater = () => {\n          setTimeout(() => setQuery(""), 5000);\n        };\n        const onChange = (event) => setQuery(event.target.value);\n        useEffect(() => {\n          setHighlighted(-1);\n        }, [query]);\n        return <input onChange={onChange} onBlur={clearLater} />;\n      };',
  },
  "no-children-prop": {
    code: "<div children />;",
    forceJsx: true,
  },
  "no-clone-element": {
    code: 'import { cloneElement } from "react";\n           const clonedElement = cloneElement(\n             <Row title="Cabbage">Hello</Row>,\n             { isHighlighted: true },\n             "Goodbye",\n           );',
    forceJsx: true,
  },
  "no-controlled-input-value-without-state-update": {
    code: "const C = () => <input value={123} onChange={handleChange} />;",
  },
  "no-common-root-font": {
    code: 'const Page = () => <main style={{ fontFamily: "Inter, sans-serif" }}>Content</main>;',
  },
  "no-conflicting-spring-options": {
    code: 'import { motion } from "motion/react";\nconst Card = () => <motion.div transition={{ type: "spring", stiffness: 200, duration: 0.4 }} />;',
  },
  "no-clipped-overlay": {
    code: 'const Menu = () => <div className="overflow-hidden"><div role="menu" className="absolute">Items</div></div>;',
  },
  "no-create-context-in-render": {
    code: '\n      import { createContext } from "react";\n\n      function App() {\n        const Ctx = createContext(null);\n        return null;\n      }\n    ',
  },
  "no-create-object-url-without-revoke": {
    code: "function make(blob) { return URL.createObjectURL(blob); }",
  },
  "no-create-object-url-in-render": {
    code: "const Preview = ({ blob }) => { const src = URL.createObjectURL(blob); return <img src={src} />; };",
  },
  "no-create-ref-in-function-component": {
    code: "import { createRef, useMemo } from 'react';\nconst useDriveItemActions = (item) => {\n  const nameInputRef = useMemo(() => createRef(), []);\n  return { nameInputRef };\n};\nexport default useDriveItemActions;",
  },
  "no-create-store-in-render": {
    code: '\n      import { create } from "zustand";\n\n      function App() {\n        const useStore = create((set) => ({ count: 0 }));\n        return null;\n      }\n    ',
  },
  "no-cramped-container-padding": {
    code: 'const Panel = () => <div className="border rounded p-1">Status</div>;',
  },
  "no-crushed-letter-spacing": {
    code: 'const Heading = () => <h1 style={{ letterSpacing: "-0.12em" }}>Readable heading</h1>;',
  },
  "no-danger": {
    code: '<div dangerouslySetInnerHTML={{ __html: "x" }} />;',
  },
  "no-default-purple-page-gradient": {
    code: 'const Page = () => <main className="min-h-screen bg-gradient-to-br from-violet-600 to-cyan-400">Content</main>;',
  },
  "no-default-warm-page-surface": {
    code: 'const Page = () => <main className="min-h-screen bg-stone-50">Content</main>;',
  },
  "no-decorative-grid-background": {
    code: 'const Hero = () => <section style={{ backgroundImage: "linear-gradient(to right, #aaa 1px, transparent 1px), linear-gradient(to bottom, #aaa 1px, transparent 1px)" }} />;',
  },
  "no-danger-with-children": {
    code: "const a = <div dangerouslySetInnerHTML={{ __html: html }}>text</div>;",
  },
  "no-dark-mode-glow": {
    code: 'const El = () => <div style={{ backgroundColor: "#000", boxShadow: "0 0 60px rgba(139, 92, 246, 0.8)" }} />;',
  },
  "no-default-props": {
    code: "export const Link = (props) => <a {...props} />;\nLink.defaultProps = { appearance: 'default', size: 'regular', disabled: false };",
  },
  "no-deprecated-keyboard-event-keycode-which": {
    code: "const Row = () => <div onKeyDown={(e) => { if (e.keyCode === 75) focusSearch(); }} />;",
  },
  "no-deprecated-tailwind-class": {
    code: 'const Gradient = () => <div className="bg-gradient-to-r from-black to-white" />;',
  },
  "no-derived-state": {
    code: 'function Profile({ firstName, lastName }) {\n        const [fullName, setFullName] = useState("");\n        useEffect(() => {\n          setFullName(`${firstName} ${lastName}`);\n        }, [firstName, lastName]);\n        return <p>{fullName}</p>;\n      }',
  },
  "no-derived-state-effect": {
    code: "function Field({ value }) {\n        const [draft, setDraft] = useState(value);\n        useEffect(() => { setDraft(value); }, [value]);\n        return <input value={draft} />;\n      }",
  },
  "no-derived-useState": {
    code: "function Profile({ name }) {\n        const [draftName, setDraftName] = useState(name);\n        return <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />;\n      }",
  },
  "no-did-mount-set-state": {
    code: '\n      import { Component } from "react";\n      class Hello extends Component {\n        componentDidMount() {\n          this.setState({ name: this.props.name.toUpperCase() });\n        }\n        render() {\n          return <div>{this.state.name}</div>;\n        }\n      }\n      ',
  },
  "no-did-update-set-state": {
    code: "\n      class Hello extends React.Component {\n        componentDidUpdate(prevProps) {\n          this.setState({ name: this.props.name.toUpperCase() });\n        }\n      }\n      ",
  },
  "no-direct-mutation-state": {
    code: "class Counter extends React.Component {\n        increment() {\n          this.state.count = this.state.count + 1;\n          this.setState({ count: this.state.count });\n        }\n        render() { return <button onClick={() => this.increment()}>{this.state.count}</button>; }\n      }",
  },
  "no-direct-state-mutation": {
    code: '\n      function Form() {\n        const [user, setUser] = useState({ n: "" });\n        const onChange = (x) => {\n          user.n = x;\n        };\n        return <input onChange={onChange} />;\n      }\n    ',
  },
  "no-disabled-zoom": {
    code: 'const Head = () => <meta name="viewport" content="width=device-width, user-scalable=no" />;',
  },
  "no-distracting-elements": {
    code: "<marquee />",
    forceJsx: true,
  },
  "no-document-start-view-transition": {
    code: "import { ViewTransition } from 'react';\nconst Gallery = ({ items, select }) => {\n  const onSelect = (id) => document.startViewTransition(() => select(id));\n  return <ViewTransition>{items.map((item) => <img key={item.id} onClick={() => onSelect(item.id)} />)}</ViewTransition>;\n};",
  },
  "no-document-write": {
    code: 'document.write("<p>hi</p>");',
  },
  "no-dynamic-import-path": {
    code: "const load = (p) => import(p);",
  },
  "no-eager-new-in-use-state-initializer": {
    code: 'import { useState } from "react";\nconst Client = () => useState(new AbortController());',
  },
  "no-dynamic-tailwind-class-fragment": {
    code: "const Tile = ({ color }) => <div className={`bg-${color}-500`} />;",
  },
  "no-effect-chain": {
    code: "function Game({ card }) {\n        const [goldCardCount, setGoldCardCount] = useState(0);\n        const [round, setRound] = useState(1);\n        useEffect(() => { if (card.gold) setGoldCardCount(goldCardCount + 1); }, [card]);\n        useEffect(() => { if (goldCardCount > 3) setRound(round + 1); }, [goldCardCount]);\n        return null;\n      }",
  },
  "no-effect-event-handler": {
    code: "\nimport { useEffect } from \"react\";\nconst Checkout = ({ status }) => {\n  useEffect(() => {\n    if (status !== 'submitted') {\n      return;\n    }\n    toast('Order submitted!');\n  }, [status]);\n  return null;\n};\n",
  },
  "no-effect-event-in-deps": {
    code: '\n      import { useEffect, useEffectEvent } from "react";\n      const MyComponent = ({ value }) => {\n        const onTick = useEffectEvent(() => value);\n        useEffect(() => { onTick(); }, [onTick]);\n        return null;\n      };\n    ',
  },
  "no-effect-wrapper-discards-callback-cleanup-return": {
    code: "const useWrapped = (effect: EffectCallback, deps: DependencyList) => { useEffect(() => { effect(); }, deps); };",
  },
  "no-effect-with-fresh-deps": {
    code: '\n      import { useEffect } from "react";\n\n      function Component({ a, b }) {\n        useEffect(() => {\n          // ...\n        }, [{ a, b }]);\n      }\n    ',
  },
  "no-enter-submit-without-ime-composition-guard": {
    code: "const Field = () => (\n         <input onKeyDown={(e) => { e.key === 'Enter' && onSave(); }} />\n       );",
  },
  "no-ease-in-motion": {
    code: 'const Panel = () => <div style={{ transition: "opacity 200ms ease-in" }} />;',
  },
  "no-eval": {
    code: 'const fn = new Function("return 1");',
    filePath: "src/run.ts",
  },
  "no-event-handler": {
    code: "function Form() {\n        const [submitted, setSubmitted] = useState(false);\n        const [data, setData] = useState(null);\n        useEffect(() => {\n          if (submitted) {\n            submitData(data);\n            window.scrollTo(0, 0);\n          }\n        }, [submitted]);\n        return <button onClick={() => setSubmitted(true)}>go</button>;\n      }",
  },
  "no-event-trigger-state": {
    code: 'import { useEffect, useState } from "react";\nconst Form = () => {\n  const [submittedPayload, setSubmittedPayload] = useState(null);\n  useEffect(() => {\n    if (submittedPayload) {\n      post("/api/register", submittedPayload);\n    }\n  }, [submittedPayload]);\n  return <button onClick={() => setSubmittedPayload({ ok: true })}>Go</button>;\n};',
  },
  "no-fetch-in-effect": {
    code: '\n      const Widget = () => {\n        useEffect(() => {\n          fetch("/api/data")\n            .then((response) => response.json())\n            .then(setData);\n        }, []);\n        return null;\n      };\n    ',
  },
  "no-fetch-response-used-without-status-check": {
    code: "function warmCache(url) {\n  fetch(url).then((response) => response.blob());\n}",
  },
  "no-fill-map-element-as-key": {
    code: "const Rows = () => Array(3).fill('a').map((letter) => <Row key={letter} />);",
  },
  "no-find-dom-node": {
    code: 'import { findDOMNode } from "react-dom"; export const f = (node) => findDOMNode(node);',
  },
  "no-flat-page-type-scale": {
    code: 'const Page = () => <main><p className="text-sm">A</p><h2 className="text-base">B</h2><h1 className="text-lg">C</h1></main>;',
  },
  "no-flush-sync": {
    code: 'import { flushSync } from "react-dom";\nfunction C() {\n  const onClick = () => {\n    flushSync(() => {\n      setCount((count) => count + 1);\n    });\n  };\n  return <button onClick={onClick}>go</button>;\n}',
  },
  "no-floating-then-in-jsx-handler": {
    code: "const el = <input onChange={() => api.update(x).then(refetch)} />;",
  },
  "no-full-lodash-import": {
    code: '\n      import _ from "lodash";\n      export const chunked = _.chunk([1, 2, 3], 2);\n    ',
  },
  "no-full-viewport-width": {
    code: 'const Page = () => <main className="w-screen" />;',
  },
  "no-generic-marketing-copy": {
    code: "const Page = () => <main><h1>Supercharge your workflow</h1></main>;",
  },
  "no-generic-handler-names": {
    code: "const El = () => <button onClick={handleClick}>Go</button>;",
  },
  "no-giant-component": {
    code: giantComponentCode,
  },
  "no-global-css-variable-animation": {
    code: 'requestAnimationFrame(() => {\n  document.documentElement.style.setProperty("--scroll", String(window.scrollY));\n});',
  },
  "no-gradient-text": {
    code: 'const El = () => <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-violet-500">Hi</span>;',
  },
  "no-hairline-border-wide-shadow": {
    code: 'const Card = () => <div className="border shadow-2xl" />;',
  },
  "no-gray-on-colored-background": {
    code: 'const C = () => <div className="bg-blue-600 text-gray-400">Hi</div>;',
  },
  "no-hydration-branch-on-browser-global": {
    code: '"use client";\nexport const Page = () => typeof window === "undefined" ? <Server /> : <Client />;',
    filePath: "app/page.tsx",
  },
  "no-hero-eyebrow-chip": {
    code: 'const Hero = () => <header><p className="uppercase tracking-widest">Built for teams</p><h1 className="text-7xl">Work together</h1></header>;',
  },
  "no-img-lazy-with-high-fetchpriority": {
    code: 'const Hero = () => <img src="/a.png" loading="lazy" fetchPriority="high" />;',
  },
  "no-impure-call-at-module-scope": {
    code: "const RENDERED = Date.now();",
  },
  "no-icon-tile-heading-stack": {
    code: 'const Feature = () => <article className="rounded-xl border bg-white p-6"><div className="size-12 rounded-lg bg-blue-100"><SparklesIcon /></div><h3>Automations</h3></article>;',
  },
  "no-image-hover-transform": {
    code: 'const Card = () => <img src="/photo.jpg" alt="Landscape" className="hover:scale-105" />;',
  },
  "no-indeterminate-attribute": {
    code: 'const Checkbox = () => <input type="checkbox" indeterminate />;',
  },
  "no-initialize-state": {
    code: "function Counter({ initialCount }) {\n        const [count, setCount] = useState(null);\n        useEffect(() => {\n          setCount(initialCount);\n        }, []);\n        return <output>{count}</output>;\n      }",
  },
  "no-inline-bounce-easing": {
    code: 'const C = () => <div className="animate-bounce" />;',
  },
  "no-inline-exhaustive-style": {
    code: '\n        const Overlay = () => (\n          <div\n            style={{\n              position: "absolute",\n              top: 0,\n              bottom: 0,\n              left: "50%",\n              marginLeft: -20,\n              width: 3,\n              background: "rgba(255,255,255,0.9)",\n              boxShadow: `0 0 4px rgba(0,0,0,0.5)`,\n              transform: "translateX(-50%)",\n              pointerEvents: "none",\n            }}\n          />\n        );\n      ',
    filePath: "/proj/src/overlay.tsx",
  },
  "no-inline-prop-on-memo-component": {
    code: "const Row = memo(Inner); function List() { return <Row id={1} onClick={() => doThing()} />; }",
  },
  "no-inline-hoc-on-component": {
    code: "const Card = withTheme((props) => <div>{useColor(props.theme)}</div>) as React.FC;",
  },
  "no-interactive-element-to-noninteractive-role": {
    code: '<a href="http://x.y.z" role="img" />',
    forceJsx: true,
  },
  "no-is-mounted": {
    code: "class Hello extends React.Component { method() { if (!this.isMounted()) return; } render() { return <div />; } }",
  },
  "no-italic-serif-display-heading": {
    code: 'const Hero = () => <h1 className="font-serif italic text-7xl">A considered approach</h1>;',
  },
  "no-json-parse-stringify-clone": {
    code: "const copy = JSON.parse(JSON.stringify(state));",
  },
  "no-collapsed-literal-or-chain-as-value": {
    code: 'message.includes("first" || "second");',
  },
  "no-impure-state-updater": {
    code: `import { useState } from "react";
      const Counter = () => {
        const [count, setCount] = useState(0);
        const increment = () => setCount((previousCount) => {
          localStorage.setItem("count", String(previousCount + 1));
          return previousCount + 1;
        });
        return <button onClick={increment}>{count}</button>;
      };`,
  },
  "no-jsx-element-type": {
    code: "\n      function App(): JSX.Element {\n        return <div />;\n      }\n    ",
  },
  "no-justified-text": {
    code: 'const El = () => <p style={{ textAlign: "justify" }}>Lorem ipsum</p>;',
  },
  "no-large-animated-blur": {
    code: 'const El = () => <motion.div animate={{ filter: "blur(80px)" }} style={{ width: 600, height: 600 }} />;',
  },
  "no-layout-property-animation": {
    code: "const X = () => <motion.div animate={{ width: 200 }} />;",
  },
  "no-layout-transition-inline": {
    code: 'const I = () => <div style={{ transition: "width 0.3s" }} />;',
  },
  "no-legacy-class-lifecycles": {
    code: 'import { Component } from "react";\nclass Board extends Component {\n  componentWillMount() {}\n  render() { return null; }\n}',
  },
  "no-legacy-context-api": {
    code: 'import React from "react";\nclass ColorProvider extends React.Component {\n  static childContextTypes = { color: PropTypes.string };\n  getChildContext() {\n    return { color: "red" };\n  }\n  render() {\n    return <div>{this.props.children}</div>;\n  }\n}',
  },
  "no-locale-format-in-render": {
    code: '"use client";\nexport const Timestamp = ({ value }) => <time>{new Date(value).toLocaleString()}</time>;',
  },
  "no-loading-flag-reset-outside-finally": {
    code: 'import { useState } from "react"; const Form = () => { const [, setSubmitting] = useState(false); const submit = async () => { setSubmitting(true); await save(); setSubmitting(false); }; return <button onClick={submit} />; };',
  },
  "no-long-transition-duration": {
    code: 'const S = () => <div style={{ transition: "width 2s ease" }} />;',
  },
  "no-low-contrast-inline-style": {
    code: 'const Balance = () => <span style={{ color: "#9ca3af", backgroundColor: "#ffffff", fontSize: 16 }}>Balance</span>;',
  },
  "no-match-media-in-state-initializer": {
    code: 'import { useState } from "react";\nuseState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);',
  },
  "no-manufactured-contrast-copy": {
    code: "const Page = () => <main><p>Not just another report. It is a plan.</p><p>No busywork. Just useful diagnostics.</p><p>Not a wall of warnings. You get prioritized fixes.</p></main>;",
  },
  "no-many-boolean-props": {
    code: "const Toggle = ({ isOpen, isLoading, hasIcon, canEdit }) => <div />;",
  },
  "no-mirror-prop-effect": {
    code: "function C({ value }) {\n        const [draft, setDraft] = useState(value);\n        useEffect(() => { setDraft(value); }, [value]);\n        return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;\n      }",
  },
  "no-moment": {
    code: 'import moment from "moment";',
  },
  "no-monotonous-page-spacing": {
    code: 'const Page = () => <main><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /><div className="p-4" /></main>;',
  },
  "no-multi-comp": {
    code: "const Foo = () => <div />; const Bar = () => <div />; const Baz = () => <div />;",
  },
  "no-mutable-in-deps": {
    code: "\n      function Page() {\n        useEffect(() => {\n          track(location.href);\n        }, [location.href]);\n        return null;\n      }\n    ",
  },
  "no-mutate-queried-dom-node-in-component": {
    code: "function Row({ order }) {\n        document.getElementById('row-1').style.zIndex = '1';\n        return <div id=\"row-1\" style={{ zIndex: order }} />;\n      }",
  },
  "no-mutating-array-method-on-prop-or-hook-result": {
    code: "function List({ items }) {\n  items.splice(0, 1);\n  return null;\n}",
  },
  "no-mutating-reducer-state": {
    code: '\n      import { useReducer } from "react";\n\n      function reducer(state, action) {\n        state.age = state.age + 1;\n        return state;\n      }\n\n      useReducer(reducer, { age: 0 });\n    ',
  },
  "no-mutate-then-set-or-return-same-reference": {
    code: "const Table=()=>{const[rows,setRows]=useState([]);rows.sort();setRows(rows)};",
  },
  "no-namespace": {
    code: "<ns:testcomponent />",
    forceJsx: true,
  },
  "no-nested-component-definition": {
    code: "\n      const Parent = () => {\n        const NestedChild = () => <span>nested</span>;\n        return <NestedChild />;\n      };\n    ",
  },
  "no-non-literal-selector-query-without-try-catch": {
    code: "element.matches(location.hash);",
  },
  "no-nondeterministic-id-value-in-render-body": {
    code: 'import { uniqueId } from "lodash";\nconst useBundleChartData = () => {\n  const chartId = useMemo(() => uniqueId(), []);\n  return { chartId };\n};',
  },
  "no-nested-card-surface": {
    code: 'const Cards = () => <div className="rounded-xl border p-6"><section className="rounded-lg border bg-white p-4">Inner</section></div>;',
  },
  "no-noninteractive-element-interactions": {
    code: "<li onClick={() => {}}>x</li>",
  },
  "no-noninteractive-element-to-interactive-role": {
    code: '<li role="separator" tabIndex={0} />',
  },
  "no-noninteractive-tabindex": {
    code: "<div tabIndex={0} ref={measureRef}>static text</div>",
  },
  "no-non-null-assertion-on-maybe-undefined-result": {
    code: "const first = input.match(/(\\d+)/)![1];",
  },
  "no-nullish-coalescing-arithmetic-precedence": {
    code: "const r = x ?? 0 / y;",
  },
  "no-object-keys-values-entries-on-maybe-undefined": {
    code: "const list = Object.keys(response?.data);",
  },
  "no-numbered-section-markers": {
    code: "const Page = () => <main><span>01</span><h2>Principles</h2><span>02</span><h2>Process</h2><span>03</span><h2>Outcome</h2></main>;",
  },
  "no-outline-none": {
    code: 'const T = () => <button style={{ outline: "none" }}>Save</button>;',
  },
  "no-object-or-array-coerced-to-string-in-template-literal": {
    code: "function formatMetadata() { return `metadata: ${{ id: 1 }}`; }",
  },
  "no-overwide-text-measure": {
    code: 'const Copy = () => <p style={{ maxWidth: "96ch" }}>Long-form copy</p>;',
  },
  "no-oversized-long-heading": {
    code: 'const Hero = () => <h1 className="text-8xl">Build a better workflow for every team in your growing organization</h1>;',
  },
  "no-placeholder-only-field": {
    code: 'const Field = () => <input placeholder="Email address" />;',
  },
  "no-pass-data-to-parent": {
    code: "const Child = (props) => {\n          const fetchedData = useSomeAPI();\n          useEffect(() => {\n            props.onLoaded(fetchedData);\n          }, [props, fetchedData]);\n          return null;\n        };",
  },
  "no-pass-live-state-to-parent": {
    code: "const Child = (props) => {\n        const [results, setResults] = useState([]);\n        useEffect(() => {\n          props.search(results);\n        }, [props, results]);\n        return null;\n      };",
  },
  "no-permanent-will-change": {
    code: 'const S = () => <div style={{ willChange: "transform" }} />;',
  },
  "no-polymorphic-children": {
    code: 'const Button = ({ children }) =>\n        typeof children === "string" ? <span>{children}</span> : <div>{children}</div>;',
  },
  "no-predicate-function-reference-in-boolean-position": {
    code: "function isReady() { return true; }\nisReady && start();",
  },
  "no-prevent-default": {
    code: "interface LinkProps {\n  href?: string;\n}\n\nexport const Link = (props: LinkProps) => (\n  <a {...props} onClick={(event) => event.preventDefault()}>\n    Open\n  </a>\n);\n",
    filePath: "src/link.tsx",
  },
  "no-prop-callback-in-effect": {
    code: "\n      const Image = ({ thing, property, onError, onSave, maxSize }: Props) => {\n        const values = useProperty({ thing, property, type: 'url' });\n        const { value, error: thingError } = values;\n        let valueError;\n        if (!value) {\n          valueError = new Error('No value found for property.');\n        }\n        const [error, setError] = useState(thingError ?? valueError);\n\n        useEffect(() => {\n          if (error) {\n            if (onError) {\n              onError(error);\n            }\n          }\n        }, [error, onError]);\n\n        const handleDelete = async () => {\n          try {\n            await deleteImage(value);\n          } catch (deleteError) {\n            setError(deleteError);\n          }\n        };\n\n        const handleChange = async (input) => {\n          const fileSelected = input.files && input.files[0];\n          try {\n            await saveImage(fileSelected);\n            if (onSave) {\n              onSave();\n            }\n          } catch (saveError) {\n            setError(saveError);\n          }\n        };\n\n        return (\n          <div>\n            <input onChange={(event) => handleChange(event.target)} />\n            <button onClick={handleDelete}>Delete</button>\n          </div>\n        );\n      };\n      ",
  },
  "no-prop-callback-in-render": {
    code: `
      const Image = ({ error, onError }) => {
        if (error) onError(error);
        return <div />;
      };
    `,
  },
  "no-ref-current-in-render": {
    code: `import { useRef } from "react";
      const Panel = ({ value }) => {
        const latestValueRef = useRef(value);
        latestValueRef.current = value;
        return null;
      };`,
  },
  "no-prop-types": {
    code: 'import PropTypes from "prop-types";\nconst Foo = ({ name }) => <div>{name}</div>;\nFoo.propTypes = { name: PropTypes.string };',
  },
  "no-promise-then-side-effect-in-effect-without-catch": {
    code: 'import { useEffect, useState } from "react"; const C = ({ url }) => { const [, setUser] = useState(); useEffect(() => { fetch(url).then((response) => response.json()).then(setUser); }, [url]); };',
  },
  "no-pure-black-background": {
    code: 'const El = () => <div className="bg-black" />;',
  },
  "no-random-key": {
    code: "\n      function List({ items }) {\n        return (\n          <ul>\n            {items.map((item) => (\n              <li key={Math.random()}>{item}</li>\n            ))}\n          </ul>\n        );\n      }\n    ",
  },
  "no-react-children": {
    code: "import { Children } from 'react'; Children.map(children, child => <div>{child}</div>)",
    forceJsx: true,
  },
  "no-react-dom-deprecated-apis": {
    code: 'import { render } from "react-dom";\nrender(null, document.getElementById("root"));',
  },
  "no-ref-callback-cleanup-before-react-19": {
    code: "const Component = ({ release }) => <div ref={(node) => () => release(node)} />;",
    forceJsx: true,
  },
  "no-react19-deprecated-apis": {
    code: 'import * as React from "react";\nconst Button = React.createFactory("button");\nvoid Button;',
  },
  "no-redundant-display-class": {
    code: 'const Card = () => <div className="block rounded-lg" />;',
  },
  "no-repeating-gradient-decoration": {
    code: 'const Panel = () => <div style={{ backgroundImage: "repeating-linear-gradient(45deg, #fff 0 4px, #eee 4px 8px)" }} />;',
  },
  "no-redundant-roles": {
    code: 'const Nav = () => <nav role="navigation" />;',
  },
  "no-redundant-should-component-update": {
    code: "\n\t\t\t        class Foo extends React.PureComponent {\n\t\t\t          shouldComponentUpdate() {\n\t\t\t            return true;\n\t\t\t          }\n\t\t\t        }\n\t\t\t      ",
    forceJsx: true,
  },
  "no-repeated-kicker-labels": {
    code: 'const Page = () => <main><section><p className="uppercase tracking-widest">Approach</p><h2>How</h2></section><section><p className="uppercase tracking-widest">Benefits</p><h2>Why</h2></section><section><p className="uppercase tracking-widest">Results</p><h2>What</h2></section></main>;',
  },
  "no-render-in-render": {
    code: "const Foo = () => {\n        const renderRow = () => {\n          const [open] = useState(false);\n          return <div>{String(open)}</div>;\n        };\n        return <div>{renderRow()}</div>;\n      };",
  },
  "no-render-prop-children": {
    code: '\n        import { Layout } from "@/components/layout";\n        const Panel = () => (\n          <Layout\n            renderHeader={() => <h1>Title</h1>}\n            renderFooter={() => <footer>Footer</footer>}\n            renderActions={() => <button>Go</button>}\n          />\n        );\n      ',
  },
  "no-render-return-value": {
    code: "var Hello = ReactDOM.render(<div />, document.body);",
    forceJsx: true,
  },
  "no-reset-all-state-on-prop-change": {
    code: 'import { useEffect, useState } from "react";\n      const Profile = ({ userId }) => {\n        const [comment, setComment] = useState("");\n        useEffect(() => {\n          setComment("");\n        }, [userId]);\n        return <textarea value={comment} onChange={(e) => setComment(e.target.value)} />;\n      };',
    forceJsx: true,
  },
  "no-scale-from-zero": {
    code: 'import { motion } from "framer-motion";\nconst El = () => <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} />;',
  },
  "no-secrets-in-client-code": {
    code: 'const authEndpoint = "https://api.example.com/auth?token=supersecretvalue123";',
    filePath: "src/components/config.tsx",
    forceJsx: true,
  },
  "no-self-updating-effect": {
    code: "function Counter() {\n        const [x, setX] = useState(0);\n        useEffect(() => {\n          if (x === null) {\n            return;\n          }\n          setX((value) => value + 1);\n        }, [x]);\n        return null;\n      }",
  },
  "no-set-state": {
    code: "\n\t\t\t        var Hello = createReactClass({\n\t\t\t          componentDidUpdate: function() {\n\t\t\t            this.setState({\n\t\t\t              name: this.props.name.toUpperCase()\n\t\t\t            });\n\t\t\t          },\n\t\t\t          render: function() {\n\t\t\t            return <div>Hello {this.state.name}</div>;\n\t\t\t          }\n\t\t\t        });\n\t\t\t      ",
    forceJsx: true,
  },
  "no-set-state-after-await-in-effect": {
    code: 'import { useEffect, useState } from "react"; const C = ({ id }) => { const [, setUser] = useState(); useEffect(() => { const run = async () => { const user = await load(id); setUser(user); }; run(); }, [id]); };',
  },
  "no-side-effect-in-state-updater-function": {
    code: "const Counter=({onChange})=>{const[,setCount]=useState(0);setCount(previous=>{onChange(previous);return previous+1})};",
  },
  "no-set-state-in-render": {
    code: 'import { useState } from "react";\nexport function C() {\n  const [count, setCount] = useState(0);\n  setCount(1);\n  return null;\n}',
  },
  "no-side-tab-border": {
    code: 'const C = () => <div className="border-l-4 border-[#ff0000]" />;',
  },
  "no-spread-accumulator-in-reduce": {
    code: "const out = items.reduce((acc, item) => [...acc, item], []);",
  },
  "no-spread-props-over-defaults-clobbers-with-undefined": {
    code: "interface Props{width?:number} const defaults={width:100};const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width*2};",
  },
  "no-skipped-heading-level": {
    code: "const Page = () => <main><h1>Title</h1><h3>Details</h3></main>;",
  },
  "no-stale-timer-ref": {
    code: 'import { useRef } from "react";\nexport const useDelayedCallback = (callback) => {\n  const timerRef = useRef(null);\n  const schedule = () => {\n    if (timerRef.current) return;\n    timerRef.current = setTimeout(callback, 100);\n  };\n  const cancel = () => {\n    clearTimeout(timerRef.current);\n  };\n  return { schedule, cancel };\n};',
  },
  "no-static-element-interactions": {
    code: "export const A = ({ onClick }) => <div role={'wat'} onClick={onClick} />;",
  },
  "no-static-motion-config-never": {
    code: 'import { MotionConfig } from "motion/react";\nconst App = () => <MotionConfig reducedMotion="never"><main /></MotionConfig>;',
    filePath: "src/App.tsx",
  },
  "no-string-false-on-boolean-attribute": {
    code: 'const a = <input disabled="false" />;',
  },
  "no-string-refs": {
    code: "\n              var Hello = createReactClass({\n                componentDidMount: function() {\n                  var component = this.refs.hello;\n                },\n                render: function() {\n                  return <div>Hello {this.props.name}</div>;\n                }\n              });\n            ",
    forceJsx: true,
  },
  "no-svg-currentcolor-with-fill-class": {
    code: 'const Icon = () => <svg fill="currentColor" className="fill-zinc-400" />;',
  },
  "no-sync-xhr": {
    code: 'const xhr = new XMLHttpRequest();\nxhr.open("GET", url, false);\nxhr.send(null);',
    filePath: "/repo/src/lib/fetch-sync.ts",
  },
  "no-tailwind-layout-transition": {
    code: 'const Drawer = () => <div className="transition-[height] duration-300" />;',
  },
  "no-tight-body-leading": {
    code: "const Copy = () => <p style={{ lineHeight: 1.2 }}>This paragraph contains enough words to wrap across several lines in a typical content column.</p>;",
  },
  "no-this-in-sfc": {
    code: "const Foo = (props) => <span>{this.props.foo}</span>",
  },
  "no-tiny-text": {
    code: "const C = () => (\n        <div>\n          <p style={{ fontSize: 11 }}>First hint</p>\n          <p style={{ fontSize: 11 }}>Second hint</p>\n          <p style={{ fontSize: 11 }}>Third hint</p>\n        </div>\n      );",
  },
  "no-transition-all": {
    code: 'const El = () => <div style={{ transition: "all 0.3s ease" }} />;',
  },
  "no-unbounded-animation-frame-loop": {
    code: "function draw(time) { render(time); requestAnimationFrame(draw); } requestAnimationFrame(draw);",
    filePath: "src/animation.ts",
  },
  "no-uncontrolled-input": {
    code: 'export default function Field({ text }) { return <input type="text" value={text} />; }',
    filePath: "app/field.tsx",
  },
  "no-unescaped-dynamic-string-in-regexp": {
    code: "const matcher = RegExp(highlight, 'gi');",
  },
  "no-unthrottled-scroll-mutation": {
    code: 'const hero = document.querySelector(".hero"); document.addEventListener("scroll", () => { hero.style.transform = "translateY(20px)"; });',
    filePath: "src/scroll.ts",
  },
  "no-unguarded-browser-global-in-render-or-hook-init": {
    code: '"use client";\nexport const Page = () => <main>{window.innerWidth}</main>;',
    filePath: "app/page.tsx",
  },
  "no-unguarded-numeric-input-parse": {
    code: "const Field = () => <input onChange={(event) => setValue(Number(event.target.value))} />;",
  },
  "no-unguarded-throwing-parse-call": {
    code: "function Swatch(props) { return chroma(props.color).hex(); }",
  },
  "no-uninformative-aria-label": {
    code: 'const Search = () => <button aria-label="icon"><svg /></button>;',
  },
  "no-undeferred-third-party": {
    code: 'const W = () => <script src="https://cdn.example.com/w.js" />;',
  },
  "no-unescaped-entities": {
    code: "\n        var Hello = createReactClass({\n            render: function() {\n              return <div>'</div>;\n            }\n        });\n        ",
    forceJsx: true,
  },
  "no-unguarded-browser-global-at-module-scope": {
    code: "const lang = navigator.language;",
    filePath: "src/lib/foo.ts",
  },
  "no-unknown-property": {
    code: '<div transform-origin="center" />',
  },
  "no-unsafe": {
    code: "\n\t\t\t        class Foo extends React.Component {\n\t\t\t          componentWillMount() {}\n\t\t\t          componentWillReceiveProps() {}\n\t\t\t          componentWillUpdate() {}\n\t\t\t        }\n\t\t\t      ",
    settings: {
      "react-doctor": { noUnsafe: { checkAliases: true } },
      react: { version: "16.4.0" },
    },
    forceJsx: true,
  },
  "no-unsafe-json-parse": {
    code: "const message = JSON.parse(raw).message;",
  },
  "no-unstable-nested-components": {
    code: "\n                    function ParentComponent() {\n                      function UnstableNestedFunctionComponent() {\n                        return <div />;\n                      }\n            \n                      return (\n                        <div>\n                          <UnstableNestedFunctionComponent />\n                        </div>\n                      );\n                    }\n                  ",
    forceJsx: true,
  },
  "no-usememo-simple-expression": {
    code: "function C({ x }) { const v = useMemo(() => x + 1, [x]); return <p>{v}</p>; }",
  },
  "no-whole-object-dep-with-member-reads": {
    code: 'import { useMemo } from "react";function FullName(props){return useMemo(()=>props.first,[props])}',
  },
  "no-whole-object-default-losing-per-key-defaults": {
    code: "function f({ a, b } = { a: 1 } as Options) {}",
  },
  "no-wide-letter-spacing": {
    code: "\n      const Body = () => (\n        <p style={{ letterSpacing: 2 }}>Some long paragraph of body copy.</p>\n      );\n    ",
  },
  "no-will-update-set-state": {
    code: "\n                    var Hello = createReactClass({\n                      componentWillUpdate: function() {\n                        this.setState({\n                          data: data\n                        });\n                      }\n                    });\n                  ",
    forceJsx: true,
  },
  "no-z-index-9999": {
    code: "const C = () => (\n        <div>\n          <div style={{ zIndex: 9999 }} />\n          <div style={{ zIndex: 99999 }} />\n          <div style={{ zIndex: 10050 }} />\n        </div>\n      );",
  },
  "nosql-injection-risk": {
    code: "export const findUsers = (req, collection) => collection.find(JSON.parse(req.query.filter));",
    filePath: "src/server/db/users.ts",
  },
  "only-export-components": {
    code: "export const foo = () => 'label'; export const Bar = () => <div />;",
    forceJsx: true,
  },
  "package-metadata-secret": {
    code: '{"name":"x","config":{"db":"postgres://dbuser:r3alL0ngPwd0rdValue@db.prod.example.com/app"}}',
    filePath: "package.json",
  },
  "path-traversal-risk": {
    code: "export const readUserFile = (req) => readFileSync(path.join(UPLOADS_DIR, req.params.fileName));\n",
    filePath: "src/server/files.ts",
  },
  "plugin-update-trust-risk": {
    code: 'import { spawnSync } from "node:child_process";\nconst updateUrl = await fetchLatestRelease();\nawait downloadFile(updateUrl, "/tmp/update.zip");\nspawnSync("unzip", ["/tmp/update.zip"]);\n',
    filePath: "src/updater.ts",
  },
  "postmessage-origin-risk": {
    code: 'window.addEventListener("message", (event) => {\n  handleCommand(event.data);\n});\n',
    filePath: "src/widget.ts",
  },
  "preact-no-children-length": {
    code: "\n      function List(props) {\n        return <div>{props.children.length} items</div>;\n      }\n      ",
  },
  "preact-no-react-hooks-import": {
    code: '\n      import { useState } from "react";\n      const Counter = () => {\n        const [count, setCount] = useState(0);\n        return <button onClick={() => setCount((n) => n + 1)}>{count}</button>;\n      };\n      ',
  },
  "preact-no-render-arguments": {
    code: '\n      import { Component } from "preact";\n\n      class Hello extends Component {\n        render(props) {\n          return <h1>Hello {props.name}</h1>;\n        }\n      }\n      ',
  },
  "preact-prefer-ondblclick": {
    code: "\n      const Item = () => <li onDoubleClick={openInline}>Item</li>;\n      ",
  },
  "preact-prefer-oninput": {
    code: '\n      import { useState } from "preact/hooks";\n\n      const Search = () => {\n        const [query, setQuery] = useState("");\n        return <input type="text" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />;\n      };\n      ',
  },
  "pointer-capture-needs-cancel-handler": {
    code: "const Slider = () => <div onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={move} onPointerUp={finish} />;",
  },
  "prefer-dvh-over-vh": {
    code: 'const Page = () => <main className="min-h-screen" />;',
  },
  "prefer-dynamic-import": {
    code: '\n      import { Chart } from "chart.js";\n      Chart.register();\n    ',
  },
  "prefer-es6-class": {
    code: "\n            var Hello = createReactClass({\n              displayName: 'Hello',\n              render: function() {\n                return <div>Hello {this.props.name}</div>;\n              }\n            });\n            ",
    forceJsx: true,
  },
  "prefer-explicit-variants": {
    code: "const Composer = ({ isThread, isEditing }) => (\n        <div>\n          {isThread ? <ThreadHeader /> : <ChannelHeader />}\n          {isEditing ? <EditForm /> : <MessageContent />}\n        </div>\n      );",
  },
  "prefer-function-component": {
    code: "class Foo extends React.PureComponent {\n               render() {\n                 return <div>{this.props.foo}</div>;\n               }\n             };",
    forceJsx: true,
  },
  "prefer-html-dialog": {
    code: '<div role="dialog" aria-label="hi" />',
  },
  "prefer-module-scope-pure-function": {
    code: '\n      function App() {\n        const formatName = (user) => user.firstName + " " + user.lastName;\n        return null;\n      }\n    ',
  },
  "prefer-module-scope-static-value": {
    code: '\n      function App() {\n        const FILTER_OPTIONS = ["all", "active", "done"];\n        return null;\n      }\n    ',
  },
  "prefer-motion-transform-property": {
    code: 'import { motion } from "motion/react";\nconst Card = () => <motion.div animate={{ x: 100 }} />;',
  },
  "prefer-stable-empty-fallback": {
    code: '\n      import { memo } from "react";\n\n      const PostList = memo(({ posts }) => null);\n\n      function App(props) {\n        return <PostList posts={props.posts || []} />;\n      }\n    ',
  },
  "prefer-tag-over-role": {
    code: 'const Nav = () => <div role="navigation" />;',
  },
  "prefer-truncate-shorthand": {
    code: 'const Name = () => <span className="overflow-hidden text-ellipsis whitespace-nowrap">Name</span>;',
  },
  "prefer-use-effect-event": {
    code: 'import { useEffect } from "react";\nconst Chat = ({ roomId, onMessage }) => {\n  useEffect(() => {\n    const socket = connect(roomId);\n    socket.on("message", (msg) => onMessage(msg));\n    return () => socket.close();\n  }, [roomId, onMessage]);\n  return null;\n};',
  },
  "prefer-use-sync-external-store": {
    code: 'import { useEffect, useState } from "react";\nconst WidthLabel = () => {\n  const [width, setWidth] = useState(window.innerWidth);\n  useEffect(() => {\n    const onResize = () => setWidth(window.innerWidth);\n    window.addEventListener("resize", onResize);\n    return () => window.removeEventListener("resize", onResize);\n  }, []);\n  return <span>{width}</span>;\n};',
  },
  "prefer-useReducer": {
    code: '\nimport { useState } from "react";\nconst Profile = () => {\n  const [name, setName] = useState("");\n  const [email, setEmail] = useState("");\n  const [age, setAge] = useState(0);\n  const [address, setAddress] = useState("");\n  const [phone, setPhone] = useState("");\n  const applyProfile = (profile) => {\n    setName(profile.name);\n    setEmail(profile.email);\n    setAge(profile.age);\n    setAddress(profile.address);\n    setPhone(profile.phone);\n  };\n  return applyProfile;\n};\n',
  },
  "public-debug-artifact": {
    code: "request failed: GET /internal/admin 500\n",
    filePath: "public/debug.log",
  },
  "public-env-secret-name": {
    code: "export const pylonSecret = import.meta.env.VITE_PYLON_IDENTITY_SECRET;\n",
    filePath: "src/lib/identity.ts",
  },
  "query-destructure-result": {
    code: "import { useQuery } from '@tanstack/react-query';\nexport function useChartConfig() {\n  const query = useQuery({ queryKey: ['chart'] });\n  const snapshot = { ...query, label: 'chart' };\n  return snapshot.data;\n}",
  },
  "query-floating-mutate-async": {
    code: 'import { useMutation } from "@tanstack/react-query";\nconst mutation = useMutation({ mutationFn: save });\nmutation.mutateAsync(payload);',
  },
  "query-mutation-missing-invalidation": {
    code: 'const posts = useQuery({ queryKey: ["posts"], queryFn: fetchPosts });\n      useMutation({ mutationFn: deletePost });',
  },
  "query-no-mutation-in-effect-as-read": {
    code: 'import { useMutation } from "@tanstack/react-query";\nconst C = () => {\n  const { mutateAsync: fetchUser, data } = useMutation({ mutationFn });\n  useEffect(() => { fetchUser(id); }, [id]);\n  return <div>{data.user.name}</div>;\n};',
  },
  "query-no-query-in-effect": {
    code: 'import { useQuery } from "@tanstack/react-query"; function Dashboard() { const query = useQuery({ queryKey: ["item"] }); useEffect(() => { query.refetch(); }, [query]); return null; }',
  },
  "query-no-rest-destructuring": {
    code: 'import { useQuery } from "@tanstack/react-query"; const { data, ...rest } = useQuery({ queryKey: ["x"] });',
  },
  "query-no-usequery-for-mutation": {
    code: "const r = useQuery({ queryKey: ['users'], queryFn: () => fetch('/api/users', { method: 'DELETE' }) });",
  },
  "query-no-void-query-fn": {
    code: 'import { useQuery } from "@tanstack/react-query";\nconst useThing = () => useQuery({ queryKey: ["thing"], queryFn: () => {} });',
  },
  "query-stable-query-client": {
    code: "function App() { const client = new QueryClient(); return null; }",
  },
  "radio-input-missing-name": {
    code: '<input type="radio" value="yes" />;',
  },
  "raw-sql-injection-risk": {
    code: "export const q = (prisma, id) => prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`);\n",
    filePath: "src/raw-sql.ts",
  },
  "react-compiler-no-manual-memoization": {
    code: 'import { memo } from "react"; const C = memo(Inner);',
  },
  "react-in-jsx-scope": {
    code: "var App, a = <App />;",
    forceJsx: true,
  },
  "react-markdown-unsanitized-raw-html": {
    code: 'import Markdown from "react-markdown";\nimport raw from "rehype-raw";\nexport const Preview = ({ content }) => <Markdown rehypePlugins={[raw]}>{content}</Markdown>;',
    filePath: "src/preview.tsx",
  },
  "redux-useselector-inline-derivation": {
    code: '\n      import { useSelector } from "react-redux";\n\n      const activeUsers = useSelector((state) =>\n        state.users.filter((user) => new Date(user.loginDate).getFullYear() === 2023),\n      );\n    ',
  },
  "redux-useselector-returns-new-collection": {
    code: '\n      import { useSelector } from "react-redux";\n\n      function Component() {\n        const { name, email } = useSelector((state) => ({\n          name: state.user.name,\n          email: state.user.email,\n        }));\n      }\n    ',
  },
  "rendering-animate-svg-wrapper": {
    code: 'const El = () => <svg animate={{ x: 100 }} viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>;',
  },
  "rendering-conditional-render": {
    code: "const C = ({ items }) => <div>{items.length && <List items={items} />}</div>;",
  },
  "rendering-hoist-jsx": {
    code: "function List(){ const ICON = <svg><path /></svg>; return <div>{ICON}</div>; }",
  },
  "rendering-hydration-mismatch-time": {
    code: "export const Stamp = () => <time>{Date.now()}</time>;",
  },
  "rendering-hydration-no-flicker": {
    code: 'import { useEffect, useState } from "react";\n      const Component = () => {\n        const [isClient, setIsClient] = useState(false);\n        useEffect(() => {\n          setIsClient(true);\n        }, []);\n        return <div>{isClient ? "client" : "server"}</div>;\n      };',
  },
  "rendering-script-defer-async": {
    code: 'const D = () => <head><script src="/app.js" /></head>;',
  },
  "rendering-svg-precision": {
    code: '\n      const Exported = () => (\n        <svg>\n          <g transform="matrix(0.26458333,0,0,0.26458333,0,0)">\n            <path d="M 0 0 L 10 10 Z" />\n          </g>\n        </svg>\n      );\n      ',
    filePath: "/repo/src/exported.tsx",
  },
  "rendering-usetransition-loading": {
    code: 'function C() { const [isLoading, setIsLoading] = useState(false); const toggle = () => { setIsLoading(true); }; return <button onClick={toggle}>{isLoading ? "..." : "go"}</button>; }',
  },
  "remotion-calculate-metadata-fetch-signal": {
    code: 'import { Composition } from "remotion";\nconst load = async () => ({ props: await fetch("/data") });\nexport const Root = () => <Composition calculateMetadata={load} />;',
  },
  "remotion-deterministic-randomness": {
    code: 'import { useCurrentFrame } from "remotion";\nexport const Scene = () => { useCurrentFrame(); return <div>{Math.random()}</div>; };',
  },
  "remotion-no-css-animation": {
    code: 'import { AbsoluteFill, useCurrentFrame } from "remotion";\nexport const Scene = () => { useCurrentFrame(); return <AbsoluteFill style={{ animation: "fade 1s" }} />; };',
  },
  "remotion-no-css-transition": {
    code: 'import { AbsoluteFill, useCurrentFrame } from "remotion";\nexport const Scene = () => { useCurrentFrame(); return <AbsoluteFill style={{ transition: "opacity 1s" }} />; };',
  },
  "remotion-no-css-url-assets": {
    code: 'import { AbsoluteFill, useCurrentFrame } from "remotion";\nexport const Scene = () => { useCurrentFrame(); return <AbsoluteFill style={{ backgroundImage: "url(/background.png)" }} />; };',
  },
  "remotion-no-module-scope-delay-render": {
    code: 'import { delayRender } from "remotion";\nconst handle = delayRender();',
  },
  "remotion-no-native-media-elements": {
    code: 'import { AbsoluteFill, useCurrentFrame } from "remotion";\nexport const Scene = () => { useCurrentFrame(); return <AbsoluteFill><img src="/image.png" /></AbsoluteFill>; };',
  },
  "remotion-no-next-image": {
    code: 'import { Composition } from "remotion";\nimport Image from "next/image";\nconst Scene = () => <Image src="/image.png" alt="" />;\nexport const Root = () => <Composition component={Scene} />;',
  },
  "remotion-stable-delay-render-handle": {
    code: 'import { delayRender } from "remotion";\nexport const Scene = () => <div>{delayRender()}</div>;',
  },
  "repository-secret-file": {
    code: "DATABASE_URL=postgres://app_prod:N7v!q2mXfA9z@db.internal.example.com:5432/app\n",
    filePath: ".env",
  },
  "request-body-mass-assignment": {
    code: "await db.user.update({ where: { id }, data: { ...req.body } });\n",
    filePath: "src/server/users.ts",
  },
  "require-render-return": {
    code: "\n                    var Hello = createReactClass({\n                      displayName: 'Hello',\n                      render: function() {}\n                    });\n                  ",
    forceJsx: true,
  },
  "rerender-defer-reads-hook": {
    code: 'import { useSearchParams } from "next/navigation";\nconst SearchButton = () => {\n  const searchParams = useSearchParams();\n  const onClick = () => console.log(searchParams.get("q"));\n  return <button onClick={onClick}>Go</button>;\n};',
  },
  "rerender-dependencies": {
    code: 'import { useEffect } from "react";\nconst Panel = ({ mode }) => {\n  useEffect(() => {\n    sync();\n  }, [{ mode }]);\n  return null;\n};',
  },
  "rerender-derived-state-from-hook": {
    code: 'function App() { const width = useWindowWidth(); const isMobile = width < 768; return <div>{isMobile ? "m" : "d"}</div>; }',
  },
  "rerender-functional-setstate": {
    code: "export const Pagination = (props) => {\n        const [page, setPage] = React.useState(props.page);\n        const onClickHandler = (buttonType) => {\n          switch (buttonType) {\n            case 'prev':\n              if (page > 1) setPage(page - 1);\n              break;\n            case 'next':\n              if (page < props.totalPages) setPage(page + 1);\n              break;\n          }\n        };\n        return <button onClick={() => onClickHandler('prev')} />;\n      }",
  },
  "rerender-lazy-ref-init": {
    code: '\n      import { useRef } from "react";\n\n      function Component() {\n        const ref = useRef(buildExpensiveCache());\n      }\n    ',
  },
  "rerender-lazy-state-init": {
    code: "function C() {\n        const [v, setV] = useState(makeBigArray());\n        return null;\n      }",
  },
  "rerender-memo-before-early-return": {
    code: "function C({ cond }) { const content = useMemo(() => { return (<Heavy />); }, []); if (cond) { return null; } return <div>{content}</div>; }",
  },
  "rerender-memo-with-default-value": {
    code: 'import { useMemo } from "react";\nconst Chart = ({ places = [] }) => {\n  const placeByKey = useMemo(() => new Map(places.map((place) => [place.key, place])), [places]);\n  return <div>{placeByKey.size}</div>;\n};',
  },
  "rerender-state-only-in-handlers": {
    code: "\n      function App() {\n        const [logged, setLogged] = useState(false);\n        const onClick = () => setLogged(true);\n        return <button onClick={onClick}>go</button>;\n      }\n    ",
  },
  "rerender-transitions-scroll": {
    code: 'function ScrollTracker() {\n        const [, setScrollY] = useState(0);\n        useEffect(() => {\n          window.addEventListener("scroll", () => {\n            setScrollY(window.scrollY);\n          });\n        }, []);\n        return null;\n      }',
  },
  "rn-animation-reaction-as-derived": {
    code: 'import { useAnimatedReaction } from "react-native-reanimated";\nconst C = () => { useAnimatedReaction(() => x.value, (cur) => { sv.value = cur; }); };',
  },
  "rn-bottom-sheet-prefer-native": {
    code: 'import ActionSheet from "react-native-actions-sheet";',
  },
  "rn-detox-missing-await": {
    code: 'it("x", async () => { element(by.id("submit")).tap(); });',
    filePath: "e2e/login.e2e.ts",
    forceJsx: true,
  },
  "rn-list-callback-per-row": {
    code: "const C = () => (\n  <FlatList\n    renderItem={({item}) => (\n      <FlatList\n        data={item.sub}\n        renderItem={({item: sub}) => (<Sub onPress={() => pick(sub)} />)}\n      />\n    )}\n  />\n);",
  },
  "rn-list-data-mapped": {
    code: "const C = ({ items }) => <FlatList data={items.map((x) => x.id)} renderItem={r} />;",
  },
  "rn-list-missing-estimated-item-size": {
    code: '\n      import { FlashList } from "@shopify/flash-list";\n      const Screen = ({ items }) => (\n        <FlashList data={items} renderItem={renderItem} />\n      );\n    ',
  },
  "rn-list-recyclable-without-types": {
    code: 'import { FlashList } from "@shopify/flash-list";\nconst C = () => (<FlashList recycleItems data={items} renderItem={r} />);',
  },
  "rn-no-deep-imports": {
    code: 'import { Alert } from "react-native/Libraries/Alert/Alert";',
  },
  "rn-no-deprecated-modules": {
    code: 'import { SafeAreaView } from "react-native";',
  },
  "rn-no-dimensions-get": {
    code: 'import { Dimensions } from "react-native"; export const w = () => Dimensions.get("window");',
  },
  "rn-no-falsy-and-render": {
    code: "const C = ({ items }) => <View>{items.length && <List />}</View>;",
  },
  "rn-no-image-children": {
    code: '\n      import { Image } from "react-native";\n      const App = () => <Image source={src}>Caption</Image>;\n    ',
  },
  "rn-no-inline-flatlist-renderitem": {
    code: 'import { FlatList } from "react-native";\n      const Feed = ({ items }) => (\n        <FlatList data={items} renderItem={({ item }) => <Row item={item} />} />\n      );',
  },
  "rn-no-inline-object-in-list-item": {
    code: "const C = () => (<FlatList renderItem={({item}) => (<View style={{margin:8}}><Text>{item.name}</Text></View>)} />);",
  },
  "rn-no-legacy-expo-packages": {
    code: '\n      import { Audio } from "expo-av";\n      export const sound = new Audio.Sound();\n    ',
  },
  "rn-no-legacy-shadow-styles": {
    code: 'import { StyleSheet } from "react-native";\nconst styles = StyleSheet.create({\n  card: { shadowOpacity: 0.2, shadowRadius: 8 },\n});',
  },
  "rn-no-non-native-navigator": {
    code: 'import { createStackNavigator } from "@react-navigation/stack";',
  },
  "rn-no-panresponder": {
    code: 'import { View, PanResponder } from "react-native";',
  },
  "rn-no-raw-text": {
    code: "const Screen = () => <View>Hello</View>;",
  },
  "rn-no-renderitem-key": {
    code: "\n      const App = ({ data }) => (\n        <FlatList data={data} renderItem={({ item }) => <Row key={item.id} value={item.value} />} />\n      );\n    ",
  },
  "rn-no-scroll-state": {
    code: "const C = () => {\n  const [showShadow, setShowShadow] = useState(false);\n  const handleScroll = (offset) => { if (offset > 100) setShowShadow(true); };\n  return <ScrollView onScroll={handleScroll} />;\n};",
  },
  "rn-no-scrollview-mapped-list": {
    code: "const C = ({ tracks }) => (\n  <ScrollView>\n    {tracks.map((track) => <Row key={track.id} track={track} />)}\n  </ScrollView>\n);",
  },
  "rn-no-set-native-props": {
    code: "inputRef.current.setNativeProps({ text: value });",
  },
  "rn-no-single-element-style-array": {
    code: "const C = () => <View style={[styles.box]} />;",
  },
  "rn-prefer-expo-image": {
    code: 'import { Image } from "react-native";\n',
    filePath: "/liveness-fixture-no-package/src/App.tsx",
    settings: { "react-doctor": { framework: "expo" } },
  },
  "rn-prefer-pressable": {
    code: 'import { TouchableOpacity } from "react-native";',
  },
  "rn-prefer-pressable-over-gesture-detector": {
    code: '\n      import { GestureDetector, Gesture } from "react-native-gesture-handler";\n      const Button = () => (\n        <GestureDetector gesture={Gesture.Tap()}>\n          <Animated.View />\n        </GestureDetector>\n      );\n    ',
  },
  "rn-prefer-reanimated": {
    code: 'import { Animated } from "react-native";',
  },
  "rn-pressable-shared-value-mutation": {
    code: 'import { Pressable } from "react-native";\nimport { useSharedValue } from "react-native-reanimated";\nconst PressCard = () => {\n  const scale = useSharedValue(1);\n  return <Pressable onPressIn={() => { scale.value = 0.97; }} />;\n};',
  },
  "rn-scrollview-dynamic-padding": {
    code: "const C = ({ keyboardHeight }) => <ScrollView contentContainerStyle={{ paddingBottom: keyboardHeight }} />;",
  },
  "rn-scrollview-flex-in-content-container": {
    code: "\n      const Screen = () => <ScrollView contentContainerStyle={{ flex: 1 }} />;\n    ",
  },
  "rn-style-prefer-boxshadow": {
    code: 'const C = () => <View style={{ shadowColor: "#000", shadowRadius: 4 }} />;',
  },
  "role-has-required-aria-props": {
    code: 'const T = () => <div role="switch" />;',
  },
  "role-supports-aria-props": {
    code: 'const F = () => <input type="text" aria-expanded />;',
  },
  "rules-of-hooks": {
    code: "\n        function Component() {\n          if (Math.random()) {\n            return null;\n          } else if (!useHasPermission()) {\n            return <Foo />\n          }\n          return <Content />;\n        }\n        ",
    settings: { "react-doctor": { rulesOfHooks: { allowedPascalCaseHookNamespaces: ["Sinon"] } } },
    forceJsx: true,
  },
  scope: {
    code: "<div scope />",
    forceJsx: true,
  },
  "secret-in-fallback": {
    code: 'const k = process.env.STRIPE_SECRET_KEY ?? "sk_live_abcdef123456";\n',
    filePath: "src/lib/stripe.ts",
  },
  "self-closing-comp": {
    code: 'var contentContainer = <div className="content"></div>;',
    forceJsx: true,
  },
  "server-after-nonblocking": {
    code: '"use server";\nexport const submitForm = async (formData) => {\n  analytics.track("form_submitted");\n  return { ok: true };\n};',
  },
  "server-auth-actions": {
    code: '"use server";\n      export async function deletePost(id) {\n        await db.delete(postTable).where(eq(postTable.id, id));\n      }',
    filePath: "app/actions/post.ts",
  },
  "server-cache-with-object-literal": {
    code: 'import { cache } from "react";\nconst getUser = cache(async (params) => db.user.find(params));\nexport const loadUser = async () => getUser({ id: 1 });',
  },
  "server-dedup-props": {
    code: "export default function UsersPage({ users }) {\n        return <ClientList users={users} usersOrdered={users.toSorted((a, b) => a.id - b.id)} />;\n      }",
    filePath: "src/app/users/page.tsx",
  },
  "server-fetch-without-revalidate": {
    code: 'export default async function Page(cacheKey) {\n  await fetch("https://api.example.com/feed", { [cacheKey]: "no-store" });\n  return null;\n}',
    filePath: "src/app/feed/page.tsx",
  },
  "server-hoist-static-io": {
    code: 'export async function GET(request){ const data = await readFile("./content/home.md", "utf8"); return Response.json(data); }',
    filePath: "app/content/route.ts",
  },
  "server-no-mutable-module-state": {
    code: '"use server";\nconst cache = new Map();\nexport async function remember(id, value) {\n  cache.set(id, value);\n}',
  },
  "server-sequential-independent-await": {
    code: 'import { headers } from "./my-io.js";\nexport default async function Page() {\n  const headersList = await headers();\n  const rows = await fetchRows();\n  return rows;\n}',
  },
  "state-in-constructor": {
    code: "\n                    class Foo extends React.Component {\n                      constructor(props) {\n                        super(props)\n                        this.state = { bar: 0 }\n                      }\n                      render() {\n                        return <div>Foo</div>\n                      }\n                    }\n                  ",
    settings: { "react-doctor": { stateInConstructor: { mode: "never" } } },
    forceJsx: true,
  },
  "style-prop-object": {
    code: "<div style=\"color: 'red'\" />",
    forceJsx: true,
  },
  "styled-components-duplicate-css-property-in-block": {
    code: 'import { css } from "styled-components"; const shared = css`opacity: ${p => p.$a ? 1 : 0}; opacity: ${p => p.$b ? 1 : 0.5};`;',
  },
  "styled-components-non-transient-custom-prop-on-intrinsic-element": {
    code: "const D = styled.div<{ selected: boolean }>`color: red;`;",
  },
  "supabase-client-owned-authz-field": {
    code: 'export const createTeam = async (name: string) => {\n  await supabase.from("teams").insert({ name, ownerId: currentUser.id, role: "admin" });\n};',
    filePath: "src/lib/create-team.ts",
  },
  "supabase-rls-policy-risk": {
    code: 'create policy "open writes" on posts for all using (true);\n',
    filePath: "supabase/migrations/0001_init.sql",
  },
  "supabase-table-missing-rls": {
    code: "create table public.notes (\n  id uuid primary key,\n  body text\n);",
    filePath: "supabase/migrations/20240101000000_init.sql",
  },
  "svg-filter-clickjacking-risk": {
    code: 'const A = ({ x }) => <iframe src={x} style={{ filter: "url(#warp)" }} />;',
    filePath: "src/embed.tsx",
  },
  "tabindex-no-positive": {
    code: "export const Form = () => <input tabIndex={3} />;",
    filePath: "src/components/checkout/Form.tsx",
  },
  "tanstack-start-get-mutation": {
    code: "const updateBundle = createServerFn().handler(async ({ data }) => {\n        await db.update({ id: data.id, status: data.status });\n      });",
  },
  "tanstack-start-loader-parallel-fetch": {
    code: "createFileRoute('/x')({ loader: async () => { const a = await fetchA(); const b = await fetchB(); return { a, b }; } });",
  },
  "tanstack-start-missing-head-content": {
    code: "export const Route = createRootRoute({\n  component: () => (\n    <html>\n      <head />\n      <body />\n    </html>\n  ),\n});",
    filePath: "src/routes/__root.tsx",
  },
  "r3f-no-advancing-clock-in-use-frame": {
    code: 'import { useFrame } from "@react-three/fiber"; useFrame((state) => state.clock.getDelta());',
  },
  "r3f-cap-device-pixel-ratio": {
    code: 'import { Canvas } from "@react-three/fiber"; const Scene = () => <Canvas dpr={window.devicePixelRatio} />;',
  },
  "r3f-limit-shadowed-point-lights": {
    code: 'import "@react-three/fiber"; const Scene = () => <><pointLight castShadow /><pointLight castShadow /><pointLight castShadow /></>;',
  },
  "r3f-no-async-use-frame": {
    code: 'import { useFrame } from "@react-three/fiber"; useFrame(async () => load());',
  },
  "r3f-no-allocation-in-pointer-move": {
    code: 'import "@react-three/fiber"; import { Vector3 } from "three"; const Scene = () => <mesh onPointerMove={() => new Vector3()} />;',
  },
  "r3f-no-clone-in-use-frame": {
    code: 'import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = () => { const mesh = useRef(null); useFrame(() => mesh.current.position.clone()); return <mesh ref={mesh} />; };',
  },
  "r3f-no-dispose-loader-cache": {
    code: 'import { useTexture } from "@react-three/drei"; const Scene = () => { const texture = useTexture(url); texture.dispose(); return null; };',
  },
  "r3f-no-duplicate-primitive-object": {
    code: 'import "@react-three/fiber"; const Scene = ({ scene }) => <><primitive object={scene} /><primitive object={scene} /></>;',
  },
  "r3f-no-deep-use-three-selector": {
    code: 'import { useThree } from "@react-three/fiber"; const zoom = useThree((state) => state.camera.zoom);',
  },
  "r3f-no-fresh-use-three-selector": {
    code: 'import { useThree } from "@react-three/fiber"; const pair = useThree((state) => [state.camera, state.scene]);',
  },
  "r3f-no-extend-in-render": {
    code: 'import { extend } from "@react-three/fiber"; const Scene = () => { extend({ CustomObject }); return <customObject />; };',
  },
  "r3f-no-extend-three-namespace": {
    code: 'import { extend } from "@react-three/fiber"; import * as THREE from "three"; extend(THREE);',
  },
  "r3f-no-fresh-portal-container": {
    code: 'import { createPortal } from "@react-three/fiber"; import { Scene } from "three"; const World = ({ enabled }) => createPortal(<mesh />, enabled ? {} : new Scene());',
  },
  "r3f-no-inline-resource-prop": {
    code: 'import { Canvas } from "@react-three/fiber"; import { MeshBasicMaterial } from "three"; const Scene = () => <Canvas><mesh material={new MeshBasicMaterial()} /></Canvas>;',
  },
  "r3f-no-inline-primitive-object": {
    code: 'import "@react-three/fiber"; const Scene = () => <primitive object={scene.clone()} />;',
  },
  "r3f-no-internal-imports": {
    code: 'import internal from "@react-three/fiber/dist/internal";',
  },
  "r3f-no-imperative-attach-of-managed-ref": {
    code: 'import { useRef } from "react"; import "@react-three/fiber"; import { Scene as ThreeScene } from "three"; const Scene = () => { const group = useRef(null); const scene = new ThreeScene(); scene.add(group.current); return <group ref={group} />; };',
  },
  "r3f-no-mutate-loader-cache": {
    code: 'import { useGLTF } from "@react-three/drei"; const Scene = () => { const { nodes } = useGLTF(url); nodes.Mesh.geometry.center(); return null; };',
  },
  "r3f-no-manual-canvas-resize": {
    code: 'import { useThree } from "@react-three/fiber"; const Scene = () => { const gl = useThree((state) => state.gl); window.addEventListener("resize", () => gl.setSize(1, 1)); return null; };',
  },
  "r3f-no-mutating-pointer-event-data": {
    code: 'import "@react-three/fiber"; const Scene = () => <mesh onPointerMove={(event) => event.point.normalize()} />;',
  },
  "r3f-no-new-in-use-frame": {
    code: 'import { useFrame } from "@react-three/fiber"; useFrame(() => new Vector3());',
  },
  "r3f-no-object-pointer-capture": {
    code: 'import { Canvas } from "@react-three/fiber"; const Scene = () => <mesh onPointerDown={(event) => event.object.setPointerCapture(event.pointerId)} />;',
  },
  "r3f-no-null-loader-input": {
    code: 'import { useLoader } from "@react-three/fiber"; const Scene = () => { useLoader(TextureLoader, null); return null; };',
  },
  "r3f-no-recursive-raf-with-use-frame": {
    code: 'import { useFrame } from "@react-three/fiber"; const Scene = () => { useFrame(update); const animate = () => requestAnimationFrame(animate); requestAnimationFrame(animate); return null; };',
  },
  "r3f-prefer-use-loader": {
    code: 'import "@react-three/fiber"; import { useEffect } from "react"; import { TextureLoader } from "three"; const Scene = ({ url }) => { useEffect(() => { new TextureLoader().load(url, setTexture); }, [url]); return <mesh />; };',
  },
  "r3f-no-state-in-use-frame": {
    code: 'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(0); useFrame(() => setCount(count + 1)); };',
  },
  "r3f-no-state-in-pointer-move": {
    code: 'import { useState } from "react"; import "@react-three/fiber"; const Scene = () => { const [point, setPoint] = useState(null); return <mesh onPointerMove={(event) => setPoint(event.point)} />; };',
  },
  "r3f-no-sync-readback-in-use-frame": {
    code: 'import { useFrame } from "@react-three/fiber"; useFrame(({ gl }) => gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));',
  },
  "r3f-no-unstable-args": {
    code: 'import { Canvas } from "@react-three/fiber"; import { Vector3 } from "three"; const Scene = () => <shapeGeometry args={[new Vector3()]} />;',
  },
  "r3f-no-use-frame-dependency-array": {
    code: 'import { useFrame } from "@react-three/fiber"; useFrame(() => update(), []);',
  },
  "r3f-require-frame-delta": {
    code: 'import { useFrame } from "@react-three/fiber"; useFrame(({ scene }) => { scene.rotation.y += 0.01; });',
  },
  "r3f-require-global-effect-cleanup": {
    code: 'import { useEffect } from "react"; import { addEffect } from "@react-three/fiber"; const Scene = () => { useEffect(() => { addEffect(update); }, []); return null; };',
  },
  "r3f-require-instanced-buffer-update": {
    code: 'import "@react-three/fiber"; import { useRef } from "react"; const Scene = () => { const meshRef = useRef(null); const update = () => { meshRef.current.setMatrixAt(0, matrix); }; return <instancedMesh ref={meshRef} />; };',
  },
  "r3f-require-owned-texture-cleanup": {
    code: 'import { useMemo } from "react"; import { CanvasTexture } from "three"; const Scene = ({ canvas }) => { const texture = useMemo(() => new CanvasTexture(canvas), [canvas]); return <meshStandardMaterial map={texture} />; };',
  },
  "r3f-require-projection-matrix-update": {
    code: 'import { useFrame } from "@react-three/fiber"; useFrame(({ camera }) => { camera.aspect = 2; });',
  },
  "r3f-require-render-with-positive-priority": {
    code: 'import { useFrame } from "@react-three/fiber"; const Scene = () => { useFrame(() => update(), 1); return null; };',
  },
  "r3f-require-root-unmount": {
    code: 'import { createRoot } from "@react-three/fiber"; const Scene = ({ canvas }) => { const root = createRoot(canvas); root.render(<mesh />); return null; };',
  },
  "r3f-webgpu-canvas-prop-compatibility": {
    code: 'import { Canvas } from "@react-three/fiber/webgpu"; const Scene = () => <Canvas gl={{ antialias: true }} />;',
  },
  "r3f-webgpu-no-legacy-effect-composer": {
    code: 'import { Canvas } from "@react-three/fiber/webgpu"; import { EffectComposer } from "@react-three/postprocessing"; const Scene = () => <Canvas><EffectComposer /></Canvas>;',
  },
  "r3f-webgpu-no-legacy-material-api": {
    code: 'import { Canvas } from "@react-three/fiber/webgpu"; const Scene = () => <Canvas><shaderMaterial /></Canvas>;',
  },
  "three-require-controls-cleanup": {
    code: 'import { useMemo } from "react"; import { OrbitControls } from "three/addons/controls/OrbitControls.js"; import "@react-three/fiber"; const Scene = ({ camera, element }) => { const controls = useMemo(() => new OrbitControls(camera, element), [camera, element]); return <primitive object={controls} />; };',
  },
  "three-require-animation-mixer-cleanup": {
    code: 'import { useMemo } from "react"; import { AnimationMixer } from "three"; const Scene = ({ root, clip }) => { const mixer = useMemo(() => new AnimationMixer(root), [root]); mixer.clipAction(clip); return null; };',
  },
  "r3f-webgpu-no-gl-state": {
    code: 'import { useThree } from "@react-three/fiber/webgpu"; const renderer = useThree((state) => state.gl);',
  },
  "r3f-webgpu-no-js-uniform-branch": {
    code: 'import { useLocalNodes } from "@react-three/fiber/webgpu"; useLocalNodes(({ uniforms }) => { if (uniforms.mode.value) return { colorNode: red }; return { colorNode: blue }; });',
  },
  "r3f-webgpu-no-unregistered-pipeline-pass": {
    code: 'import { useRenderPipeline } from "@react-three/fiber/webgpu"; useRenderPipeline(({ passes }) => { passes.custom = customPass; });',
  },
  "three-require-render-target-cleanup": {
    code: 'import { useMemo } from "react"; import { WebGLRenderTarget } from "three"; const Scene = () => { const target = useMemo(() => new WebGLRenderTarget(1, 1), []); target.width; return null; };',
  },
  "three-require-renderer-cleanup": {
    code: 'import { useMemo } from "react"; import { WebGLRenderer } from "three"; const Scene = ({ canvas }) => { const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]); renderer.render(scene, camera); return null; };',
  },
  "three-require-postprocessing-cleanup": {
    code: 'import { useMemo } from "react"; import "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const Scene = ({ renderer }) => { const composer = useMemo(() => new EffectComposer(renderer), [renderer]); composer.render(); return null; };',
    settings: { "react-doctor": { capabilities: ["three", "three:145", "three:146"] } },
  },
  "tanstack-start-no-anchor-element": {
    code: 'const C = () => <a href="/dashboard">Go</a>;',
    filePath: "src/routes/index.tsx",
    forceJsx: true,
  },
  "tanstack-start-no-direct-fetch-in-loader": {
    code: 'export const Route = createFileRoute("/todos")({\n        loader: async () => {\n          const response = await fetch("/api/todos");\n          return response.json();\n        },\n      });',
  },
  "tanstack-start-no-dynamic-server-fn-import": {
    code: 'export const load = async () => {\n  const { getUser } = await import("~/utils/users.functions");\n  return getUser();\n};',
  },
  "tanstack-start-no-navigate-in-render": {
    code: "function RouteComponent() { const navigate = useNavigate(); navigate({ to: '/' }); return null; }",
    filePath: "src/routes/index.tsx",
    forceJsx: true,
  },
  "tanstack-start-no-secrets-in-loader": {
    code: "createFileRoute('/x')({ loader: async () => { return process.env.STRIPE_SECRET_KEY; } });",
  },
  "tanstack-start-no-use-server-in-handler": {
    code: 'const getData = createServerFn().handler(async () => {\n        "use server";\n        return loadData();\n      });',
  },
  "tanstack-start-no-useeffect-fetch": {
    code: "function Route() { useEffect(() => { fetch(url).then(setData); }, []); return null; }",
    filePath: "src/routes/index.tsx",
    forceJsx: true,
  },
  "tanstack-start-redirect-in-try-catch": {
    code: "async function load() { try { throw redirect({ to: '/login' }); } catch (error) { console.error(error); return null; } }",
  },
  "tanstack-start-route-property-order": {
    code: 'export const Route = createFileRoute("/")({\n  loader: async () => ({}),\n  params: { parse: (raw) => raw },\n});',
    filePath: "src/routes/index.tsx",
  },
  "tanstack-start-server-fn-method-order": {
    code: 'createServerFn({ method: "POST" })\n        .handler(async ({ data }) => data)\n        .validator((input) => input);',
  },
  "tanstack-start-server-fn-validate-input": {
    code: "createServerFn().handler(({ data }) => data);",
  },
  "tenant-static-proxy-risk": {
    code: "export const GET = async (request) => fetch(`${CDN_BASE}/${tenant}/${assetPath}`);\n",
    filePath: "app/api/static/route.ts",
  },
  "unsafe-json-in-html": {
    code: "export const buildHtml = (data: unknown) => `\n  <script>window.__DATA__ = ${JSON.stringify(data)};</script>\n`;\n",
    filePath: "src/server/handler.ts",
  },
  "untrusted-redirect-following": {
    code: 'export const GET = (request) => fetch(request.nextUrl.searchParams.get("url"));\n',
    filePath: "app/api/preview/route.ts",
  },
  "url-prefilled-privileged-action": {
    code: 'const searchParams = useSearchParams();\nconst invitedRole = searchParams.get("role");\n',
    filePath: "src/app/invite/page.tsx",
  },
  "use-lazy-motion": {
    code: 'import { motion } from "framer-motion";\nconst El = () => <motion.div animate={{ opacity: 1 }} />;',
  },
  "valtio-no-proxy-read-in-render": {
    code: 'import { useSnapshot } from "valtio";\nexport const Count = ({ state }) => { const snapshot = useSnapshot(state); return <span>{state.count}</span>; };',
  },
  "valtio-no-snapshot-in-callback": {
    code: 'import { useSnapshot } from "valtio"; function Counter() { const snap = useSnapshot(state); return <button onClick={() => console.log(snap.count)}>read</button>; }',
  },
  "void-dom-elements-no-children": {
    code: "const a = <img>hi</img>;",
  },
  "waapi-animation-in-render": {
    code: 'const Card = () => { const node = document.createElement("div"); node.animate([{ opacity: 0 }, { opacity: 1 }], 200); return <div />; };',
  },
  "web-animation-offsets-valid": {
    code: 'const node = document.createElement("div"); node.animate([{ opacity: 0, offset: 0.8 }, { opacity: 1, offset: 0.2 }], 200);',
  },
  "webhook-signature-risk": {
    code: "export async function POST(request: Request) {\n  const event = await request.json();\n  await applyEvent(event);\n  return Response.json({ ok: true });\n}\n",
    filePath: "src/app/api/webhooks/github/route.ts",
  },
  "zustand-no-fresh-selector-result": {
    code: 'import { create } from "zustand";\nconst useStore = create(() => ({ count: 0 }));\nconst summary = useStore((state) => ({ count: state.count }));',
  },
  "zustand-no-get-during-initialization": {
    code: 'import { create } from "zustand";\nconst useStore = create((_set, get) => ({ count: get().count }));',
  },
  "zustand-no-mutating-state": {
    code: '\n      import { create } from "zustand";\n      create((set) => ({ items: [], update: () => set((state) => { state.items.push("next"); return { items: state.items }; }) }));\n    ',
  },
  "window-open-without-noopener": {
    code: "window.open(url);",
  },
  "html-no-nested-form": {
    code: "const Form = () => <form><form /></form>;",
  },
  "motion-animate-presence-requires-key": {
    code: 'import { AnimatePresence } from "motion/react";\nconst Stack = () => <AnimatePresence><Panel /><Panel /></AnimatePresence>;',
  },
  "motion-animate-presence-must-outlive-child": {
    code: 'import { AnimatePresence, motion } from "motion/react";\nconst Panel = ({ open }) => open && <AnimatePresence><motion.div exit={{ opacity: 0 }} /></AnimatePresence>;',
  },
  "motion-animate-presence-wait-single-child": {
    code: 'import { AnimatePresence } from "motion/react";\nconst Stack = () => <AnimatePresence mode="wait"><Panel key="a" /><Panel key="b" /></AnimatePresence>;',
  },
  "motion-create-in-render": {
    code: 'import { motion } from "motion/react";\nconst Card = () => { const MotionCard = motion.create("article"); return <MotionCard />; };',
  },
  "motion-imperative-animation-in-render": {
    code: 'import { animate } from "motion/react";\nconst Card = () => { animate(".card", { opacity: 1 }); return <article className="card" />; };',
  },
  "motion-drag-axis-constraint-mismatch": {
    code: 'import { motion } from "motion/react";\nconst Slider = () => <motion.div drag="x" dragConstraints={{ top: -20, bottom: 20 }} />;',
  },
  "motion-keyframe-times-mismatch": {
    code: 'import { motion } from "motion/react";\nconst Fade = () => <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ times: [0, 1] }} />;',
  },
  "motion-layout-on-inline-element": {
    code: 'import { motion } from "motion/react";\nconst Label = () => <motion.span layout className="inline">Label</motion.span>;',
  },
  "motion-use-transform-range-length": {
    code: 'import { useTransform } from "motion/react";\nconst opacity = useTransform(progress, [0, 0.5, 1], [0, 1]);',
  },
  "motion-unstable-layout-id-in-iteration": {
    code: 'import { motion } from "motion/react";\nconst Cards = ({ cards }) => cards.map(() => <motion.article layoutId="card" />);',
  },
  "motion-value-constructor-in-render": {
    code: 'import { motionValue } from "motion/react";\nconst Meter = ({ value }) => { const progress = motionValue(value); return <output>{progress.get()}</output>; };',
  },
  "motion-value-subscription-in-render": {
    code: 'import { useMotionValue } from "motion/react";\nconst Meter = () => { const progress = useMotionValue(0); progress.on("change", console.log); return <output>{progress.get()}</output>; };',
  },
  "no-assertive-status": {
    code: 'const Status = () => <div role="status" aria-live="assertive" />;',
  },
  "no-img-without-dimensions": {
    code: 'const Avatar = () => <img src="/avatar.jpg" alt="Ada" />;',
  },
  "no-inert-sticky-position": {
    code: 'const Header = () => <header className="sticky" />;',
  },
  "no-inert-pointer-affordance": {
    code: 'const Card = () => <article className="cursor-pointer">Open</article>;',
  },
  "no-tiny-uppercase-tracked-label": {
    code: 'const Label = () => <span className="text-[10px] uppercase tracking-wide">Recent activity</span>;',
  },
  "no-invalid-progress-range": {
    code: "const Progress = () => <progress value={11} max={10} />;",
  },
  "no-pointer-disabled-enabled-control": {
    code: 'const Action = () => <button className="pointer-events-none">Save</button>;',
  },
  "no-layout-shifting-interaction-state": {
    code: 'const Button = () => <button className="hover:px-6">Save</button>;',
  },
  "no-small-form-control-text": {
    code: 'const Form = () => <input className="text-sm" />;',
  },
  "no-smooth-scroll-without-reduced-motion": {
    code: 'const Page = () => <main className="scroll-smooth" />;',
  },
  "no-undersized-icon-button": {
    code: 'const Close = () => <button aria-label="Close" className="size-4 p-0"><CloseIcon /></button>;',
  },
  "no-aria-invalid-without-description": {
    code: "const Field = () => <input aria-invalid />;",
  },
  "role-button-requires-complete-keyboard-activation": {
    code: 'const Action = () => <div role="button" tabIndex={0} onClick={activate} onKeyDown={(event) => { if (event.key === "Enter") activate(); }}>Save</div>;',
  },
  "no-fixed-inside-transformed-ancestor": {
    code: 'const Overlay = () => <div className="scale-95"><div className="fixed" /></div>;',
  },
  "no-focusable-content-in-aria-hidden": {
    code: 'const Hidden = () => <div aria-hidden><button type="button">Save</button></div>;',
  },
  "no-generic-purple-blue-icon-gradient": {
    code: 'const Icon = () => <div className="size-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex"><BotIcon /></div>;',
  },
  "no-hover-only-reveal": {
    code: 'const Action = () => <button className="opacity-0 hover:opacity-100" />;',
  },
  "no-invisible-focus-control": {
    code: 'const Select = () => <select className="absolute inset-0 opacity-0"><option>UTC</option></select>;',
  },
  "no-multiple-unlabeled-navigation-landmarks": {
    code: "const Page = () => <><nav /><nav /></>;",
  },
  "no-srcset-without-sizes": {
    code: 'const Hero = () => <img srcSet="small.jpg 640w, large.jpg 1280w" alt="" />;',
  },
  "no-ungated-tailwind-animation": {
    code: 'const Spinner = () => <span className="animate-spin" />;',
  },
  "shadcn-tabs-trigger-requires-list": {
    code: 'import { TabsTrigger } from "./tabs";\nconst Trigger = () => <TabsTrigger value="a" />;',
  },
  "data-table-requires-accessible-name": {
    code: "const Results = () => <table><tr><th>Name</th></tr></table>;",
  },
  "details-requires-summary": {
    code: "const Help = () => <details><p>Answer</p></details>;",
  },
  "fieldset-requires-legend": {
    code: "const Group = () => <fieldset><input /><input /></fieldset>;",
  },
  "form-control-requires-name": {
    code: "const Form = () => <form><input /></form>;",
  },
  "html-label-has-single-control": {
    code: "const Range = () => <label><input /><input /></label>;",
  },
  "no-mixed-srcset-descriptors": {
    code: 'const Image = () => <img srcSet="small.jpg 640w, large.jpg 2x" />;',
  },
  "no-multiple-main-landmarks": {
    code: "const Page = () => <><main /><main /></>;",
  },
  "no-nonresizable-textarea": {
    code: 'const Editor = () => <textarea className="resize-none" />;',
  },
  "no-decorative-blur-orb": {
    code: 'const Hero = () => <div className="absolute size-96 rounded-full bg-purple-500 blur-3xl" />;',
  },
  "no-excessive-centered-copy": {
    code: 'const Page = () => <main><p className="text-center">Build polished interfaces with a workflow that keeps every decision visible.</p><p className="text-center">Move from an initial idea to a working result without losing important context.</p><p className="text-center">Keep the whole team aligned with clear updates and shared project history.</p></main>;',
  },
  "no-excessive-motion-stagger": {
    code: 'import { motion } from "motion/react"; const List = () => <motion.ul transition={{ staggerChildren: 0.2 }} />;',
  },
  "no-excessive-pill-treatment": {
    code: 'const Page = () => <main><span className="rounded-full border px-3">Fast</span><span className="rounded-full border px-3">Safe</span><span className="rounded-full border px-3">Simple</span><span className="rounded-full border px-3">Clear</span><span className="rounded-full border px-3">New</span></main>;',
  },
  "no-full-viewport-centered-hero": {
    code: 'const Hero = () => <section className="flex min-h-dvh items-center justify-center"><h1>Build faster</h1></section>;',
  },
  "no-repeated-emoji-tiles": {
    code: 'const Page = () => <main><span className="size-12 rounded-xl bg-blue-100">🚀</span><span className="size-12 rounded-xl bg-green-100">🔒</span><span className="size-12 rounded-xl bg-amber-100">⚡</span></main>;',
  },
  "no-repeated-placeholder-navigation": {
    code: 'const Nav = () => <nav><a href="#">Home</a><a href="#">Settings</a></nav>;',
  },
  "no-repeated-glass-surfaces": {
    code: 'const Page = () => <main><div className="rounded-xl border bg-white/10 backdrop-blur-xl" /><div className="rounded-xl border bg-white/10 backdrop-blur-xl" /><div className="rounded-xl border bg-white/10 backdrop-blur-xl" /></main>;',
  },
  "no-uniform-feature-card-grid": {
    code: 'const Features = () => <section className="grid grid-cols-3"><article className="rounded-xl border p-6"><h3>Fast</h3><p>Finish sooner.</p></article><article className="rounded-xl border p-6"><h3>Safe</h3><p>Protect changes.</p></article><article className="rounded-xl border p-6"><h3>Simple</h3><p>Stay focused.</p></article></section>;',
  },
  "no-excessive-card-surfaces": {
    code: 'const Page = () => <main><section className="rounded-xl border p-6">A</section><section className="rounded-xl border p-6">B</section><section className="rounded-xl border p-6">C</section><section className="rounded-xl border p-6">D</section><section className="rounded-xl border p-6">E</section><section className="rounded-xl border p-6">F</section></main>;',
  },
  "no-empty-card-shell": {
    code: 'const Empty = () => <section className="rounded-xl border bg-white p-6" />;',
  },
  "no-emoji-heading-decoration": {
    code: "const Heading = () => <h2>🎧 Audio formats</h2>;",
  },
  "no-mixed-icon-libraries": {
    code: 'import { Search } from "lucide-react"; import { HomeIcon } from "@heroicons/react/24/outline"; const Toolbar = () => <><Search /><HomeIcon /></>;',
  },
  "no-pill-navigation-count": {
    code: 'const Sidebar = () => <nav><span className="rounded-full bg-gray-200 px-2">12</span></nav>;',
  },
  "no-redundant-title-tooltip": {
    code: 'const Save = () => <button title="Save changes">Save changes</button>;',
  },
  "no-symmetric-text-button-padding": {
    code: 'const Save = () => <button className="rounded-md bg-blue-600 p-3">Save changes</button>;',
  },
  "no-pure-black-shadow": {
    code: 'const Card = () => <div style={{ boxShadow: "0 10px 30px #000" }} />;',
  },
  "no-repeated-section-shells": {
    code: 'const Page = () => <main><section className="py-20"><div className="mx-auto max-w-6xl">A</div></section><section className="py-24"><div className="mx-auto max-w-6xl">B</div></section><section className="py-20"><div className="mx-auto max-w-6xl">C</div></section></main>;',
  },
  "no-tight-display-tracking": {
    code: 'const Hero = () => <h1 className="tracking-tighter">Build faster</h1>;',
  },
  "no-uppercase-mono-label": {
    code: 'const Label = () => <span className="font-mono uppercase tracking-widest">System online</span>;',
  },
  "no-uppercase-tracked-navigation-label": {
    code: 'const Sidebar = () => <aside><span className="uppercase tracking-widest">Workspace</span></aside>;',
  },
  "require-scale-reveal-transform-origin": {
    code: 'import { motion } from "motion/react"; const Menu = () => <motion.div role="menu" initial={{ scale: 0.96 }} />;',
  },
  "no-decorative-pulse": {
    code: 'const Hero = () => <span className="animate-pulse">New feature</span>;',
  },
  "no-excessive-font-families": {
    code: 'const Page = () => <main><h1 style={{ fontFamily: "Fraunces" }}>Title</h1><p style={{ fontFamily: "Inter" }}>Body</p><code style={{ fontFamily: "JetBrains Mono" }}>Code</code><aside style={{ fontFamily: "Caveat" }}>Note</aside></main>;',
  },
  "no-fake-browser-chrome": {
    code: 'const Preview = () => <div className="overflow-hidden rounded-xl border"><div><div><span className="size-3 rounded-full bg-red-500" /><span className="size-3 rounded-full bg-yellow-500" /><span className="size-3 rounded-full bg-green-500" /></div></div></div>;',
  },
  "no-overloaded-hover-state": {
    code: 'const Card = () => <article className="hover:-translate-y-1 hover:shadow-xl hover:bg-white" />;',
  },
  "no-placeholder-persona-copy": {
    code: "const Page = () => <main><p>Jane Doe</p></main>;",
  },
  "no-repeated-hover-scale": {
    code: 'const Grid = () => <main><article className="hover:scale-105" /><article className="hover:scale-105" /><article className="hover:scale-105" /></main>;',
  },
  "no-tight-all-caps-heading": {
    code: 'const Hero = () => <h1 className="uppercase leading-none">Infrastructure for every engineering team</h1>;',
  },
  "no-transitioned-focus-ring": {
    code: 'const Button = () => <button className="transition-shadow focus-visible:ring-2">Save</button>;',
  },
  "prefer-tabular-numeric-data": {
    code: "const Row = ({ total }) => <tr><td>{total.toLocaleString()}</td></tr>;",
  },
  "require-autoplay-video-poster": {
    code: 'const Hero = () => <video autoPlay muted src="/demo.mp4" />;',
  },
  "aria-braille-equivalent": {
    code: 'const Save = () => <button aria-braillelabel="sv" />;',
  },
  "empty-table-header": {
    code: "const Table = () => <table><tbody><tr><th /></tr></tbody></table>;",
  },
  "html-xml-lang-mismatch": {
    code: 'const Page = () => <html lang="en" xml:lang="fr" />;',
  },
  "iframe-title-unique": {
    code: 'const View = () => <><iframe title="Map" /><iframe title="Map" /></>;',
  },
  "no-aria-hidden-on-body": {
    code: 'const Page = () => <body aria-hidden="true" />;',
  },
  "no-duplicate-static-id-reference": {
    code: 'const Form = () => <><label htmlFor="email">Email</label><input id="email" /><input id="email" /></>;',
  },
  "no-focusable-content-in-role-text": {
    code: 'const View = () => <span role="text"><button>Open</button></span>;',
  },
  "no-server-side-image-map": {
    code: 'const Map = () => <img alt="Campus" src="map.png" isMap />;',
  },
  "no-presentation-role-conflict": {
    code: 'const Control = () => <div role="presentation" tabIndex={0} />;',
  },
  "react-router-csp-nonce-consistency": {
    code: 'import { ServerRouter } from "react-router";\nimport { renderToPipeableStream } from "react-dom/server";\nexport const render = (request, context) => renderToPipeableStream(<ServerRouter context={context} url={request.url} nonce={context.nonce} />, {});',
  },
  "react-router-descendant-routes-require-splat": {
    code: 'import { createBrowserRouter, useRoutes } from "react-router";\ncreateBrowserRouter([{ path: "account", Component: () => useRoutes([]) }]);',
  },
  "react-router-guard-aborted-handle-error": {
    code: "export function handleError(error, { request }) { console.error(error); }",
    filePath: "/project/app/entry.server.tsx",
    settings: reactRouterFrameworkSettings,
  },
  "react-router-internal-route-anchor": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ path: "/about", element: <About /> }]);\nexport const Nav = () => <a href="/about">About</a>;',
  },
  "react-router-loader-fetch-forwards-signal": {
    code: 'export async function loader({ request }) { return fetch("/api/profile"); }',
    ...reactRouterFrameworkRouteFixture,
  },
  "react-router-loader-parallel-fetch": {
    code: 'export async function loader() { const user = await fetch("/api/user"); const teams = await fetch("/api/teams"); return { user, teams }; }',
    ...reactRouterFrameworkRouteFixture,
  },
  "react-router-nested-route-requires-outlet": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ Component: () => <main />, children: [{ path: "child", element: <Child /> }] }]);',
  },
  "react-router-no-catch-middleware-next": {
    code: "export const middleware = [async (_context, next) => { try { return await next(); } catch (error) { report(error); } }];",
  },
  "react-router-no-client-module-in-server-render": {
    code: 'import ClientCard from "./card.client";\nexport default function Route() { return <ClientCard />; }',
  },
  "react-router-no-duplicate-route-id": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ id: "root", path: "/" }, { id: "root", path: "/other" }]);',
  },
  "react-router-no-empty-leaf-route": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ path: "/" }]);',
  },
  "react-router-no-invalid-absolute-child-path": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ path: "/app", children: [{ path: "/settings", element: <Settings /> }] }]);',
  },
  "react-router-no-invalid-lazy-route-properties": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ path: "/", lazy: async () => ({ path: "/changed", Component }) }]);',
  },
  "react-router-no-invalid-splat-path": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ path: "files*", element: <Files /> }]);',
  },
  "react-router-no-loader-request-body": {
    code: "export async function loader({ request }) { return request.formData(); }",
    ...reactRouterFrameworkRouteFixture,
  },
  "react-router-no-middleware-response-body-consumption": {
    code: "export const middleware = [async (_context, next) => { const response = await next(); await response.json(); return response; }];",
  },
  "react-router-no-multiple-blockers": {
    code: 'import { useBlocker } from "react-router";\nexport const Form = () => { useBlocker(true); useBlocker(false); return <form />; };',
    settings: { "react-doctor": { capabilities: ["react-router:6.19"] } },
  },
  "react-router-no-multiple-middleware-next": {
    code: "export const middleware = [async (_context, next) => { await next(); return next(); }];",
  },
  "react-router-no-multiple-set-search-params-in-tick": {
    code: 'import { useSearchParams } from "react-router";\nexport const Filters = () => { const [, setSearchParams] = useSearchParams(); const apply = () => { setSearchParams({ q: "one" }); setSearchParams({ page: "2" }); }; return <button onClick={apply} />; };',
  },
  "react-router-no-navigate-in-render": {
    code: 'import { useNavigate } from "react-router";\nexport const Gate = ({ denied }) => { const navigate = useNavigate(); if (denied) navigate("/login"); return null; };',
  },
  "react-router-no-nested-router": {
    code: 'import { BrowserRouter, MemoryRouter } from "react-router";\nexport const App = () => <BrowserRouter><MemoryRouter><Page /></MemoryRouter></BrowserRouter>;',
  },
  "react-router-no-redirect-in-try-catch": {
    code: 'import { redirect } from "react-router";\nexport async function loader() { try { throw redirect("/login"); } catch (error) { return null; } }',
    ...reactRouterFrameworkRouteFixture,
  },
  "react-router-no-route-module-environment-suffix": {
    code: "export default function Route() { return null; }",
    filePath: "/project/app/routes/dashboard.server.tsx",
  },
  "react-router-no-router-in-render": {
    code: 'import { createBrowserRouter } from "react-router";\nexport const App = () => { const router = createBrowserRouter([]); return <RouterProvider router={router} />; };',
  },
  "react-router-no-session-mutation-in-loader": {
    code: 'import { createCookieSessionStorage } from "react-router";\nconst { getSession } = createCookieSessionStorage({ cookie: { name: "session" } });\nexport async function loader({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("notice", "hello"); return null; }',
    ...reactRouterFrameworkRouteFixture,
  },
  "react-router-no-static-cookie-expires": {
    code: 'import { createCookie } from "react-router";\nexport const cookie = createCookie("session", { expires: new Date(Date.now() + 1000) });',
  },
  "react-router-no-unsynchronized-search-params-mutation": {
    code: 'import { useSearchParams } from "react-router";\nexport const Filters = () => { const [searchParams] = useSearchParams(); searchParams.set("q", "react"); return null; };',
  },
  "react-router-no-use-loader-data-in-error-ui": {
    code: 'import { useLoaderData } from "react-router";\nexport function ErrorBoundary() { const data = useLoaderData(); return <pre>{data.message}</pre>; }',
    ...reactRouterFrameworkRouteFixture,
  },
  "react-router-prefer-route-lazy": {
    code: 'import { lazy } from "react";\nimport { createBrowserRouter } from "react-router";\nconst Page = lazy(() => import("./page"));\ncreateBrowserRouter([{ path: "/", Component: Page }]);',
  },
  "react-router-require-root-error-boundary": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ path: "/", element: <App /> }]);',
  },
  "react-router-resource-link-requires-reload": {
    code: 'import { createBrowserRouter, Link } from "react-router";\ncreateBrowserRouter([{ path: "/guide.pdf", loader: loadGuide }]);\nexport const Download = () => <Link to="/guide.pdf">Guide</Link>;',
  },
  "react-router-return-navigation-promise-in-transition": {
    code: 'import { startTransition } from "react";\nimport { RouterProvider, useNavigate } from "react-router";\nexport const App = ({ router }) => <RouterProvider router={router} useTransitions />;\nexport const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => { navigate("/next"); })} />; };',
    settings: { "react-doctor": { capabilities: ["react-router:7.15"] } },
  },
  "react-router-server-middleware-return-response": {
    code: "export const middleware = [async (_context, next) => { await next(); }];",
  },
  "react-router-session-mutation-requires-commit": {
    code: 'import { createCookieSessionStorage } from "react-router";\nconst { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } });\nexport async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); return null; }',
    ...reactRouterFrameworkRouteFixture,
  },
  "react-router-v8-no-meta-data-field": {
    code: 'import { useMatches } from "react-router";\nexport function Breadcrumbs() { const [{ data }] = useMatches(); return data.title; }',
  },
  "react-router-v8-no-react-router-dom-import": {
    code: 'import { Link } from "react-router-dom";\nexport const Home = () => <Link to="/" />;',
  },
  "react-router-v8-no-removed-future-flags": {
    code: "export default { future: { v8_middleware: true } };",
    filePath: "react-router.config.ts",
  },
  "react-router-valid-route-object": {
    code: 'import { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ index: true, children: [{ path: "child", element: <Child /> }] }]);',
  },
  "zod-v4-no-deprecated-error-apis": {
    code: '\n      import { z } from "zod";\n      const error = z.ZodError.create([]);\n    ',
  },
  "zod-v4-no-deprecated-error-customization": {
    code: '\n      import { z } from "zod";\n      const schema = z.string("Required");\n    ',
  },
  "zod-v4-no-deprecated-schema-apis": {
    code: '\n      import { z } from "zod";\n      const strict = z.object({}).strict();\n      const pass = z.object({}).passthrough();\n      const merged = z.object({ a: z.string() }).merge(z.object({ b: z.string() }));\n    ',
  },
  "zod-v4-prefer-top-level-string-formats": {
    code: '\n      import { z } from "zod";\n      const schema = z.string().email();\n    ',
  },
  "zustand-no-whole-store-destructure": {
    code: '\n      import { create } from "zustand";\n      const useBearStore = create(() => ({ bears: 0 }));\n      export const BearCounter = () => {\n        const { bears } = useBearStore();\n        return <span>{bears}</span>;\n      };\n    ',
  },
};
