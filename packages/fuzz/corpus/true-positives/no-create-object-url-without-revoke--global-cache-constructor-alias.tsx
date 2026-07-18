// rule: no-create-object-url-without-revoke
// weakness: alias-resolution
// source: PR #1344 Bugbot review
const MapConstructor = globalThis.Map;
const previewCache = new MapConstructor<string, string>();

export const cachePreview = (blob: Blob, id: string) => {
  previewCache.set(id, URL.createObjectURL(blob));
};
