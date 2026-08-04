import ts from "typescript";
import { getStaticPropertyName } from "./get-static-property-name.js";

export const getClassMethodDeclaration = (
  classNode: ts.ClassDeclaration,
  methodName: string,
): ts.MethodDeclaration | null =>
  classNode.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      getStaticPropertyName(member.name) === methodName &&
      !member.modifiers?.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.StaticKeyword ||
          modifier.kind === ts.SyntaxKind.AsyncKeyword ||
          modifier.kind === ts.SyntaxKind.AbstractKeyword,
      ) &&
      !member.asteriskToken &&
      !member.questionToken &&
      Boolean(member.body),
  ) ?? null;
