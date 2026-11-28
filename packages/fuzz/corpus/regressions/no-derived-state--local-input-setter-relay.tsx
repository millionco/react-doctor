// Rule: no-derived-state
// Weakness: a local text field forwards edits through a setter prop.
// Source: Synthetic regression based on the approved input-writer audit case.
import { useEffect, useState } from "react";

const EditableLabel = ({ label, writeLabel }) => (
  <input type="search" value={label} onChange={(event) => writeLabel(event.target.value)} />
);

export const FolderNameForm = ({ initialLabel }) => {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(initialLabel);
  }, [initialLabel]);

  return (
    <section>
      <EditableLabel label={label} writeLabel={setLabel} />
    </section>
  );
};
