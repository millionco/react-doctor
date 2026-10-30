// rule: no-dynamic-import-path
// weakness: node-file-url-provider
// verdict: pass
import { pathToFileURL } from "node:url";
export const load = (filename: string) => import(pathToFileURL(filename).href);
