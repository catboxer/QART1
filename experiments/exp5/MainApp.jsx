// inside the 'rest' branch, when nextKind === 'retro'
import RedundancyGate from "./RedundancyGate";

// pick a tier randomly per RETRO minute
const nextTier = ["R0", "R1", "R2"][Math.floor(crypto.getRandomValues(new Uint8Array(1))[0] / 86)]; // ~uniform 0..2

<RedundancyGate
  tier={nextTier}
  commitPayload={{
    H_tape: (nextIsLastRetro ? tapeB?.H_tape : tapeA?.H_tape),
    H_commit: (nextIsLastRetro ? tapeB?.H_commit : tapeA?.H_commit),
    lenBits: C.RETRO_TAPE_BITS,
    createdISO: (nextIsLastRetro ? tapeB?.createdISO : tapeA?.createdISO),
  }}
  onDone={(redundancyInfo) => {
    // stash redundancyInfo in a ref so persistMinute can write it:
    window.__lastRedundancyInfo = redundancyInfo; // or use a React ref
    // then trigger the usual AutoAdvance/startNextMinute
  }}
/>;
