// rule: auth-token-in-web-storage
// weakness: wrapper-transparency
// source: react-bench fix-react-rdh-sofn-xyz-mailing-settings

interface ApiKeyRecord {
  id: string;
  active: boolean;
  createdAt: string;
}

const LOCAL_API_KEYS_STORAGE_KEY = "mailing.settings.localApiKeys";

const writeStorage = (key: string, value: string) => {
  const storage = getSessionStorage();
  if (storage) storage.setItem(key, value);
};

const getSessionStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
};

export const persistCreatedApiKeys = (records: ApiKeyRecord[]) => {
  writeStorage(LOCAL_API_KEYS_STORAGE_KEY, JSON.stringify(records));
};
