// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (skill registry: awaited helpers resolve `{skill}|{error}` result objects and never reject)
import { useState } from "react";
import { importSkill, updateSkill } from "./skill-registry";

export const SkillDraftEditor = ({
  editingId,
  payload,
}: {
  editingId: string | null;
  payload: object;
}) => {
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [skill, setSkill] = useState<object | null>(null);
  const handleDraftSave = async () => {
    setDraftSaving(true);
    const result = editingId ? await updateSkill(editingId, payload) : await importSkill(payload);
    setDraftSaving(false);
    if ("error" in result) {
      setDraftError(result.error.message);
      return;
    }
    setSkill(result.skill);
  };
  return (
    <div>
      <button type="button" disabled={draftSaving} onClick={handleDraftSave}>
        Save draft
      </button>
      {draftError ? <p role="alert">{draftError}</p> : null}
      {skill ? <p>Saved</p> : null}
    </div>
  );
};
