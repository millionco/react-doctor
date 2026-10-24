// rule: no-create-object-url-without-revoke
// weakness: cross-file
// source: synthetic native preview parameter forwarding
import { renderPreview } from "./preview";
export const Preview = ({ file, dimmed }) => (
  <figure>{renderPreview(URL.createObjectURL(file), dimmed)}</figure>
);
