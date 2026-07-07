import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: non-interactive element with `onClick` and no keyboard
// handler. Variants probe handler spellings, element-name shapes, and
// role-based interactivity.
export const clickEventsHaveKeyEventsCases: FnMiningCase[] = [
  {
    ruleId: "click-events-have-key-events",
    description: "canonical: <div onClick={() => selectRow(id)}>",
    filePath: "src/table.tsx",
    code: `
      const Cell = ({ id }: { id: string }) => (
        <div onClick={() => selectRow(id)}>Open</div>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "click-events-have-key-events",
    description: "capture-phase handler only: <div onClickCapture={...}>",
    filePath: "src/table.tsx",
    code: `
      const Cell = ({ id }: { id: string }) => (
        <div onClickCapture={() => selectRow(id)}>Open</div>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "click-events-have-key-events",
    description: "styled-components member element: <styled.div onClick>",
    filePath: "src/table.tsx",
    code: `
      const Cell = ({ id }: { id: string }) => (
        <styled.div onClick={() => selectRow(id)}>Open</styled.div>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "click-events-have-key-events",
    description: 'div with role="button" but no tabIndex and no key handler',
    filePath: "src/table.tsx",
    code: `
      const Cell = ({ id }: { id: string }) => (
        <div role="button" onClick={() => selectRow(id)}>Open</div>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "click-events-have-key-events",
    description: "<tr onClick> table row (focusless container)",
    filePath: "src/table.tsx",
    code: `
      const BodyRow = ({ id }: { id: string }) => (
        <tr onClick={() => selectRow(id)}><td>Open</td></tr>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "click-events-have-key-events",
    description: "handler stored in a render-local variable then referenced",
    filePath: "src/table.tsx",
    code: `
      const Cell = ({ id }: { id: string }) => {
        const open = () => setVisible(id);
        return <div onClick={open}>Open</div>;
      };
    `,
    shouldFire: true,
  },
];
