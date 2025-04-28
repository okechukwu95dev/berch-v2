// ─────────────────────────────────────────────
// schema.js
// ─────────────────────────────────────────────
console.log('[schema.js] 📜 Module loaded');

// Match schema – represents a football match record
export const matchSchema = {
  matchId:   String,
  internalId: String,
  team:      String,
  teamName:  String,
  league:    String,
  country:   String,
  date:      Date,
  homeTeam:  String,
  awayTeam:  String,
  homeScore: String,
  awayScore: String,
  scrapedAt: Date,
  processingStatus: {
    type:   String,
    enum:   ['pending', 'summary_pending', 'summary_complete', 'h2h_pending', 'complete', 'failed'],
    default: 'pending'
  },
  processingAttempts: {
    type: Number,
    default: 0
  },
  updatedAt: Date
};

// Checkpoint schema – represents scraper state for resuming
export const checkpointSchema = {
  _id:       String,
  country:   String,
  league:    String,
  team:      String,
  teamId:    String,
  index:     Number,
  timestamp: Date,
  stats: {
    totalTeams:       Number,
    processedTeams:   Number,
    matchesScraped:   Number,
    startTime:        Date,
    elapsedTime:      String
  }
};

// Validate a match object against the schema
export function validateMatch(match) {
  const required = ['matchId', 'internalId', 'team', 'homeTeam', 'awayTeam'];
  const missing   = required.filter(f => !match[f]);
  if (missing.length) {
    console.error(`[schema.js] ❌ Validation failed – missing: ${missing.join(', ')}`);
    return { valid: false, errors: [`Missing required fields: ${missing.join(', ')}`] };
  }
  return { valid: true };
}

// Helper to create a match object with defaults
export function createMatch(data={}) {
  const match = {
    matchId: '',
    internalId: '',
    team: '',
    teamName: '',
    league: '',
    country: '',
    date: new Date(),
    homeTeam: '',
    awayTeam: '',
    homeScore: '',
    awayScore: '',
    scrapedAt: new Date(),
    processingStatus: 'pending',
    ...data
  };
  console.debug('[schema.js] 🆕 createMatch', match.internalId || match.matchId);
  return match;
}

// Helper to create a match details object
export function createMatchDetails(data={}) {
  const details = {
    matchId: '',
    internalId: '',
    basicInfo: {},
    teams: {},
    events: [],
    processedAt: new Date(),
    processingStatus: 'pending',
    createdAt: new Date(),
    ...data
  };
  console.debug('[schema.js] 🆕 createMatchDetails', details.matchId);
  return details;
}

// Helper to create a match H2H object
export function createMatchH2H(data={}) {
  const h2h = {
    matchId: '',
    internalId: '',
    sections: [],
    processedAt: new Date(),
    processingStatus: 'pending',
    createdAt: new Date(),
    ...data
  };
  console.debug('[schema.js] 🆕 createMatchH2H', h2h.matchId);
  return h2h;
}
