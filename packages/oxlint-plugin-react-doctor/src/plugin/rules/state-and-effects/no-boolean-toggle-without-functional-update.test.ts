import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";

describe("no-boolean-toggle-without-functional-update", () => {
  it("flags setIsOpen(!isOpen) inside a setTimeout", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [isOpen, setIsOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setIsOpen(!isOpen), 100);
        }, []);
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a toggle inside a subscription callback", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [collapsed, setCollapsed] = useState(false);
        useEffect(() => {
          const sub = source.subscribe(() => setCollapsed(!collapsed));
          return () => sub.unsubscribe();
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a toggle inside a promise .then handler", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [allowChatSupport, setAllowChatSupport] = useState(false);
        const onLoad = () => {
          load().then(() => setAllowChatSupport(!allowChatSupport));
        };
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a synchronous onClick toggle", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const CollapsingSection = () => {
        const [isOpen, setIsOpen] = useState(false);
        return <button onClick={() => setIsOpen(!isOpen)} />;
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag negating a different variable", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = ({ open }) => {
        const [sideMenuOpen, setSideMenuOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setSideMenuOpen(!open), 100);
        }, [open]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a MemberExpression argument", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = ({ field }) => {
        const [value, setValue] = useState(false);
        useEffect(() => {
          setTimeout(() => setValue(!field.value), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the correct functional updater form", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [isOpen, setIsOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setIsOpen((prev) => !prev), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the setter has no matching useState pair", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = ({ open }) => {
        const setOpen = useStore((s) => s.setOpen);
        useEffect(() => {
          setTimeout(() => setOpen(!open), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a numeric negation (arithmetic rule's domain)", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setTimeout(() => setCount(-count), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useReducer dispatch toggle", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [open, setOpen] = useReducer((s) => !s, false);
        useEffect(() => {
          setTimeout(() => setOpen(!open), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
