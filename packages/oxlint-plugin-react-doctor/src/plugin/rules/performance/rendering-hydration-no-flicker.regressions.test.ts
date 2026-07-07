import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingHydrationNoFlicker } from "./rendering-hydration-no-flicker.js";

const expectFail = (code: string): void => {
  const result = runRule(renderingHydrationNoFlicker, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(renderingHydrationNoFlicker, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("performance/rendering-hydration-no-flicker — regressions", () => {
  it("does not flag a mount effect that measures a ref's DOM node", () => {
    expectPass(`
      const Resizer = () => {
        const resizerToggleRef = useRef(null);
        const [headerCellWidth, setHeaderCellWidth] = useState(0);
        useEffect(() => {
          setHeaderCellWidth(getHeaderWidth(resizerToggleRef.current));
        }, []);
        return <button ref={resizerToggleRef} aria-label={String(headerCellWidth)} />;
      };
    `);
  });

  it("does not flag a setter whose state only feeds id/aria attributes", () => {
    expectPass(`
      const Pagination = ({ totalPages }) => {
        const [descriptionId, setDescriptionId] = useState(undefined);
        useEffect(() => {
          setDescriptionId(\`Pagination-totalPage-\${uidGenerator()}\`);
        }, []);
        return (
          <div>
            <input aria-describedby={descriptionId} />
            <span id={descriptionId}>{\` of \${totalPages} pages\`}</span>
          </div>
        );
      };
    `);
  });

  it("still flags the classic setIsClient(true) mount flag", () => {
    expectFail(`
      const useClient = () => {
        const [isClient, setIsClient] = useState(false);
        useEffect(() => {
          setIsClient(true);
        }, []);
        return isClient;
      };
    `);
  });

  it("still flags a setter feeding visible content", () => {
    expectFail(`
      const NoteForm = () => {
        const [placeholder, setPlaceholder] = useState("");
        useEffect(() => {
          setPlaceholder(getRandomPlaceholder());
        }, []);
        return <textarea placeholder={placeholder} />;
      };
    `);
  });

  it("still flags a localStorage-backed setter", () => {
    expectFail(`
      const Toolbar = () => {
        const [hasUnseenWhatsNew, setHasUnseenWhatsNew] = useState(false);
        useEffect(() => {
          setHasUnseenWhatsNew(localStorage.getItem("whats-new") !== VERSION);
        }, []);
        return <button data-badge={hasUnseenWhatsNew} />;
      };
    `);
  });
});
