// rule: no-mixed-icon-libraries
// weakness: cross-file
// source: 0.8.1-to-main all-rules parity (once-ui-system/magic-portfolio, statico/jsgrids)
// verdict: pass
import { HiArrowRight } from "react-icons/hi2";
import { PiHouse } from "react-icons/pi";

export const iconLibrary = { arrow: HiArrowRight, home: PiHouse };
