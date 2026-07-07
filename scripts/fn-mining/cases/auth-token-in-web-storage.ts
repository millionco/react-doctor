import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `localStorage.setItem("authToken", token)`. Variants
// probe key shapes (template literal, const indirection) and storage
// receiver shapes (aliased binding).
export const authTokenInWebStorageCases: FnMiningCase[] = [
  {
    ruleId: "auth-token-in-web-storage",
    description: 'canonical: localStorage.setItem("authToken", token)',
    filePath: "src/auth.ts",
    code: `export const persistToken = (token: string) => { localStorage.setItem("authToken", token); };`,
    shouldFire: true,
  },
  {
    ruleId: "auth-token-in-web-storage",
    description: 'window.sessionStorage.setItem("refresh_token", token)',
    filePath: "src/auth.ts",
    code: `export const persistToken = (token: string) => { window.sessionStorage.setItem("refresh_token", token); };`,
    shouldFire: true,
  },
  {
    ruleId: "auth-token-in-web-storage",
    description: "template-literal key: localStorage.setItem(`accessToken`, token)",
    filePath: "src/auth.ts",
    code: `export const persistToken = (token: string) => { localStorage.setItem(\`accessToken\`, token); };`,
    shouldFire: true,
  },
  {
    ruleId: "auth-token-in-web-storage",
    description: "key behind a const: localStorage.setItem(TOKEN_STORAGE_KEY, token)",
    filePath: "src/auth.ts",
    code: `
      const TOKEN_STORAGE_KEY = "auth_token";
      export const persistToken = (token: string) => {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "auth-token-in-web-storage",
    description: "storage aliased to a local binding: const storage = window.localStorage",
    filePath: "src/auth.ts",
    code: `
      export const persistToken = (token: string) => {
        const storage = window.localStorage;
        storage.setItem("jwt", token);
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "auth-token-in-web-storage",
    description: 'computed-literal property assignment: localStorage["apiKey"] = value',
    filePath: "src/auth.ts",
    code: `export const persistKey = (value: string) => { localStorage["apiKey"] = value; };`,
    shouldFire: true,
  },
];
