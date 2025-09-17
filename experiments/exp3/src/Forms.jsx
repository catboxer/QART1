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

  // per-question validity
  const validity = useMemo(() => {
    const map = {};
    for (const q of questions) {
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

      {questions.map((q, idx) => {
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
              <span className="question-number">{idx + 1}.</span>{' '}
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
    </form>
  );
}
