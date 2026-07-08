import Comp from "./comp";

export interface CompProps {
  label: string;
}

export const mapping: { [key: string]: (props: CompProps) => unknown } = {
  DEFAULT: Comp,
};
