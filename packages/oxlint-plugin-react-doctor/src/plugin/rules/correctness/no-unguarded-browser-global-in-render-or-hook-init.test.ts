import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

describe("no-unguarded-browser-global-in-render-or-hook-init", () => {
  it("flags navigator.onLine as a useState argument in a custom hook", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export const useOnlineChange = () => {
        const [online, setOnline] = useState(navigator.onLine);
        return online;
      };`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags document read inside a useState lazy initializer", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useIsDocumentHidden = () => {
        const [hidden, setHidden] = useState(() => document.hidden);
        return hidden;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare window read in a component body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const width = window.innerWidth;
        return <div style={{ width }} />;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags localStorage read in a useState initializer", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useToken = () => {
        const [token] = useState(() => localStorage.getItem('token'));
        return token;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a react-router location local (not window.location)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const usePath = () => {
        const location = useLocation();
        const pathname = location.pathname;
        return pathname;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a read inside a useEffect callback", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useOnline = () => {
        const [online, setOnline] = useState(false);
        useEffect(() => {
          setOnline(navigator.onLine);
        }, []);
        return online;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a read inside an event handler", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const handleClick = () => {
          const width = window.innerWidth;
          return width;
        };
        return <button onClick={handleClick} />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind a dominating typeof window guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const width = typeof window !== 'undefined' ? window.innerWidth : 0;
        return <div style={{ width }} />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the nested-deref guarded SSR-safe idiom", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const host = typeof window === 'undefined' ? '' : window.location.hostname;
        return <div>{host}</div>;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind a canUseDOM guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const width = canUseDOM ? window.innerWidth : 0;
        return <div style={{ width }} />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when navigator is a local shadow binding", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useThing = () => {
        const navigator = getFakeAgent();
        const [online] = useState(navigator.onLine);
        return online;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a read inside a useMemo callback", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useWidth = () => {
        const width = useMemo(() => window.innerWidth, []);
        return width;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet outside a component or hook body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const readWidth = () => {
        return window.innerWidth;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
