import ts from "typescript";
import { getStaticPropertyName } from "./get-static-property-name.js";

export const getStaticClassMethodDeclaration = (
  classNode: ts.ClassDeclaration,
  methodName: string,
): ts.MethodDeclaration | null =>
  classNode.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      getStaticPropertyName(member.name) === methodName &&
      Boolean(
        member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
      ) &&
      !member.modifiers?.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.AsyncKeyword ||
          modifier.kind === ts.SyntaxKind.AbstractKeyword,
      ) &&
      !member.asteriskToken &&
      !member.questionToken &&
      Boolean(member.body),
  ) ?? null;
