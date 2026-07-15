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
  "effect-listener-cleanup-mismatch": {
    code: 'import { useEffect } from "react";\nexport const Listener = () => {\n  useEffect(() => {\n    window.addEventListener("resize", () => resize());\n    return () => window.removeEventListener("resize", () => resize());\n  }, []);\n  return null;\n};',
  },
  "effect-needs-cleanup": {
    code: 'import { useEffect } from "react";\nexport const WatchForm = ({ form }) => {\n  useEffect(() => form.watch((value) => {\n    console.log(value);\n  }), [form]);\n  return null;\n};',
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
    code: 'const AuthFooter = () => (\n        <a href="https://internxt.com/legal" target="_blank" className="auth-footer-link">\n          legal\n        </a>\n      );',
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
  "mouse-events-have-key-events": {
    code: "<div onMouseOver={() => {}} />",
  },
  "nextjs-async-client-component": {
    code: '"use client";\nexport default async function Profile() {\n  const data = await loadProfile();\n  return <div>{data.name}</div>;\n}',
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
    code: 'const Layout = () => (\n        <head>\n          <script src="https://widget.example.com/embed.js" />\n        </head>\n      );',
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
    code: 'function Field({ value }) {\n        const [draft, setDraft] = useState("");\n        useEffect(() => {\n          setDraft(value);\n        }, [value]);\n        return <input value={draft} />;\n      }',
  },
  "no-aria-hidden-on-focusable": {
    code: 'export const A = () => <button aria-hidden={true} type="button">x</button>;',
  },
  "no-array-index-as-key": {
    code: 'const STEPS = [\n  { title: "Install", body: "npm i" },\n  { title: "Run", body: "npm start" },\n];\nconst Steps = () => (\n  <ol>\n    {STEPS.map((step, index) => (\n      <StepCard key={index} title={step.title} body={step.body} />\n    ))}\n  </ol>\n);\n',
  },
  "no-array-index-key": {
    code: "const rows = things.map((thing, index) => React.cloneElement(thing, { key: index }));",
  },
  "no-async-effect-callback": {
    code: "\n      const Profile = ({ id }) => {\n        useEffect(async () => {\n          const user = await load(id);\n          setUser(user);\n        }, [id]);\n        return null;\n      };\n      ",
  },
  "no-autofocus": {
    code: "export const SearchPage = () => (\n        <main>\n          <input autoFocus />\n        </main>\n      );",
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
  "no-create-context-in-render": {
    code: '\n      import { createContext } from "react";\n\n      function App() {\n        const Ctx = createContext(null);\n        return null;\n      }\n    ',
  },
  "no-create-ref-in-function-component": {
    code: "import { createRef, useMemo } from 'react';\nconst useDriveItemActions = (item) => {\n  const nameInputRef = useMemo(() => createRef(), []);\n  return { nameInputRef };\n};\nexport default useDriveItemActions;",
  },
  "no-create-store-in-render": {
    code: '\n      import { create } from "zustand";\n\n      function App() {\n        const useStore = create((set) => ({ count: 0 }));\n        return null;\n      }\n    ',
  },
  "no-danger": {
    code: '<div dangerouslySetInnerHTML={{ __html: "x" }} />;',
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
  "no-effect-chain": {
    code: "function Game({ card }) {\n        const [goldCardCount, setGoldCardCount] = useState(0);\n        const [round, setRound] = useState(1);\n        useEffect(() => { if (card.gold) setGoldCardCount(goldCardCount + 1); }, [card]);\n        useEffect(() => { if (goldCardCount > 3) setRound(round + 1); }, [goldCardCount]);\n        return null;\n      }",
  },
  "no-effect-event-handler": {
    code: "\nimport { useEffect } from \"react\";\nconst Checkout = ({ status }) => {\n  useEffect(() => {\n    if (status !== 'submitted') {\n      return;\n    }\n    toast('Order submitted!');\n  }, [status]);\n  return null;\n};\n",
  },
  "no-effect-event-in-deps": {
    code: '\n      import { useEffect, useEffectEvent } from "react";\n      const MyComponent = ({ value }) => {\n        const onTick = useEffectEvent(() => value);\n        useEffect(() => { onTick(); }, [onTick]);\n        return null;\n      };\n    ',
  },
  "no-effect-with-fresh-deps": {
    code: '\n      import { useEffect } from "react";\n\n      function Component({ a, b }) {\n        useEffect(() => {\n          // ...\n        }, [{ a, b }]);\n      }\n    ',
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
  "no-find-dom-node": {
    code: 'import { findDOMNode } from "react-dom"; export const f = (node) => findDOMNode(node);',
  },
  "no-flush-sync": {
    code: 'import { flushSync } from "react-dom";\nfunction C() {\n  const onClick = () => {\n    flushSync(() => {\n      setCount((count) => count + 1);\n    });\n  };\n  return <button onClick={onClick}>go</button>;\n}',
  },
  "no-full-lodash-import": {
    code: '\n      import _ from "lodash";\n      export const chunked = _.chunk([1, 2, 3], 2);\n    ',
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
    code: 'const El = () => <span className="bg-clip-text bg-gradient-to-r from-pink-500 to-violet-500">Hi</span>;',
  },
  "no-gray-on-colored-background": {
    code: 'const C = () => <div className="bg-blue-600 text-gray-400">Hi</div>;',
  },
  "no-hydration-branch-on-browser-global": {
    code: '"use client";\nexport const Page = () => typeof window === "undefined" ? <Server /> : <Client />;',
    filePath: "app/page.tsx",
  },
  "no-img-lazy-with-high-fetchpriority": {
    code: 'const Hero = () => <img src="/a.png" loading="lazy" fetchPriority="high" />;',
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
  "no-interactive-element-to-noninteractive-role": {
    code: '<a href="http://x.y.z" role="img" />',
    forceJsx: true,
  },
  "no-is-mounted": {
    code: "class Hello extends React.Component { method() { if (!this.isMounted()) return; } render() { return <div />; } }",
  },
  "no-json-parse-stringify-clone": {
    code: "const copy = JSON.parse(JSON.stringify(state));",
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
  "no-long-transition-duration": {
    code: 'const S = () => <div style={{ transition: "width 2s ease" }} />;',
  },
  "no-match-media-in-state-initializer": {
    code: 'import { useState } from "react";\nuseState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);',
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
  "no-multi-comp": {
    code: "const Foo = () => <div />; const Bar = () => <div />; const Baz = () => <div />;",
  },
  "no-mutable-in-deps": {
    code: "\n      function Page() {\n        useEffect(() => {\n          track(location.href);\n        }, [location.href]);\n        return null;\n      }\n    ",
  },
  "no-mutating-reducer-state": {
    code: '\n      import { useReducer } from "react";\n\n      function reducer(state, action) {\n        state.age = state.age + 1;\n        return state;\n      }\n\n      useReducer(reducer, { age: 0 });\n    ',
  },
  "no-namespace": {
    code: "<ns:testcomponent />",
    forceJsx: true,
  },
  "no-nested-component-definition": {
    code: "\n      const Parent = () => {\n        const NestedChild = () => <span>nested</span>;\n        return <NestedChild />;\n      };\n    ",
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
  "no-outline-none": {
    code: 'const T = () => <button style={{ outline: "none" }}>Save</button>;',
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
  "no-react19-deprecated-apis": {
    code: 'import * as React from "react";\nconst Button = React.createFactory("button");\nvoid Button;',
  },
  "no-redundant-roles": {
    code: 'const Nav = () => <nav role="navigation" />;',
  },
  "no-redundant-should-component-update": {
    code: "\n\t\t\t        class Foo extends React.PureComponent {\n\t\t\t          shouldComponentUpdate() {\n\t\t\t            return true;\n\t\t\t          }\n\t\t\t        }\n\t\t\t      ",
    forceJsx: true,
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
    code: "const El = () => <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} />;",
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
  "no-set-state-in-render": {
    code: 'import { useState } from "react";\nexport function C() {\n  const [count, setCount] = useState(0);\n  setCount(1);\n  return null;\n}',
  },
  "no-side-tab-border": {
    code: 'const C = () => <div className="border-l-4 border-[#ff0000]" />;',
  },
  "no-stale-timer-ref": {
    code: 'import { useRef } from "react";\nexport const useDelayedCallback = (callback) => {\n  const timerRef = useRef(null);\n  const schedule = () => {\n    if (timerRef.current) return;\n    timerRef.current = setTimeout(callback, 100);\n  };\n  const cancel = () => {\n    clearTimeout(timerRef.current);\n  };\n  return { schedule, cancel };\n};',
  },
  "no-static-element-interactions": {
    code: "export const A = ({ onClick }) => <div role={'wat'} onClick={onClick} />;",
  },
  "no-string-false-on-boolean-attribute": {
    code: 'const a = <input disabled="false" />;',
  },
  "no-string-refs": {
    code: "\n              var Hello = createReactClass({\n                componentDidMount: function() {\n                  var component = this.refs.hello;\n                },\n                render: function() {\n                  return <div>Hello {this.props.name}</div>;\n                }\n              });\n            ",
    forceJsx: true,
  },
  "no-sync-xhr": {
    code: 'const xhr = new XMLHttpRequest();\nxhr.open("GET", url, false);\nxhr.send(null);',
    filePath: "/repo/src/lib/fetch-sync.ts",
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
  "no-uncontrolled-input": {
    code: 'export default function Field({ text }) { return <input type="text" value={text} />; }',
    filePath: "app/field.tsx",
  },
  "no-unguarded-browser-global-in-render-or-hook-init": {
    code: '"use client";\nexport const Page = () => <main>{window.innerWidth}</main>;',
    filePath: "app/page.tsx",
  },
  "no-undeferred-third-party": {
    code: 'const W = () => <script src="https://cdn.example.com/w.js" />;',
  },
  "no-unescaped-entities": {
    code: "\n        var Hello = createReactClass({\n            render: function() {\n              return <div>'</div>;\n            }\n        });\n        ",
    forceJsx: true,
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
  "no-unstable-nested-components": {
    code: "\n                    function ParentComponent() {\n                      function UnstableNestedFunctionComponent() {\n                        return <div />;\n                      }\n            \n                      return (\n                        <div>\n                          <UnstableNestedFunctionComponent />\n                        </div>\n                      );\n                    }\n                  ",
    forceJsx: true,
  },
  "no-usememo-simple-expression": {
    code: "function C({ x }) { const v = useMemo(() => x + 1, [x]); return <p>{v}</p>; }",
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
  "prefer-stable-empty-fallback": {
    code: '\n      import { memo } from "react";\n\n      const PostList = memo(({ posts }) => null);\n\n      function App(props) {\n        return <PostList posts={props.posts || []} />;\n      }\n    ',
  },
  "prefer-tag-over-role": {
    code: 'const Nav = () => <div role="navigation" />;',
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
  "query-mutation-missing-invalidation": {
    code: 'const posts = useQuery({ queryKey: ["posts"], queryFn: fetchPosts });\n      useMutation({ mutationFn: deletePost });',
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
  "void-dom-elements-no-children": {
    code: "const a = <img>hi</img>;",
  },
  "webhook-signature-risk": {
    code: "export async function POST(request: Request) {\n  const event = await request.json();\n  await applyEvent(event);\n  return Response.json({ ok: true });\n}\n",
    filePath: "src/app/api/webhooks/github/route.ts",
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
};
