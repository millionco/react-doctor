// rule: jsx-props-no-spreading
// verdict: pass
// weakness: library-idiom
// source: independent synthetic CSF2 source pragma review
const label = "@jsx customElement";
void label;
import React from "react";
import { ActionCard } from "./action-card";
const metadata = { component: ActionCard };
export default metadata;
const RenderExample = (inputs) => <ActionCard {...inputs} />;
export const Basic = RenderExample.bind({});
Basic.args = { label: "Preview" };
