// rule: no-prop-types
// weakness: alias-guard
// source: adversarial review of component receiver provenance

import styled from "styled-components";

const styledAlias = styled;
const styledMutator = styledAlias;
const tagName = "div";
styledMutator[tagName] = (parts: TemplateStringsArray) => ({ parts });
const Schema = styledAlias.div`color: red;`;

Schema.propTypes = { value: () => true };
