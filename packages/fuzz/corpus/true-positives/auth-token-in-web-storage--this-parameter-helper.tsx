// rule: auth-token-in-web-storage
// weakness: wrapper-transparency
// source: Cursor Bugbot on PR #1334

function persistCredential(this: void, key: string, value: string) {
  sessionStorage.setItem(key, value);
}

export const saveAccessToken = (token: string) => {
  persistCredential("accessToken", token);
};
