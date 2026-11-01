export const buildNumericSelectionFixture = (
  count: number,
  hasOpaqueFeed: boolean,
): string => `import { useState } from "react";
export const SelectionPanel = () => {
 const [records,setRecords]=useState([{label:"one",active:false}]);
 ${Array.from({ length: count }, (_unusedSelection, selectionIndex) => `const [chosen${selectionIndex},setChosen${selectionIndex}]=useState([]);`).join("\n")}
 const add=(position)=>{${Array.from({ length: count }, (_unusedSelection, selectionIndex) => `setChosen${selectionIndex}([...chosen${selectionIndex},position]);`).join("")}};
 ${Array.from({ length: count }, (_unusedSelection, selectionIndex) => `const remove${selectionIndex}=(position)=>{const copy${selectionIndex}=[...records];copy${selectionIndex}[position].active=true;setChosen${selectionIndex}(chosen${selectionIndex}.filter(value=>value!==position));setRecords(copy${selectionIndex});};${hasOpaqueFeed ? `const poison${selectionIndex}=()=>setChosen${selectionIndex}(["opaque"]);` : ""}`).join("\n")}
 return <section>{records.map((record,position)=><button onClick={()=>add(position)}>{record.label}</button>)}${Array.from({ length: count }, (_unusedSelection, selectionIndex) => `{chosen${selectionIndex}.map(position=><button onClick={()=>remove${selectionIndex}(position)}>Remove</button>)}`).join("")}</section>;
};`;
