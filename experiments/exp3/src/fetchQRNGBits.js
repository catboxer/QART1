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
    // Use the live edge function for one-time fetch
    const url = `/live?dur=10000`; // 10 second duration

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url);
      let collectedBits = '';
      let timeout;

      // Set timeout for fetch (15 seconds max)
      timeout = setTimeout(() => {
        eventSource.close();
        if (collectedBits.length >= nBits) {
          console.log(`✅ Got ${collectedBits.length} bits (timeout but sufficient)`);
          resolve(collectedBits.slice(0, nBits));
        } else {
          console.error(`❌ Timeout: only got ${collectedBits.length}/${nBits} bits`);
          reject(new Error(`Timeout: only got ${collectedBits.length}/${nBits} bits`));
        }
      }, 15000);

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
        console.error('❌ EventSource error:', err);
        reject(new Error('EventSource connection failed'));
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
