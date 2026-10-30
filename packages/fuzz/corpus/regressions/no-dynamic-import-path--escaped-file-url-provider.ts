// rule: no-dynamic-import-path
// weakness: escaped-file-url-provider
// verdict: fail
import { pathToFileURL } from "url";
const convert = pathToFileURL;
export const load = (filename: string) => import(convert(filename).href);
