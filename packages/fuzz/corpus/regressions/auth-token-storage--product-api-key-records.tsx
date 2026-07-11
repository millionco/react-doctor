// rule: auth-token-in-web-storage
// weakness: domain-semantics
// source: ISSUES_TO_FIX_ASAP.md (product API-key records are not auth credentials)
interface ApiKeyRecord {
  id: string;
  status: string;
}

export const persistCreatedApiKeys = (records: ApiKeyRecord[]) => {
  sessionStorage.setItem("mailing.createdApiKeys", JSON.stringify(records));
};
