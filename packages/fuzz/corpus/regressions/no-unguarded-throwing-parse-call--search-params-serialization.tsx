// rule: no-unguarded-throwing-parse-call
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (API client: the template's runtime part is createSearchParams(...).toString() output, always well-formed)
import { createSearchParams } from "react-router-dom";

export class ApiClient {
  backends: Record<string, string> = { primary: "https://api.example.com" };
  currentBackend = "primary";
  version = "v2";

  getFullUrl(path: string, params: Record<string, string>) {
    const host = this.backends[this.currentBackend];
    const version = this.version;
    const search = createSearchParams(params).toString();
    return new URL(`${host}/${version}/${path}?${search}`);
  }
}
