// fetchQRNGBits.js
// Utility to fetch quantum bits on-demand from the live edge function

/**
 * Fetch n bits from QRNG using the live SSE endpoint
 * @param {number} nBits - Number of bits to fetch
 * @returns {Promise<string>} - String of '0' and '1' characters
 */
export async function fetchQRNGBits(nBits) {
  console.log(`🎲 Fetching ${nBits} bits from QRNG...`);

  try {
    // Calculate duration: need ~150 bits/sec, so for 3100 bits = ~21 seconds
    // For 310 bits = ~3 seconds
    const estimatedSeconds = Math.ceil(nBits / 150) + 5; // Add 5 second buffer
    const duration = Math.min(estimatedSeconds * 1000, 60000); // Cap at 60 seconds
    const url = `/live?dur=${duration}`;

    console.log(`📡 SSE duration: ${duration}ms for ${nBits} bits`);

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url);
      let collectedBits = '';
      let timeout;

      // Set timeout: 2x the expected duration or 60 seconds, whichever is less
      const timeoutMs = Math.min(duration * 2, 60000);
      timeout = setTimeout(() => {
        eventSource.close();
        if (collectedBits.length >= nBits) {
          console.log(`✅ Got ${collectedBits.length} bits (timeout but sufficient)`);
          resolve(collectedBits.slice(0, nBits));
        } else {
          console.error(`❌ Timeout: only got ${collectedBits.length}/${nBits} bits after ${timeoutMs}ms`);
          reject(new Error(`Timeout: only got ${collectedBits.length}/${nBits} bits`));
        }
      }, timeoutMs);

      eventSource.addEventListener('bits', (e) => {
        try {
          collectedBits += e.data; // Append bits
          console.log(`📥 Received batch: ${e.data.length} bits (total: ${collectedBits.length}/${nBits})`);

          // Close once we have enough
          if (collectedBits.length >= nBits) {
            clearTimeout(timeout);
            eventSource.close();
            console.log(`✅ Successfully fetched ${nBits} bits from QRNG`);
            resolve(collectedBits.slice(0, nBits));
          }
        } catch (err) {
          clearTimeout(timeout);
          eventSource.close();
          console.error('❌ Error processing bits:', err);
          reject(err);
        }
      });

      eventSource.addEventListener('error', (err) => {
        clearTimeout(timeout);
        eventSource.close();
        console.error('❌ EventSource error:', err, {
          readyState: eventSource.readyState,
          collectedSoFar: collectedBits.length,
          needed: nBits
        });
        reject(new Error(`EventSource connection failed (collected ${collectedBits.length}/${nBits} bits)`));
      });

      // Log when connection opens
      eventSource.addEventListener('open', () => {
        console.log('🔌 QRNG connection opened');
      });
    });
  } catch (error) {
    console.error('❌ Failed to fetch QRNG bits:', error);
    throw error;
  }
}
