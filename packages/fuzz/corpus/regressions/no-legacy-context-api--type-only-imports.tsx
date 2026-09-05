// rule: no-legacy-context-api
// weakness: alias-guard
// source: synthetic native parity regression
import type React from "react";
import type { Component as ReactComponent } from "react";

export class DefaultProvider extends React.Component {
  static contextTypes = {};
}

export class NamedProvider extends ReactComponent {
  static contextTypes = {};
}
