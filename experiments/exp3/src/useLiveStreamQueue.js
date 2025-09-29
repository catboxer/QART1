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

  // Spaced bit popping to eliminate temporal correlation
  const popSubjectBit = useCallback(() => {
    // Skip to every 3rd bit for subject
    while (qRef.current.length > 0) {
      const bit = qRef.current.shift();
      // Keep every 3rd bit, discard the others
      if (qRef.current.length % 3 === 0) {
        return bit;
      }
    }
    return null;
  }, []);

  const popGhostBit = useCallback(() => {
    // Skip to every 5th bit for ghost
    while (qRef.current.length > 0) {
      const bit = qRef.current.shift();
      // Keep every 5th bit, discard the others
      if (qRef.current.length % 5 === 0) {
        return bit;
      }
    }
    return null;
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

      // Debug early chunks to see patterns
      if (qRef.current.length < 1000) { // Only log first 1000 bits worth of chunks
        const ones = (s.match(/1/g) || []).length;
        const zeros = s.length - ones;
        const entropy = s.length > 0 ? -((ones/s.length) * Math.log2(ones/s.length || 1) + (zeros/s.length) * Math.log2(zeros/s.length || 1)) : 0;

        console.log('🔍 EARLY CHUNK:', {
          chunkSize: s.length,
          chunk: s,
          ones: ones,
          zeros: zeros,
          onesRatio: (ones / s.length * 100).toFixed(1) + '%',
          entropy: entropy.toFixed(4),
          queueSizeBefore: qRef.current.length,
          source: data.source
        });
      }

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

  return { connect, disconnect, popBit, popSubjectBit, popGhostBit, bufferedBits, connected, lastSource };
}
