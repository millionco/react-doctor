import { DOMEditor as CurrentEditor } from "slate-dom";
export interface FocusApi extends CurrentEditor {
  readonly label?: string;
}
export const FocusApi: FocusApi = CurrentEditor;
