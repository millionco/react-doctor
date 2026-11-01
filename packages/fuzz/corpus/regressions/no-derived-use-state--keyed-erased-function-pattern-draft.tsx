// rule: no-derived-useState
// verdict: pass
// weakness: name-heuristic
// source: synthetic
type Notes = ({ draft }: { draft: string }) => void;
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
