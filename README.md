### To Save from firebase to backup.json firestore-export -a qartexperiment1-firebase-adminsdk-fbsvc-800e7fc19f.json -b backup.json -p

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

README: Pattern-Breaker Screening Protocol (576-bit)1. Executive SummaryThe Pattern-Breaker is a high-resolution screening tool designed to detect anomalous structural influences in Quantum Random Number Generator (QRNG) bitstreams. Unlike standard "hit-counting" (frequency bias), this protocol identifies Temporal Structure—the specific order and rhythm of bits—using Rescaled Range (R/S) Hurst Analysis and the Shuffle-Collapse Verification method.2. Core Architecture: The Paired-Delta ProtocolTo eliminate hardware noise, environmental heat fluctuations, and power-grid drift, the system utilizes a Paired Control Stream (PCS), referred to as "The Demon."Subject Stream ($H_{sub}$): The 576-bit block targeted by the observer.Demon Stream ($H_{dem}$): A simultaneous 576-bit block generated as a hidden control.The Metric: All scoring is based on the Hurst Delta ($\Delta H$):$$\Delta H = H_{sub} - H_{dem}$$3. The Dual-Resonance ScaleInfluence is measured as a departure from the "Null" baseline ($0.527$) toward two distinct poles of order: The Flow (Persistence) and The Pulse (Anti-Persistence).Negative Influence: The Pulse (Anti-Persistence)Pattern: Rapid alternation ($1 \to 0 \to 1$).Significance: This requires overcoming the QRNG's internal Von Neumann Decorrelation (the "Anti-Correlation Shield") which actively tries to scrub rhythms from the data.Positive Influence: The Flow (Persistence)Pattern: Clustering and momentum ($1 \to 1 \to 1$).Significance: This introduces a "memory" or "coherence" into a system designed to be memoryless.4. Threshold Determination & SignificanceBased on Monte Carlo simulations of $10^5$ iterations at $N=576$, the standard deviation ($\sigma$) is established at $0.035$.LabelΔHσ DeviationVerdictThe Void$-0.180$$-5.1\sigma$Anomalous PulseVibrational$-0.135$$-3.9\sigma$Exceptional PulseSynchronized$-0.090$$-2.6\sigma$Strong PulseEmerging Pulse$-0.045$$-1.3\sigma$NoticeableNeutral$0.000$$0\sigma$BaselineEmerging Flow$+0.045$$+1.3\sigma$NoticeableCoherent$+0.090$$+2.6\sigma$Strong FlowCrystalline$+0.135$$+3.9\sigma$Exceptional FlowThe Ghost$+0.180$$+5.1\sigma$Anomalous Flow5. The Verification Gate (The Shuffle Test)A session (40 blocks) is only "Confirmed" if it passes the Shuffle-Collapse Test. This distinguishes between a simple frequency bias (more 1s than 0s) and a true temporal pattern.Original Session: Calculate the D-statistic ($D_{orig}$) comparing the session distribution to the baseline ($p < 0.05$ required).The Scramble: Every bit within the 40 blocks is randomly shuffled, destroying the temporal order but keeping the 1-to-0 ratio identical.The Comparison:Pass: If $D$ drops by $\ge 30\%$ upon shuffling, the influence was Temporal (The order mattered).Fail: If $D$ remains stable, the influence was Frequency-based (The order did not matter).6. Technical ConstantsBlock Size ($N$): 576 bits (Optimized for multi-scale R/S factors).Null Mean ($H_{null}$): 0.527 (Finite-sample bias for R/S at $N=576$).Session Length: 40 Blocks.Confidence Threshold: $p < 0.05$ (KS-Test).7. Subject InterpretationA "Pulse" (Negative): You are projecting a high-energy, rhythmic oscillation into the entropy. It is a "metronomic" influence.A "Flow" (Positive): You are projecting a steady, coherent momentum into the entropy. It is a "unifying" influence.Both polarities represent a successful "Pattern-Breaker" event.