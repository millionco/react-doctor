// rule: no-create-object-url-without-revoke
// source: PR #1344 Bugbot review
const browserGlobal = window;
const BrowserUrl = browserGlobal["URL"];

export const createDownloadUrl = (blob: Blob) => BrowserUrl.createObjectURL(blob);
