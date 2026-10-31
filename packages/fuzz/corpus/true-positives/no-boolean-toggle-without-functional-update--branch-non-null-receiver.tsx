// rule: no-boolean-toggle-without-functional-update
// weakness: mutation-verdict
// source: Synthetic native listener receiver with no-op separator
// verdict: fail
import { useEffect, useState } from "react";
// oxfmt-ignore
export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} ;window!.addEventListener("change",listener); return()=>window!.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };
