interface DraftRecord {
  id: string;
}

export const persistDraftRecords = (records: DraftRecord[]) => {
  sessionStorage.setItem("draft.records", JSON.stringify(records));
};
