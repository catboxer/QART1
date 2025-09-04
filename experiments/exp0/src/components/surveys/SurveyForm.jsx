import React, { useMemo, useState } from 'react';
import { isAnswered as _isAnswered } from './surveyUtils'; // or inline from your code
// You can inline your renderInput() from MainApp.jsx here.

export default function SurveyForm({
  title,
  questions,
  initial = {},
  onSubmit,
}) {
  const [resp, setResp] = useState(initial);
  const [showMissing, setShowMissing] = useState(false);

  const isAnswered = (q) => {
    const v = resp[q.id];
    if (q.type === 'number') {
      const n = Number(v);
      if (v === '' || v == null || Number.isNaN(n)) return false;
      if (q.min != null && n < q.min) return false;
      if (q.max != null && n > q.max) return false;
      return true;
    }
    return (
      v === false || v === true || v === 0 || (v !== '' && v != null)
    );
  };

  const allOk = useMemo(
    () => questions.every(isAnswered),
    [resp, questions]
  );

  function handleSubmit() {
    if (!allOk) {
      setShowMissing(true);
      return;
    }
    onSubmit?.(resp);
  }

  const renderInput = (q) => {
    const invalid = showMissing && !isAnswered(q);
    const common = { id: q.id, 'aria-invalid': invalid || undefined };
    switch (q.type) {
      case 'number':
        return (
          <input
            {...common}
            type="number"
            min={q.min}
            max={q.max}
            onChange={(e) =>
              setResp((r) => ({ ...r, [q.id]: e.target.value }))
            }
          />
        );
      case 'slider':
        return (
          <input
            {...common}
            type="range"
            min={q.min}
            max={q.max}
            onChange={(e) =>
              setResp((r) => ({ ...r, [q.id]: e.target.value }))
            }
          />
        );
      case 'select':
        return (
          <select
            {...common}
            onChange={(e) =>
              setResp((r) => ({ ...r, [q.id]: e.target.value }))
            }
          >
            <option value="">Select</option>
            {(q.options || []).map((opt, i) => (
              <option key={i} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case 'checkbox':
        return (
          <input
            {...common}
            type="checkbox"
            onChange={(e) =>
              setResp((r) => ({ ...r, [q.id]: e.target.checked }))
            }
          />
        );
      case 'textarea':
        return (
          <textarea
            {...common}
            onChange={(e) =>
              setResp((r) => ({ ...r, [q.id]: e.target.value }))
            }
          />
        );
      default:
        return (
          <input
            {...common}
            type="text"
            onChange={(e) =>
              setResp((r) => ({ ...r, [q.id]: e.target.value }))
            }
          />
        );
    }
  };

  return (
    <div className="block-panel">
      <h2>{title}</h2>
      {questions.map((q) => (
        <div key={q.id} style={{ margin: '8px 0' }}>
          <label
            htmlFor={q.id}
            style={{ display: 'block', marginBottom: 4 }}
          >
            {q.question || q.label}
          </label>
          {renderInput(q)}
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <button className="primary" onClick={handleSubmit}>
          Continue
        </button>
      </div>
    </div>
  );
}
