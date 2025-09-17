import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useLiveStreamQueue
 * - Opens SSE to /live?dur=...
 * - Buffers incoming "bits" events (strings like "0101...")
 * - Exposes popBit() so your minute engine can drip at 5 Hz
 */
export function useLiveStreamQueue(
  { durationMs = 90_000 } = {}
) {
  const [connected, setConnected] = useState(false);
  const [lastSource, setLastSource] = useState(null);
  const qRef = useRef([]);       // queue of '0'/'1' chars
  const esRef = useRef(null);

  const bufferedBits = useCallback(() => qRef.current.length, []);

  const popBit = useCallback(() => {
    if (qRef.current.length === 0) return null;
    return qRef.current.shift();
  }, []);

  const disconnect = useCallback(() => {
    try { esRef.current?.close?.(); } catch { }
    esRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    disconnect();
    const es = new EventSource(`/live?dur=${durationMs}`);
    esRef.current = es;
    setConnected(true);

    es.addEventListener("bits", (evt) => {
      const data = JSON.parse(evt.data);  // { ts, source, bits }
      if (data?.source) setLastSource(data.source);
      const s = data?.bits || "";
      // Push each char to the queue
      for (let i = 0; i < s.length; i++) qRef.current.push(s[i]);
    });

    es.addEventListener("done", () => {
      disconnect();
    });

    es.onerror = () => {
      disconnect();
    };
  }, [durationMs, disconnect]);

  useEffect(() => () => disconnect(), [disconnect]);

  return { connect, disconnect, popBit, bufferedBits, connected, lastSource };
}
