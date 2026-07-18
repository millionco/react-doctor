// rule: auth-token-in-web-storage
// weakness: name-heuristic
// source: react-bench fix-react-rdh-sofn-xyz-mailing-settings

interface MailingApiKeyRecord {
  id: string;
  active: boolean;
  createdAt: string;
}

const STORAGE_KEY = "mailing.createdApiKeys";

export const persistCreatedApiKeys = (records: MailingApiKeyRecord[]) => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
};
