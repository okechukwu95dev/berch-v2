// utils.js
// Shared date parsing and ID generation utilities

/**
 * Parses a date string in various Flashscore formats into a JS Date.
 * Supports "DD.MM.YYYY HH:MM" and falls back to native parsing.
 * @param {string} dateStr
 * @returns {Date|null}
 */
export function parseDate(dateStr) {
  if (!dateStr) return null;

  // Match e.g. "25.04.2025 15:00"
  const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}:\d{2})/);
  if (m) {
    const [, d, M, Y, t] = m;
    return new Date(`${Y}-${M.padStart(2,'0')}-${d.padStart(2,'0')}T${t}:00`);
  }

  // Fallback to Date constructor
  const fallback = new Date(dateStr);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Creates a consistent internalId for a match without the league.
 * Format: YYYYMMDD_hometeam_vs_awayteam
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {Date} date
 * @returns {string}
 */
export function createInternalId(homeTeam, awayTeam, date) {
  const normalize = str =>
    str?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

  let datePart = '';
  if (date instanceof Date && !isNaN(date.getTime())) {
    datePart = date.toISOString().split('T')[0].replace(/-/g, '');
  }

  return `${datePart}_${normalize(homeTeam)}_vs_${normalize(awayTeam)}`;
}

/**
 * Updates the date and (optionally) internalId for a match document in MongoDB.
 * @param {object} db - MongoDB database instance
 * @param {string} matchId
 * @param {Date} date
 * @param {string} [internalId]
 * @returns {Promise<boolean>} - true if a document was modified
 */
export async function updateMatchDate(db, matchId, date, internalId) {
  console.log(`[utils] 🔄 Updating match ${matchId}: date=${date.toISOString()} internalId=${internalId}`);
  const updateFields = {
    date,
    dateFixed: true,
    dateFixedAt: new Date(),
    updatedAt: new Date()
  };
  if (internalId) updateFields.internalId = internalId;

  const res = await db.collection('matches').updateOne(
    { matchId },
    { $set: updateFields }
  );

  console.log(`[utils] ✅ Modified ${res.modifiedCount} document(s)`);
  return res.modifiedCount > 0;
}


// utils.js  ───────────────
export function dedupeEvents(raw) {
  const byKey = new Map();                // key = minute|type|player

  for (const e of raw) {
    const key = [e.minute, e.type, e.player].join('|');

    if (!byKey.has(key)) {
      byKey.set(key, { ...e });           // first sighting
      continue;
    }

    // merge second variant
    const stored = byKey.get(key);

    // keep assist if one version has it
    if (!stored.assist && e.assist) stored.assist = e.assist;

    // propagate own-goal flag
    if (e.isOwnGoal) stored.isOwnGoal = true;
  }

  return [...byKey.values()];
}

