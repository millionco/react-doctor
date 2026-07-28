import { formatTitle } from "./format-title.js";

interface HeaderProperties {
  title: string;
}

export const Header = ({ title }: HeaderProperties) => <h1>{formatTitle(title)}</h1>;
