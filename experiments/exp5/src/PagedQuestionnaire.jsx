import React, { useEffect, useRef, useState } from 'react';
import { QuestionsForm } from './Forms.jsx';

// Fisher-Yates shuffle with the browser's cryptographic random source.
function shuffled(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shows a questionnaire one page at a time: pages.first, then pages.randomized in
 * a random order, then pages.last. Each page has its own "all required" check, and
 * its answers are handed to onPageSaved before moving on, so nothing is lost if the
 * participant leaves part way. onComplete runs after the last page is saved.
 *
 * pages = { first: {id, questions}, randomized: [{id, questions}], last: {id, questions} }
 */
export default function PagedQuestionnaire({ title, pages, onPageSaved, onComplete }) {
  const order = useRef(null);
  if (!order.current) {
    order.current = [pages.first, ...shuffled(pages.randomized), pages.last];
  }
  const list = order.current;
  const pageIds = list.map((p) => p.id);

  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState({});

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [index]);

  const page = list[index];
  const isLast = index === list.length - 1;
  const numberOffset = list
    .slice(0, index)
    .reduce((n, p) => n + p.questions.filter((q) => q.type !== 'instruction').length, 0);

  return (
    <QuestionsForm
      key={page.id}
      title={`${title} (page ${index + 1} of ${list.length})`}
      questions={page.questions}
      requiredAll
      numberOffset={numberOffset}
      onSubmit={async (answers, { valid }) => {
        if (!valid) return;
        const merged = { ...answered, ...answers };
        setAnswered(merged);
        try {
          await onPageSaved?.({
            pageId: page.id,
            pageIndex: index,
            answers: merged,
            order: pageIds,
            isLast,
          });
        } catch (e) {
          console.error('Saving questionnaire page failed (continuing):', e);
        }
        if (isLast) onComplete?.(merged, pageIds);
        else setIndex(index + 1);
      }}
    />
  );
}
