// rule: no-derived-state-effect
// weakness: default-parameter
// source: PR #2311 independent review
// verdict: pass
import { useEffect, useState } from "react";

interface Props {
  source: string;
}

const assign = (setter, value, _registration = subscribe((next) => setter(next))) => setter(value);
const assignWithOptions = (
  setter,
  value,
  { registration: _registration = subscribe((next) => setter(next)) } = {},
) => setter(value);

export const DefaultParameter = ({ source }: Props) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    assign(setValue, source);
  }, [source]);
  return <div>{value}</div>;
};

export const DestructuringDefault = ({ source }: Props) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    assignWithOptions(setValue, source);
  }, [source]);
  return <div>{value}</div>;
};
