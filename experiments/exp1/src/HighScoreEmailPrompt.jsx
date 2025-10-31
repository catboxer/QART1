import React, { useEffect, useState } from "react";

export default function HighScoreEmailPrompt({
  emailTo = "h@whatthequark.com",
  experiment = "exp2",
  scorePct,            // number in 0..1
  sessionId,
  participantId,
  onClose = () => { },
}) {
  const [hasConsented, setHasConsented] = useState(false);
  // Esc-to-close (must be before any early return so hooks run every render)
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasScore = Number.isFinite(scorePct);
  if (!hasScore) return null;

  const scoreStr = `${(scorePct * 100).toFixed(1)}%`;
  const subject = encodeURIComponent(`High scorer – ${experiment}`);
  const body = encodeURIComponent(
    [
      `Hi WTQ team,`,
      ``,
      `I got a high score and would love to be considered for future studies (and the PSI hoodie!).`,
      ``,
      `Experiment: ${experiment}`,
      `Score: ${scoreStr}`,
      `Participant ID: ${participantId || "(not provided)"}`,
      `Session ID: ${sessionId || "(not provided)"}`,
      ``,
      `Thanks!`,
    ].join("\n")
  );
  const mailto = `mailto:${emailTo}?subject=${subject}&body=${body}`;

  const details = `Experiment: ${experiment}
Score: ${scoreStr}
Participant ID: ${participantId || "(not provided)"}
Session ID: ${sessionId || "(not provided)"}
`;

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details);
      alert("Details copied.");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = details;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("Details copied.");
    }
  }

  return (
    <div
      style={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="High score"
      onClick={onClose}                   // click backdrop closes
    >
      <div
        style={styles.card}
        onClick={(e) => e.stopPropagation()} // prevent backdrop close
      >
        <button style={styles.close} onClick={onClose} aria-label="Close">×</button>

        <h2 style={{ marginTop: 0 }}>🎉 You're a high scorer!</h2>
        <p>
          You've clearly got the touch. Join our shortlist for future studies and
          we'll thank you with an organic PSI "Founding Ψ Cohort" hoodie.
        </p>

        <div style={styles.consentSection}>
          <label style={styles.consentLabel}>
            <input
              type="checkbox"
              checked={hasConsented}
              onChange={(e) => setHasConsented(e.target.checked)}
              style={styles.consentCheckbox}
            />
            <span>
              I consent to providing my email to be contacted for future studies only.
              This will not be used for marketing, will not be shared with third parties,
              and I can request deletion at any time by contacting {emailTo}.
            </span>
          </label>
        </div>

       <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            disabled={!hasConsented}
            onClick={() => {
              if (!hasConsented) return;
              const win = window.open(mailto, "_blank", "noopener,noreferrer");
              if (!win) {
                const a = document.createElement("a");
                a.href = mailto;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.click();
              }
            }}
            style={hasConsented ? {} : styles.disabledButton}
          >
            Email us (prefilled)
          </button>

          <button
            disabled={!hasConsented}
            onClick={() => hasConsented && copyDetails()}
            style={hasConsented ? {} : styles.disabledButton}
          >
            Copy details
          </button>

          <button className="secondary-btn" type="button" onClick={onClose}>
            Not now
          </button>
        </div>

        <p style={{ marginTop: 12, fontSize: 12, opacity: 0.75, textAlign: "center" }}>
          Includes your score, Participant ID, and Session ID so we can find you quickly.
        </p>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
  },
  card: {
    background: "#fff",
    padding: 24,
    borderRadius: 12,
    width: 520,
    maxWidth: "92%",
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
    position: "relative",
    textAlign: "center",
  },
  close: {
    position: "absolute",
    right: 12,
    top: -4,
    border: "none",
    background: "transparent",
    fontSize: 28,
    cursor: "pointer",
    lineHeight: 1,
    color: "#666",
    zIndex: 10,
    padding: "4px 8px",
  },
  consentSection: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    textAlign: "left",
  },
  consentLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 14,
    lineHeight: 1.4,
    cursor: "pointer",
  },
  consentCheckbox: {
    marginTop: 2,
    flexShrink: 0,
  },
  disabledButton: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
};
