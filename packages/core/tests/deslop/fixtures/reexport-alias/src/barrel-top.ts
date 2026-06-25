// Top barrel: re-exports with aliases from middle barrel
export {
  aliasB as aliasC,
  renamedOnce as doubleAlias,
  unusedAliasB as unusedAliasC,
} from "./barrel-mid";
