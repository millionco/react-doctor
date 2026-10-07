// rule: rules-of-hooks
// weakness: import-provenance
// source: parity adversarial review
// verdict: pass
import SinonDefault from "sinon";
import * as SinonNamespace from "sinon";
import { sandbox as SinonNamed } from "sinon";

SinonNamespace.useFakeTimers();
(SinonNamespace as typeof SinonNamespace).useFakeTimers();
SinonDefault.useFakeTimers();
SinonNamed.useFakeTimers();
