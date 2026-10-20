// rule: no-derived-useState
// verdict: pass
// weakness: name-heuristic
// source: synthetic
const notes = {
  Function: "description",
  React: "description",
  Reflect: "description",
  eval: "description",
  window: "description",
};
import { useState } from "react";
interface Entity {
  slug: string;
  label: string;
}
const EditForm = ({ entity }: { entity: Entity }) => {
  const [draft, setDraft] = useState(entity.label);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};
export const Screen = ({ entity }: { entity: Entity }) => (
  <EditForm key={entity.slug} entity={entity} />
);
