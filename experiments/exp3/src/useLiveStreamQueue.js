import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useLiveStreamQueue
 * - Opens SSE to /live?dur=...
 * - Buffers incoming "bits" events (strings like "0101...")
 * - Exposes popByte() so your minute engine can consume 8 bits at a time
 */
export function useLiveStreamQueue(
  { durationMs = 90_000 } = {}
) {
  const [connected, setConnected] = useState(false);
  const [lastSource, setLastSource] = useState(null);
  const qRef = useRef([]);       // queue of '0'/'1' chars
  const esRef = useRef(null);
  const positionRef = useRef(0);  // track position in original stream

  // Return buffered BYTES (not bits)
  const bufferedBytes = useCallback(() => Math.floor(qRef.current.length / 8), []);

  // Store ghost byte for alternating tests
  const ghostByteRef = useRef(null);
  const ghostByteIndexRef = useRef(null);

  // Convert 8 bits to a byte value (0-255)
  const bitsToByteValue = (bits) => {
    let value = 0;
    for (let i = 0; i < 8; i++) {
      if (bits[i] === '1') {
        value |= (1 << (7 - i)); // MSB first
      }
    }
    return value;
  };

  // Trial-based BYTE strategy: odd trials use alternating bytes, even trials use independent bytes
  const popSubjectByte = useCallback((trialNumber) => {
    if (trialNumber % 2 === 1) {
      // Odd trials (1,3,5...): Use alternating bytes from same stream (need 16 bits for 2 bytes)
      if (qRef.current.length >= 16) {
        const subjectIndex = positionRef.current;

        // Take 8 bits for subject byte
        const subjectBits = qRef.current.splice(0, 8);
        const subjectByte = bitsToByteValue(subjectBits);

        // Take next 8 bits for ghost byte (store for later)
        const ghostBits = qRef.current.splice(0, 8);
        ghostByteRef.current = bitsToByteValue(ghostBits);
        ghostByteIndexRef.current = positionRef.current + 8; // Ghost gets next 8 indices

        positionRef.current += 16;

        return { byte: subjectByte, rawIndex: subjectIndex };
      }
    } else {
      // Even trials (2,4,6...): Use fresh QRNG call (independent) - need 8 bits
      if (qRef.current.length >= 8) {
        const subjectIndex = positionRef.current;
        const subjectBits = qRef.current.splice(0, 8);
        const subjectByte = bitsToByteValue(subjectBits);
        positionRef.current += 8;

        return { byte: subjectByte, rawIndex: subjectIndex };
      }
    }

    // Log when we can't provide bytes
    console.warn('⚠️ Insufficient bits in queue for byte:', {
      trialNumber,
      isOdd: trialNumber % 2 === 1,
      requiredBits: trialNumber % 2 === 1 ? 16 : 8,
      availableBits: qRef.current.length,
      availableBytes: Math.floor(qRef.current.length / 8)
    });

    return null;
  }, []);

  const popGhostByte = useCallback((trialNumber) => {
    if (trialNumber % 2 === 1) {
      // Odd trials (1,3,5...): Use the stored alternating byte
      const ghostByte = ghostByteRef.current;
      const ghostIndex = ghostByteIndexRef.current;
      ghostByteRef.current = null; // Clear after use
      ghostByteIndexRef.current = null;
      return ghostByte !== null ? { byte: ghostByte, rawIndex: ghostIndex } : null;
    } else {
      // Even trials (2,4,6...): Use fresh QRNG call (independent from subject) - need 8 bits
      if (qRef.current.length >= 8) {
        const ghostIndex = positionRef.current;
        const ghostBits = qRef.current.splice(0, 8);
        const ghostByte = bitsToByteValue(ghostBits);
        positionRef.current += 8;
        return { byte: ghostByte, rawIndex: ghostIndex };
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

  return {
    connect,
    disconnect,
    popSubjectByte,  // Changed from popSubjectBit
    popGhostByte,    // Changed from popGhostBit
    bufferedBytes,   // Changed from bufferedBits - returns number of complete bytes available
    connected,
    lastSource
  };
}
