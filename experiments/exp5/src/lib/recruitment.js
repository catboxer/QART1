/**
 * Recruitment source, read from the URL at app start.
 *
 * Prolific appends ?PROLIFIC_PID=...&STUDY_ID=...&SESSION_ID=... to the study
 * URL. If PROLIFIC_PID is present the participant is treated as Prolific-
 * recruited; otherwise as directly recruited. The result is cached in
 * sessionStorage so a refresh (which keeps the URL) or in-app navigation that
 * drops the query string does not flip the participant to the other form.
 */
const KEY = 'exp5_recruitment';

// "2" or "wave2" -> 2; anything else -> null
function parseWave(raw) {
  const m = /(\d+)/.exec(String(raw || ''));
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function getRecruitment() {
  try {
    const params = new URLSearchParams(window.location.search);
    const pid = (params.get('PROLIFIC_PID') || '').trim();
    if (pid) {
      const rec = {
        source: 'prolific',
        prolificId: pid,
        studyId: (params.get('STUDY_ID') || '').trim() || null,
        sessionId: (params.get('SESSION_ID') || '').trim() || null,
        // Which session this Prolific link is for: ?WAVE=2 (or WAVE=wave2) -> 2
        wave: parseWave(params.get('WAVE') ?? params.get('wave')),
      };
      sessionStorage.setItem(KEY, JSON.stringify(rec));
      return rec;
    }
    // Directly recruited participants get a personal link: ?TREMENDOUS=<code>.
    // The code is only matched against the list of links issued, when paying.
    const token = (params.get('TREMENDOUS') || '').trim();
    if (token) {
      const rec = {
        source: 'direct',
        prolificId: null,
        studyId: null,
        sessionId: null,
        wave: null,
        tremendousToken: token,
      };
      sessionStorage.setItem(KEY, JSON.stringify(rec));
      return rec;
    }
    const cached = sessionStorage.getItem(KEY);
    if (cached) return JSON.parse(cached);
  } catch {
    // sessionStorage / URL unavailable: fall through to direct
  }
  return { source: 'direct', prolificId: null, studyId: null, sessionId: null, wave: null, tremendousToken: null };
}
