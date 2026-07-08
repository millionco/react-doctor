// rule: react-hooks/exhaustive-deps
// weakness: wrapper-transparency
// source: oxc-project/oxc#19749 (member expressions inside IIFEs reported as missing deps)
import { useMemo } from "react";

export const ArrowIife = ({ obj, flag }: { obj: { a: string; b: string }; flag: boolean }) =>
  useMemo(() => {
    return (() => {
      return flag ? obj.a : obj.b;
    })();
  }, [obj.a, obj.b, flag]);

export const FunctionIife = ({ obj }: { obj: { a: string } }) =>
  useMemo(() => {
    return (function () {
      return obj.a;
    })();
  }, [obj.a]);
