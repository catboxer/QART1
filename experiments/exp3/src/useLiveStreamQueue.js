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
  const positionRef = useRef(0);  // track position in original stream

  const bufferedBits = useCallback(() => qRef.current.length, []);

  // Store ghost bit for alternating tests
  const ghostBitRef = useRef(null);

  // Store ghost bit and index for alternating tests
  const ghostBitIndexRef = useRef(null);

  // Trial-based bit strategy: odd trials use alternating bits, even trials use independent bits
  const popSubjectBit = useCallback((trialNumber) => {
    if (trialNumber % 2 === 1) {
      // Odd trials (1,3,5...): Use alternating bits from same stream
      if (qRef.current.length >= 2) {
        const subjectIndex = positionRef.current;
        const subjectBit = qRef.current.shift(); // Take first bit for subject
        ghostBitRef.current = qRef.current.shift(); // Store second bit for ghost
        ghostBitIndexRef.current = positionRef.current + 1; // Ghost gets next index
        positionRef.current += 2;

        // Validate that we got valid bits
        if (subjectBit !== '0' && subjectBit !== '1') {
          console.error('❌ Invalid subject bit from stream:', subjectBit);
          return null;
        }
        if (ghostBitRef.current !== '0' && ghostBitRef.current !== '1') {
          console.error('❌ Invalid ghost bit from stream:', ghostBitRef.current);
          ghostBitRef.current = null; // Clear invalid bit
          ghostBitIndexRef.current = null;
          return null;
        }

        return { bit: subjectBit, rawIndex: subjectIndex };
      }
    } else {
      // Even trials (2,4,6...): Use fresh QRNG call (independent)
      if (qRef.current.length >= 1) {
        const subjectIndex = positionRef.current;
        const subjectBit = qRef.current.shift();
        positionRef.current++;

        // Validate that we got a valid bit
        if (subjectBit !== '0' && subjectBit !== '1') {
          console.error('❌ Invalid subject bit from stream:', subjectBit);
          return null;
        }

        return { bit: subjectBit, rawIndex: subjectIndex };
      }
    }

    // Log when we can't provide bits
    console.warn('⚠️ Insufficient bits in queue:', {
      trialNumber,
      isOdd: trialNumber % 2 === 1,
      requiredBits: trialNumber % 2 === 1 ? 2 : 1,
      availableBits: qRef.current.length
    });

    return null;
  }, []);

  const popGhostBit = useCallback((trialNumber) => {
    if (trialNumber % 2 === 1) {
      // Odd trials (1,3,5...): Use the stored alternating bit
      const ghostBit = ghostBitRef.current;
      const ghostIndex = ghostBitIndexRef.current;
      ghostBitRef.current = null; // Clear after use
      ghostBitIndexRef.current = null;
      return ghostBit ? { bit: ghostBit, rawIndex: ghostIndex } : null;
    } else {
      // Even trials (2,4,6...): Use fresh QRNG call (independent from subject)
      if (qRef.current.length >= 1) {
        const ghostIndex = positionRef.current;
        const ghostBit = qRef.current.shift();
        positionRef.current++;
        return { bit: ghostBit, rawIndex: ghostIndex };
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

  return { connect, disconnect, popSubjectBit, popGhostBit, bufferedBits, connected, lastSource };
}
