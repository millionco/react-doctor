import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface EditablePositionTestCase {
  readonly name: string;
  readonly code: string;
  readonly options: RunRuleOptions;
  readonly expectedCount: number;
}

const cases: ReadonlyArray<EditablePositionTestCase> = [
  {
    name: "closed-three-position-editor",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/00-closed-three-position-editor.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "renamed-closed-bindings",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const CharacterFields = () => {\n  const [fieldTexts, setFieldTexts] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setFieldTexts(["", "", ""]);\n  };\n  const commitFields = () => fieldTexts.join("");\n  const updateText = (enteredText: string, position: number) => {\n    if (enteredText.length > 1) return;\n    if (!/^\\d*$/.test(enteredText)) return;\n    const copiedTexts = [...fieldTexts];\n    copiedTexts[position] = enteredText;\n    setFieldTexts(copiedTexts);\n    if (enteredText) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !fieldTexts[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = fieldTexts.every((value) => value.length === 1);\n  return (\n    <div>\n      {fieldTexts.map((value, idx) => (\n        <Input\n          key={idx}\n          ref={(field) => { fieldRefs.current[idx] = field; }}\n          value={value}\n          onChangeText={(enteredText) => updateText(enteredText, idx)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, idx)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${idx + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/01-renamed-closed-bindings.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "two-position-editor",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/02-two-position-editor.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "unrelated-erased-import-and-reexport",
    code: 'import type { ViewMetadata } from "metadata-types";\nexport type { ViewMetadata } from "metadata-types";\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/03-unrelated-erased-import-and-reexport.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "same-length-reverse-controlled",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues].reverse();\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/04-same-length-reverse-controlled.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "uncontrolled-without-reorder",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          defaultValue={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/05-uncontrolled-without-reorder.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "different-same-length-reset",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "x", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/06-different-same-length-reset.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "external-reset-array",
    code: 'import { resetTexts } from "position-data";\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(resetTexts);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/07-external-reset-array.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "updater-function-reset",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues((previous) => previous.slice());\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/08-updater-function-reset.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "setter-escape",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  registerSetter(setTextValues);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/09-setter-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "state-array-escape",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  registerValues(textValues);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/10-state-array-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "copied-array-escape",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    exposeCopy(nextValues);\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/11-copied-array-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "copy-mutator",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues.sort();\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/12-copy-mutator.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "copy-length-write",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues.length = 2;\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/13-copy-length-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "second-copy-write",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    nextValues[0] = "";\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/14-second-copy-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "neighbor-index-write",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position + 1] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/15-neighbor-index-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "neighbor-value-transport",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = textValues[(position + 1) % textValues.length];\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/16-neighbor-value-transport.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "event-value-alias",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => { const forwardedValue = nextValue; writeField(forwardedValue, index); }}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/17-event-value-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "mapped-index-alias",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => { const forwardedIndex = index; writeField(nextValue, forwardedIndex); }}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/18-mapped-index-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "extra-numeric-edit-caller",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  const clearFirst = () => writeField("", 0);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/19-extra-numeric-edit-caller.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "alternate-map-edit-caller",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  const otherEditors = ["", ""].map((entry, index) => () => writeField(entry, index));\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/20-alternate-map-edit-caller.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "handler-alias",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  const forwardedWriter = writeField;\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/21-handler-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "handler-escape",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  registerWriter(writeField);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/22-handler-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "async-edit-handler",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = async (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/23-async-edit-handler.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "written-position-parameter",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    position += 1;\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/24-written-position-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "third-map-collection-parameter",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index, collection) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={collection[index]}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/25-third-map-collection-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "map-this-argument",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ), { mode: "foreign" })}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/26-map-this-argument.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "aliased-map-function",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  const mapValues = textValues.map;\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/27-aliased-map-function.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "item-dependent-component",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => { const Field = value ? ReadyInput : Input; return (\n        <Field\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ); })}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/28-item-dependent-component.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "conditional-mapped-output",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => value ? (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ) : null)}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/29-conditional-mapped-output.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "identity-bearing-records",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState([{ id: "first" }, { id: "second" }, { id: "third" }]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues([{ id: "first" }, { id: "second" }, { id: "third" }]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/30-identity-bearing-records.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "whole-type-only-hook-import",
    code: 'import { useRef } from "react";\nimport type { useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/31-whole-type-only-hook-import.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "inline-type-only-hook-import",
    code: 'import { useRef, type useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/32-inline-type-only-hook-import.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "custom-state-hook-provider",
    code: 'import { useRef } from "react";\nimport { useState } from "custom-state";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/33-custom-state-hook-provider.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "namespace-state-hook",
    code: 'import { useRef } from "react";\nimport * as React from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = React.useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/34-namespace-state-hook.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "array-prototype-map-write",
    code: 'Array.prototype.map = customMap;\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/35-array-prototype-map-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "computed-array-prototype-map-write",
    code: 'Array["prototype"]["map"] = customMap;\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/36-computed-array-prototype-map-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "define-property-array-provider",
    code: 'Object.defineProperty(Array.prototype, "map", { value: customMap });\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/37-define-property-array-provider.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "destructured-constructor-provider",
    code: 'const { constructor: build } = (() => {});\nbuild("Array.prototype.map = replacementMap")();\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/38-destructured-constructor-provider.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "computed-constructor-provider",
    code: 'const build = (() => {})["constructor"];\nbuild("Array.prototype.map = replacementMap")();\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/39-computed-constructor-provider.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "direct-eval-writer",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  eval("setTextValues([\\"moved\\"])");\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/40-direct-eval-writer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "global-object-eval-writer",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  globalThis["eval"]("setTextValues([\\"moved\\"])");\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/41-global-object-eval-writer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "react-inherited-getter-provider",
    code: 'import * as ReactProvider from "react";\nReactProvider.__defineGetter__("useState", () => customState);\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/42-react-inherited-getter-provider.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "props-array-initializer",
    code: 'interface PositionEditorProps { initialTexts: string[] }\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = ({ initialTexts }: PositionEditorProps) => {\n  const [textValues, setTextValues] = useState(initialTexts);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/43-props-array-initializer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "lazy-array-initializer",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(() => ["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/44-lazy-array-initializer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "hole-in-initializer",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", , ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/45-hole-in-initializer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "empty-initializer",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState([]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/46-empty-initializer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "nonempty-string-initializer",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["first", "second", "third"]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/47-nonempty-string-initializer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "computed-map-access",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues["map"]((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/48-computed-map-access.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "optional-map-call",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map?.((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/49-optional-map-call.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "rest-position-parameter",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, ...position: number[]) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/50-rest-position-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "default-position-parameter",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number = 0) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/51-default-position-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "destructured-position-parameter",
    code: 'interface PositionArgument { position: number }\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, { position }: PositionArgument) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/52-destructured-position-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "callback-arguments-escape",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={function(nextValue) { exposeArguments(arguments); writeField(nextValue, index); }}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/53-callback-arguments-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "item-value-captured-by-edit",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(value, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/54-item-value-captured-by-edit.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "direct-state-member-write",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  const corrupt = () => { textValues[0] = "x"; };\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/55-direct-state-member-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "every-callback-array-escape",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value, position, collection) => inspectCollection(collection));\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/56-every-callback-array-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "state-alias",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  const valuesAlias = textValues;\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/57-state-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "delete-copy-member",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    delete nextValues[position];\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/58-delete-copy-member.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "compound-copy-member-write",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] += nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/59-compound-copy-member-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "setter-extra-argument",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues, recordCommit);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/60-setter-extra-argument.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "written-value-parameter",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValue = transform(nextValue);\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/61-written-value-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "copy-binding-alias",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    const copyAlias = nextValues;\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/62-copy-binding-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "neighbor-index-at-adapter",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index + 1)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/63-neighbor-index-at-adapter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "written-map-index",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => { index += 1; writeField(nextValue, index); }}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/64-written-map-index.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "shadowed-adapter-index",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue, index) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/65-shadowed-adapter-index.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "array-provider-reflect-set",
    code: 'Reflect.set(Array.prototype, "map", customMap);\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/66-array-provider-reflect-set.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "native-module-provider-loader",
    code: 'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nload("react").useState = customState;\nimport { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/67-native-module-provider-loader.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "preact-hook-source",
    code: 'import { useRef, useState } from "preact/hooks";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/68-preact-hook-source.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "pure-preact-capability-contradiction",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/69-pure-preact-capability-contradiction.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["preact"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "dynamic-known-vm-loader-invalidates-native-spread",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nconst virtualMachine = await import("node:vm");\nvirtualMachine.runInThisContext("Array.prototype[Symbol.iterator] = function* () { for (let position = this.length - 1; position >= 0; position -= 1) yield this[position]; }");\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename: "/src/editable-position-controls/70-dynamic-known-vm-provider.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "unknown-dynamic-import-conservative-abstention",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nawait import("position-runtime-adapter");\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename:
        "/src/editable-position-controls/71-unknown-dynamic-import-conservative-abstention.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "runtime-array-alias-constant-prototype-iterator-write",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nconst nativeArrayConstructor = Array;\nconst prototypeProperty = "prototype";\nconst replacementValues = ["first", "second", "third", "fourth"];\nnativeArrayConstructor[prototypeProperty][Symbol.iterator] = replacementValues.values.bind(replacementValues);\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename:
        "/src/editable-position-controls/72-runtime-array-alias-constant-prototype-iterator-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "literal-array-constructor-and-prototype-constant-key-iterator-write",
    code: 'import { useRef, useState } from "react";\nimport { Input } from "position-ui";\n\nconst prototypeReference: unknown[] = [];\nconst constructorProperty = "constructor";\nconst prototypeProperty = "prototype";\nconst nativeConstructor = prototypeReference[constructorProperty];\nconst replacementValues = ["first", "second", "third", "fourth"];\nnativeConstructor[prototypeProperty][Symbol.iterator] = replacementValues.values.bind(replacementValues);\n\nexport const PositionEditor = () => {\n  const [textValues, setTextValues] = useState(["", "", ""]);\n  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);\n  const resetFields = () => {\n    setTextValues(["", "", ""]);\n  };\n  const commitFields = () => textValues.join("");\n  const writeField = (nextValue: string, position: number) => {\n    if (nextValue.length > 1) return;\n    if (!/^\\d*$/.test(nextValue)) return;\n    const nextValues = [...textValues];\n    nextValues[position] = nextValue;\n    setTextValues(nextValues);\n    if (nextValue) focusNext(position);\n  };\n  const handleFieldKey = (key: string, position: number) => {\n    if (key === "Backspace" && !textValues[position]) focusPrevious(position);\n  };\n  const focusNext = (position: number) => {\n    const nextPosition = position + 1;\n    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();\n  };\n  const focusPrevious = (position: number) => {\n    const previousPosition = position - 1;\n    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();\n  };\n  const isComplete = textValues.every((value) => value.length === 1);\n  return (\n    <div>\n      {textValues.map((value, index) => (\n        <Input\n          key={index}\n          ref={(field) => { fieldRefs.current[index] = field; }}\n          value={value}\n          onChangeText={(nextValue) => writeField(nextValue, index)}\n          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}\n          borderColor={value ? "ready" : "blank"}\n          accessibilityLabel={`Position ${index + 1}`}\n        />\n      ))}\n      <button onClick={resetFields}>Reset</button>\n      <button disabled={!isComplete} onClick={commitFields}>Commit</button>\n    </div>\n  );\n};\n',
    options: {
      filename:
        "/src/editable-position-controls/unscheduled-literal-constructor-constant-key-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
];

describe("no-array-index-as-key closed editable string positions", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noArrayIndexAsKey, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
