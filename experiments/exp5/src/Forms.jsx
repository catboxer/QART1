// src/Forms.jsx
import React, { useEffect, useMemo, useState } from 'react';

export function QuestionsForm({
  title,
  questions = [],
  initial = {},
  onSubmit,
  requiredAll = false, // ← new prop to force all required
}) {
  const [answers, setAnswers] = useState(() => ({ ...initial }));
  const [touchedSubmit, setTouchedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState({}); // track per-question interaction (sliders, etc.)

  // Prefill sensible defaults (esp. slider) without clobbering provided initial values
  useEffect(() => {
    setAnswers((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const q of questions) {
        const hasValue =
          next[q.id] !== undefined && next[q.id] !== null && next[q.id] !== '';
        if (!hasValue) {
          if (q.type === 'slider') {
            const min = typeof q.min === 'number' ? q.min : 0;
            const max = typeof q.max === 'number' ? q.max : 10;
            const def =
              typeof q.initial === 'number'
                ? q.initial
                : Math.round((min + max) / 2);
            next[q.id] = def;
            changed = true;
          }
          if (q.type === 'checkbox') {
            next[q.id] = [];
            changed = true;
          }
          // number/text/select default to '' is fine for controlled inputs
        }
      }
      return changed ? next : prev;
    });
  }, [questions]);

  // setter that also marks touched
  const setAnswer = (id, val) => {
    setAnswers((a) => ({ ...a, [id]: val }));
    setTouched((t) => ({ ...t, [id]: true }));
  };

  // per-question validity (only check visible questions)
  const validity = useMemo(() => {
    const map = {};
    const visibleQuestions = questions.filter((q) => {
      if (!q.showIf) return true; // always show if no condition
      const parentAnswer = answers[q.showIf.id]; // user's answer to the parent question
      return q.showIf.values.includes(parentAnswer);
    });

    for (const q of visibleQuestions) {
      const v = answers[q.id];

      // If requiredAll is true → everything is required.
      const isRequired =
        requiredAll ||
        !(
          q.required === false ||
          /optional/i.test(q.question || '')
        );

      let ok = true;

      if (isRequired) {
        if (v == null || v === '') ok = false;
        if (q.type === 'checkbox' && (!Array.isArray(v) || v.length === 0)) ok = false;
      }

      if (ok && q.type === 'number') {
        if (v === '' || v == null || Number.isNaN(Number(v))) ok = false;
        if (ok && typeof q.min === 'number' && Number(v) < q.min) ok = false;
        if (ok && typeof q.max === 'number' && Number(v) > q.max) ok = false;
      }

      if (q.type === 'slider') {
        // must be moved at least once (considered answered only after interaction)
        const moved = !!touched[q.id];
        ok = ok && moved && !(v == null || v === '' || Number.isNaN(Number(v)));
      }

      map[q.id] = ok;
    }
    return map;
  }, [answers, questions, touched, requiredAll]);

  const allOk = useMemo(
    () => questions.length > 0 && Object.values(validity).every(Boolean),
    [validity, questions.length]
  );

  // Sequential numbers for displayed questions (skips non-answer types like 'instruction')
  const questionNumbers = useMemo(() => {
    const map = {};
    let n = 0;
    for (const q of questions) {
      if (q.type !== 'instruction') {
        map[q.id] = ++n;
      }
    }
    return map;
  }, [questions]);

  async function handleSubmit(e) {
    e.preventDefault();
    setTouchedSubmit(true); // trigger red highlights for any missing answers

    const valid = allOk;
    if (!valid || submitting) {
      // Don’t call onSubmit; let the red highlights guide the user.
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit?.(answers, { valid: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="App" style={{ textAlign: 'left' }}>
      {title && <h2>{title}</h2>}

      {questions
        .filter((q) => {
          if (!q.showIf) return true; // always show if no condition

          const parentAnswer = answers[q.showIf.id]; // user's answer to the parent question
          return q.showIf.values.includes(parentAnswer);
        })
        .map((q) => {
        // Instruction items: section header, no input or numbering
        if (q.type === 'instruction') {
          return (
            <div key={q.id} style={{ margin: '1.5rem 0 0.25rem', padding: '0 8px' }}>
              <p style={{ margin: 0, fontStyle: 'italic', color: '#aaa', fontSize: 13, lineHeight: 1.5 }}>
                {q.question}
              </p>
            </div>
          );
        }

        const value = answers[q.id] ?? '';
        const bad = touchedSubmit && !validity[q.id];

        return (
          <div
            key={q.id}
            className={`question-block${bad ? ' missing' : ''}`}
            style={{
              marginBottom: '2rem',
              border: bad ? '1px solid #d33' : '1px solid transparent',
              borderRadius: 8,
              padding: '8px',
              transition: 'border-color 120ms',
            }}
          >
            <label htmlFor={q.id} className="question-label">
              <span className="question-number">{questionNumbers[q.id]}.</span>{' '}
              {q.question}
            </label>

            <div className="answer-wrapper">
              {q.type === 'number' && (
                <input
                  id={q.id}
                  type="number"
                  className="number-input"
                  min={q.min ?? undefined}
                  max={q.max ?? undefined}
                  value={value}
                  aria-invalid={bad ? 'true' : undefined}
                  onChange={(e) =>
                    setAnswer(
                      q.id,
                      e.target.value === '' ? '' : Number(e.target.value)
                    )
                  }
                />
              )}

              {q.type === 'select' && (
                <select
                  id={q.id}
                  className="select-input"
                  value={value}
                  aria-invalid={bad ? 'true' : undefined}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {(q.options || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              {q.type === 'slider' && (
                <div>
                  <input
                    id={q.id}
                    type="range"
                    min={q.min ?? 0}
                    max={q.max ?? 10}
                    step={1}
                    value={
                      typeof value === 'number' ? value : Number(value) || 0
                    }
                    onChange={(e) => setAnswer(q.id, Number(e.target.value))}
                    style={{ width: '100%' }}
                    aria-invalid={bad ? 'true' : undefined}
                  />
                  <div className="slider-labels">
                    <span>{q.leftLabel ?? q.min ?? 0}</span>
                    <span>
                      <b>{answers[q.id] ?? ''}</b>
                    </span>
                    <span>{q.rightLabel ?? q.max ?? 10}</span>
                  </div>
                </div>
              )}

              {q.type === 'radio' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {(q.options || []).map((opt) => {
                    const optValue = typeof opt === 'object' ? opt.value : opt;
                    const optLabel = typeof opt === 'object' ? opt.label : opt;
                    const checked = value === optValue;
                    return (
                      <label
                        key={optValue}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          cursor: 'pointer', fontSize: 15,
                          background: checked ? 'rgba(99,102,241,0.12)' : 'transparent',
                          borderRadius: 6, padding: '6px 10px',
                          border: checked ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                          transition: 'all 120ms',
                        }}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          value={optValue}
                          checked={checked}
                          onChange={() => setAnswer(q.id, optValue)}
                          style={{ accentColor: '#6366f1', width: 16, height: 16 }}
                        />
                        {optLabel}
                      </label>
                    );
                  })}
                </div>
              )}

              {q.type === 'likert' && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                    {(q.scale || [0, 1, 2, 3, 4, 5]).map((n, idx, arr) => {
                      const checked = value === n;
                      const leftAnchor = q.leftAnchor || 'Never';
                      const rightAnchor = q.rightAnchor || 'Always';
                      return (
                        <label
                          key={n}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            gap: 3, cursor: 'pointer', flex: '1 1 0', minWidth: 36, padding: '6px 4px',
                            borderRadius: 6,
                            background: checked ? 'rgba(99,102,241,0.12)' : 'transparent',
                            border: checked ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                            transition: 'all 120ms',
                          }}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={n}
                            checked={checked}
                            onChange={() => setAnswer(q.id, n)}
                            style={{ accentColor: '#6366f1', width: 15, height: 15 }}
                          />
                          <span style={{ fontSize: 14, fontWeight: checked ? 700 : 400 }}>{n}</span>
                          {idx === 0 && <span style={{ fontSize: 10, color: '#888', textAlign: 'center', lineHeight: 1.2 }}>{leftAnchor}</span>}
                          {idx === arr.length - 1 && <span style={{ fontSize: 10, color: '#888', textAlign: 'center', lineHeight: 1.2 }}>{rightAnchor}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {q.type === 'checkbox' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {(q.options || []).map((opt) => {
                    const optValue = typeof opt === 'object' ? opt.value : opt;
                    const optLabel = typeof opt === 'object' ? opt.label : opt;
                    const selected = Array.isArray(value) && value.includes(optValue);
                    const freqDict = q.withFrequency && q.frequencyId ? (answers[q.frequencyId] || {}) : {};
                    const freqTier = freqDict[optValue] ?? null;
                    const toggle = () => {
                      const current = Array.isArray(value) ? value : [];
                      let next;
                      if (selected) {
                        next = current.filter((v) => v !== optValue);
                      } else if (optValue === 'none') {
                        next = ['none'];
                      } else {
                        next = [...current.filter((v) => v !== 'none'), optValue];
                      }
                      setAnswer(q.id, next);
                      if (q.withFrequency && q.frequencyId) {
                        if (optValue === 'none') {
                          setAnswer(q.frequencyId, {});
                        } else if (selected) {
                          const { [optValue]: _dropped, ...rest } = freqDict;
                          setAnswer(q.frequencyId, rest);
                        }
                      }
                    };
                    const showFreq = selected && q.withFrequency && optValue !== 'none';
                    return (
                      <div key={optValue}>
                        <label
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            cursor: 'pointer', fontSize: 15,
                            background: selected ? 'rgba(99,102,241,0.12)' : 'transparent',
                            borderRadius: 6, padding: '6px 10px',
                            border: selected ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                            transition: 'all 120ms',
                          }}
                        >
                          <input
                            type="checkbox"
                            value={optValue}
                            checked={selected}
                            onChange={toggle}
                            style={{ accentColor: '#6366f1', width: 16, height: 16 }}
                          />
                          {optLabel}
                        </label>
                        {showFreq && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 4, marginLeft: 26, flexWrap: 'wrap' }}>
                            {[[1, 'Once or twice'], [2, 'Occasionally'], [3, 'Regularly'], [4, 'Frequently']].map(([tier, label]) => {
                              const active = freqTier === tier;
                              return (
                                <button
                                  key={tier}
                                  type="button"
                                  onClick={() => setAnswer(q.frequencyId, { ...freqDict, [optValue]: tier })}
                                  style={{
                                    padding: '3px 10px', fontSize: 12, borderRadius: 12,
                                    border: active ? '1px solid rgba(99,102,241,0.6)' : '1px solid #d1d5db',
                                    background: active ? 'rgba(99,102,241,0.15)' : '#f9fafb',
                                    color: active ? '#4338ca' : '#6b7280',
                                    cursor: 'pointer', fontWeight: active ? 600 : 400,
                                    transition: 'all 120ms',
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {q.type === 'textarea' && (
                <textarea
                  id={q.id}
                  className="textarea-input"
                  value={value}
                  aria-invalid={bad ? 'true' : undefined}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                />
              )}

              {q.type === 'text' && (
                <input
                  id={q.id}
                  type="text"
                  className="text-input"
                  value={value}
                  aria-invalid={bad ? 'true' : undefined}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                />
              )}

              {bad && (
                <div
                  className="field-hint"
                  style={{ color: '#d33', marginTop: 6, fontSize: 12 }}
                >
                  This question is required.
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="submit"
        className={`primary-btn ${allOk ? '' : 'looks-disabled'}`}
        disabled={submitting} /* allow click to show red; only disable while submitting */
        aria-disabled={submitting ? 'true' : 'false'}
      >
        {submitting ? 'Submitting…' : 'Continue'}
      </button>
      {!allOk && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#888', textAlign: 'center' }}>
          All questions are required before continuing.
        </div>
      )}
    </form>
  );
}
