import { useEffect, useRef, useState } from "react";

const DEFAULT_MS = 90_000; // ~90 seconds of streaming (safety margin)

export default function LiveBits() {
  const [connected, setConnected] = useState(false);
  const [count, setCount] = useState(0);
  const [snippet, setSnippet] = useState("");
  const [lastSource, setLastSource] = useState(null);

  const esRef = useRef(null);

  useEffect(() => {
    // Start the SSE connection when this component mounts
    const es = new EventSource(`/live?dur=${DEFAULT_MS}`);
    esRef.current = es;
    setConnected(true);

    // Chunk of bits arrives (~once per second from the server)
    es.addEventListener("bits", (evt) => {
      const data = JSON.parse(evt.data); // { ts, source, bits }
      setCount((c) => c + (data.bits?.length || 0));
      setSnippet((data.bits || "").slice(0, 128));
      if (data.source) setLastSource(data.source);
    });

    // Heartbeat just keeps the pipe open; no UI changes needed
    es.addEventListener("heartbeat", () => { });

    // Server signals the stream is finished (around 90s)
    es.addEventListener("done", () => {
      es.close();
      setConnected(false);
    });

    // Any error: close and show idle
    es.onerror = () => {
      es.close();
      setConnected(false);
      // optional: console.warn("SSE error");
    };

    // Cleanup when the component unmounts
    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  return (
    <div>
      <div>status: {connected ? "connected" : "idle"}</div>
      <div>received bits: {count}</div>
      <div>last source: {lastSource || "—"}</div>
      <div style={{ fontFamily: "monospace" }}>
        {snippet}
        {snippet && "…"}
      </div>
    </div>
  );
}
