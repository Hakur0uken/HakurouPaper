import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

type FormulaLabProps = {
  onReturn: () => void;
};

type FormulaKind = "inline" | "block";

const exampleFormula = "\\int_0^1 x^2\\,dx = \\frac{1}{3}";

export function FormulaLab({ onReturn }: FormulaLabProps) {
  const [formulaKind, setFormulaKind] = useState<FormulaKind>("block");
  const [source, setSource] = useState(exampleFormula);
  const [draft, setDraft] = useState(exampleFormula);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => katex.renderToString(source || "\\text{空公式}", {
    displayMode: formulaKind === "block",
    throwOnError: false,
    strict: "ignore",
  }), [formulaKind, source]);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const beginEditing = () => {
    setDraft(source);
    setIsEditing(true);
  };

  const confirmEditing = () => {
    setSource(draft);
    setIsEditing(false);
  };

  const cancelEditing = () => {
    setDraft(source);
    setIsEditing(false);
  };

  return (
    <div className="formula-lab">
      <header className="formula-lab-header">
        <div>
          <p className="formula-lab-kicker">EXPERIMENT</p>
          <h1>公式实验台</h1>
          <p>验证渲染与编辑交互；尚未写入当前文稿。</p>
        </div>
        <button type="button" className="formula-lab-return" onClick={onReturn}>返回写作</button>
      </header>

      <div className="formula-kind-switch" role="group" aria-label="公式类型">
        <button type="button" className={formulaKind === "inline" ? "is-active" : ""} onClick={() => setFormulaKind("inline")}>行内公式 <span>$…$</span></button>
        <button type="button" className={formulaKind === "block" ? "is-active" : ""} onClick={() => setFormulaKind("block")}>块级公式 <span>$$…$$</span></button>
      </div>

      <section className="formula-preview-section" aria-label="公式预览">
        <p className="formula-section-label">预览 · 双击公式修改源码</p>
        {isEditing ? (
          <div className="formula-source-editor">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  confirmEditing();
                }
                if (event.key === "Escape") cancelEditing();
              }}
              aria-label="LaTeX 源码"
              spellCheck={false}
            />
            <div className="formula-source-actions">
              <span>Ctrl Enter 确认 · Esc 取消</span>
              <div>
                <button type="button" onClick={cancelEditing}>取消</button>
                <button type="button" className="formula-confirm" onClick={confirmEditing}>应用</button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`formula-preview formula-preview-${formulaKind}`}
            onDoubleClick={beginEditing}
            aria-label="双击编辑公式"
            title="双击编辑 LaTeX 源码"
          >
            <span dangerouslySetInnerHTML={{ __html: preview }} />
          </button>
        )}
      </section>

      <section className="formula-lab-notes">
        <p>目标交互：公式平时是排版结果；双击后仅在当前位置展示 LaTeX 源码，确认后回到渲染结果。</p>
        <p>将来写入 Markdown 时，行内格式为 <code>$E=mc^2$</code>，块级格式为独占行的 <code>$$ … $$</code>。</p>
      </section>
    </div>
  );
}
