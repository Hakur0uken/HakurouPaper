import type { RefObject } from "react";
import type { UiText } from "../i18n";
import { applySourceInput, sourceInputValue } from "./sourceInput";

type Props = {
  markdown: string;
  hidden: boolean;
  ready: boolean;
  showLineNumbers: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  text: UiText;
  onChange: (markdown: string) => void;
  onHistory: (redo: boolean) => void;
  onSelectionChange: (text: string | null) => void;
};

export function MarkdownSourceEditor({ markdown, hidden, ready, showLineNumbers, inputRef, text, onChange, onHistory, onSelectionChange }: Props) {
  const value = sourceInputValue(markdown);
  const lines = value.split("\n").length;
  return <div className="markdown-source-editor" hidden={hidden}>
    {showLineNumbers && <pre className="markdown-source-line-numbers" aria-hidden="true">{Array.from({ length: lines }, (_, index) => index + 1).join("\n")}</pre>}
    <textarea
      ref={inputRef}
      className="markdown-source-input"
      aria-label={text.markdownSource}
      value={value}
      readOnly={!ready}
      rows={Math.max(1, lines)}
      wrap="off"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(applySourceInput(markdown, event.currentTarget.value))}
      onSelect={(event) => {
        const input = event.currentTarget;
        onSelectionChange(input.selectionStart === input.selectionEnd ? null : input.value.slice(input.selectionStart, input.selectionEnd));
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") {
          event.preventDefault();
          onHistory(key === "y" || event.shiftKey);
        }
      }}
    />
  </div>;
}
