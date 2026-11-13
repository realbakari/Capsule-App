import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentQuestion, AgentQuestionAnswers, ApprovalRequest } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { harnessDisplayName } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import "./questions.css";

interface Draft { picked: string[]; other: string }

export function answersFromDrafts(questions: readonly AgentQuestion[], drafts: Record<string, Draft>): AgentQuestionAnswers {
  return Object.fromEntries(questions.map((question) => {
    const draft = drafts[question.id] ?? { picked: [], other: "" };
    const other = draft.other.trim();
    const values = question.multiSelect ? [...draft.picked, ...(other ? [other] : [])] : other ? [other] : draft.picked.slice(0, 1);
    return [question.id, values];
  }));
}

function isAnswered(question: AgentQuestion, draft: Draft | undefined): boolean {
  return Boolean(draft && (draft.picked.length > 0 || draft.other.trim()));
}

/**
 * An agent's question, answered with its own choices. One question at a time
 * with progress when there are several; number keys pick, Enter moves on.
 * Typing a free answer replaces a single choice. "Don't answer" lets the
 * agent carry on with its own judgement.
 */
export function QuestionCard({ approval, compact = false }: { approval: ApprovalRequest; compact?: boolean }) {
  const { api, setNotice, harnesses } = useWorkspace();
  const questions = useMemo(() => approval.details?.questions ?? [], [approval.details?.questions]);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const card = useRef<HTMLFormElement>(null);
  const readOnly = api.isDesktop === false && api.remoteMode !== "control";
  const question = questions[index];

  useEffect(() => { setIndex(0); setDrafts({}); setError(undefined); }, [approval.id]);
  useEffect(() => {
    if (!compact) card.current?.querySelector<HTMLElement>("[data-option], input")?.focus({ preventScroll: true });
  }, [approval.id, index, compact]);
  if (!question) return null;

  const draft = drafts[question.id] ?? { picked: [], other: "" };
  const last = index === questions.length - 1;
  /* Functional, so two quick key presses each see the other's choice. */
  const update = (change: (draft: Draft) => Partial<Draft>) => {
    setError(undefined);
    setDrafts((current) => {
      const before = current[question.id] ?? { picked: [], other: "" };
      return { ...current, [question.id]: { ...before, ...change(before) } };
    });
  };
  const toggle = (label: string) => {
    if (question.multiSelect) update((before) => ({ picked: before.picked.includes(label) ? before.picked.filter((item) => item !== label) : [...before.picked, label] }));
    else update(() => ({ picked: [label], other: "" }));
  };

  async function submit() {
    const missing = questions.findIndex((item) => !isAnswered(item, drafts[item.id]));
    if (missing >= 0) { setIndex(missing); setError("Answer this question to continue."); return; }
    setBusy(true);
    try {
      await api.answerAgentQuestion(approval.id, answersFromDrafts(questions, drafts));
    } catch (failure) {
      setError(formatUserError(failure));
    } finally {
      setBusy(false);
    }
  }
  const advance = () => {
    if (!isAnswered(question, draft)) { setError("Choose an answer, or type one."); return; }
    if (last) void submit();
    else { setError(undefined); setIndex(index + 1); }
  };
  const decline = () => void api.resolveApproval(approval.id, "denied").catch((failure: unknown) => setNotice(formatUserError(failure)));

  return (
    <form
      ref={card}
      className={`question-card${compact ? " compact" : ""}`}
      aria-labelledby={`question-${approval.id}`}
      onSubmit={(event) => { event.preventDefault(); advance(); }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
        const pick = Number(event.key) - 1;
        if (Number.isInteger(pick) && question.options[pick]) { event.preventDefault(); toggle(question.options[pick]!.label); }
      }}
    >
      <header className="question-head">
        <span className="question-kicker">{harnessDisplayName(harnesses, approval.agentName, "The agent")} asks</span>
        {questions.length > 1 && <span className="question-progress" aria-label={`Question ${index + 1} of ${questions.length}`}>{index + 1} / {questions.length}</span>}
      </header>
      {question.header && <span className="question-tag">{question.header}</span>}
      <h3 id={`question-${approval.id}`} className="question-text">{question.question}</h3>
      {question.options.length > 0 && (
        <div className="question-options" role={question.multiSelect ? "group" : "radiogroup"} aria-labelledby={`question-${approval.id}`}>
          {question.options.map((option, optionIndex) => {
            const selected = draft.picked.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                data-option
                role={question.multiSelect ? "checkbox" : "radio"}
                aria-checked={selected}
                className={`question-option${selected ? " selected" : ""}`}
                disabled={readOnly || busy}
                onClick={() => toggle(option.label)}
              >
                <kbd aria-hidden>{optionIndex + 1}</kbd>
                <span className="question-option-text">
                  <span className="question-option-label">{option.label}</span>
                  {option.description && <span className="question-option-description">{option.description}</span>}
                </span>
                <span className={`question-mark ${question.multiSelect ? "check" : "radio"}`} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
      {question.allowOther && (
        <input
          className="question-other"
          type={question.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={!question.secret}
          placeholder={question.options.length > 0 ? "Or type your own answer" : question.secret ? "Type the answer; it is not saved in the conversation" : "Type your answer"}
          aria-label={question.options.length > 0 ? "Your own answer" : "Answer"}
          value={draft.other}
          disabled={readOnly || busy}
          onChange={(event) => { const other = event.target.value; update((before) => question.multiSelect ? { other } : { other, picked: other.trim() ? [] : before.picked }); }}
        />
      )}
      {error && <p className="question-error" role="alert">{error}</p>}
      <div className="question-actions">
        <button type="button" className="ghost question-decline" disabled={readOnly || busy} onClick={decline} title="The agent continues with its own judgement">Don't answer</button>
        {index > 0 && <button type="button" className="ghost" disabled={busy} onClick={() => { setError(undefined); setIndex(index - 1); }}>Back</button>}
        <button type="submit" className="send" disabled={readOnly || busy}>{busy ? "Sending…" : last ? "Send answer" : "Next"}</button>
      </div>
      {readOnly && <p className="question-note">Answering needs conversation control. This device can only read.</p>}
    </form>
  );
}
