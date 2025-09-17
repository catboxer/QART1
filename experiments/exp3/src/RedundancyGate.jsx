import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * RedundancyGate — single-device redundancy tiers before a RETRO block.
 * Props:
 *  - tier: "R0" | "R1" | "R2"
 *  - commitPayload: { H_tape, H_commit, lenBits, createdISO }
 *  - prefixLen?: number (default 8)
 *  - onDone: (info) => void  // info shape matches your spec
 */
export default function RedundancyGate({
  tier = "R0",
  commitPayload,
  prefixLen = 8,
  onDone,
}) {
  const [prefix, setPrefix] = useState("");
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const modalitiesRef = useRef({
    disk: false, indexeddb: false, screen: false, tts: false, typed_echo: false
  });

  const jsonStr = useMemo(() => JSON.stringify(commitPayload ?? {}, null, 2), [commitPayload]);
  useEffect(() => {
    const hex = (commitPayload?.H_commit || commitPayload?.H_tape || "").toString();
    setPrefix(hex.slice(0, prefixLen));
  }, [commitPayload, prefixLen]);

  const saveToIndexedDB = async (key, value) =>
    new Promise((resolve) => {
      if (!("indexedDB" in window)) return resolve(false);
      const open = indexedDB.open("exp3_local_store", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        try {
          const db = open.result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch { resolve(false); }
      };
    });

  const downloadFile = (filename, text) => {
    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch { return false; }
  };

  const speakPrefix = (pfx) => {
    try {
      const u = new SpeechSynthesisUtterance(pfx.split("").join(" "));
      window.speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  };

  useEffect(() => {
    if (tier === "R0") {
      const info = {
        tier,
        local_copies_count: 0,
        modalities: { disk: false, indexeddb: false, screen: false, tts: false, typed_echo: false },
        typed_echo_ok: null,
        h_commit_prefix: "",
      };
      const t = setTimeout(() => onDone?.(info), 200);
      return () => clearTimeout(t);
    }
  }, [tier, onDone]);

  const handleProceed = async () => {
    if (!commitPayload) return;
    setSaving(true);
    let copies = 0;

    const diskOk = downloadFile("commit.json", jsonStr);
    if (diskOk) { modalitiesRef.current.disk = true; copies += 1; }

    const idbOk = await saveToIndexedDB(`commit_${Date.now()}`, jsonStr);
    if (idbOk) { modalitiesRef.current.indexeddb = true; copies += 1; }
    try { localStorage.setItem(`commit_prefix_${Date.now()}`, prefix); } catch { }

    modalitiesRef.current.screen = true; copies += 1;

    let typedOK = null;
    if (tier === "R2") {
      const ttsOk = speakPrefix(prefix);
      if (ttsOk) { modalitiesRef.current.tts = true; copies += 1; }
      modalitiesRef.current.typed_echo = true;
      typedOK = (typed.trim().toLowerCase() === prefix.toLowerCase());
    }

    const info = {
      tier,
      local_copies_count: Math.max(copies, tier === "R2" && modalitiesRef.current.typed_echo ? copies + 1 : copies),
      modalities: { ...modalitiesRef.current },
      typed_echo_ok: tier === "R2" ? !!typedOK : null,
      h_commit_prefix: prefix
    };

    setSaving(false);
    onDone?.(info);
  };

  if (tier === "R0") return null;

  return (
    <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {tier === "R1" ? "Device-persisted commitment" : "Participant-encoded commitment"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
        Saving the commitment locally creates redundancy within your environment.
      </div>
      <div style={{
        maxHeight: 160, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12, background: "#f8f8f8", padding: 8, borderRadius: 6, marginBottom: 8
      }}>
        <pre style={{ margin: 0 }}>{jsonStr}</pre>
      </div>
      <div style={{ marginBottom: 8 }}>
        Shown prefix: <code>{prefix || "—"}</code>
      </div>
      {tier === "R2" && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12 }}>Type the prefix to continue: </label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={prefix ? `e.g., ${prefix}` : "prefix"}
            style={{ fontFamily: "ui-monospace, monospace" }}
          />
        </div>
      )}
      <button
        disabled={saving || (tier === "R2" && typed.trim().length < prefix.length)}
        onClick={handleProceed}
      >
        {saving ? "Working…" : "Continue"}
      </button>
    </div>
  );
}
