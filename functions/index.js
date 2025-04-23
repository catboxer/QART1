/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// const { onRequest } = require('firebase-functions/v2/https');
// const logger = require('firebase-functions/logger');

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
const functions = require("firebase-functions");
const fetch = require("node-fetch");
const cors = require("cors")({origin: true});

exports.qrngProxy = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const qrngRes = await fetch(
          "https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint8",
      );
      const data = await qrngRes.json();
      res.json(data);
    } catch (err) {
      console.error("QRNG proxy error:", err);
      res.status(500).json({error: "QRNG fetch failed"});
    }
  });
});
