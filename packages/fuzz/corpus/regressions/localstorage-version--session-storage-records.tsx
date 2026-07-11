// rule: client-localstorage-no-version
// weakness: storage-lifetime
// source: ISSUES_TO_FIX_ASAP.md (defensively decoded session-scoped records)
interface DraftRecord {
  id: string;
}

export const persistDraftRecords = (records: DraftRecord[]) => {
  sessionStorage.setItem("draft.records", JSON.stringify(records));
};
