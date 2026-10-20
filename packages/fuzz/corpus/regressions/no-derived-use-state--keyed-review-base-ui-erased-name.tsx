// rule: no-derived-useState
// verdict: pass
// weakness: name-heuristic
// source: synthetic
import { Input } from "@base-ui/react/input";
import { useState } from "react";
interface Entity {
  slug: string;
  label: string;
}
const EditForm = ({ entity }: { entity: Entity }) => {
  const [draft, setDraft] = useState(entity.label);
  return <Input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};
export const Screen = ({ entity }: { entity: Entity }) => (
  <EditForm key={entity.slug} entity={entity} />
);
interface Input {
  note: string;
}
