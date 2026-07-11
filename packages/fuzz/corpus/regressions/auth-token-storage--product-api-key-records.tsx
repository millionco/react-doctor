interface ApiKeyRecord {
  id: string;
  status: string;
}

export const persistCreatedApiKeys = (records: ApiKeyRecord[]) => {
  sessionStorage.setItem("mailing.createdApiKeys", JSON.stringify(records));
};
