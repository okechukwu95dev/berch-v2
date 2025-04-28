import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import crypto from 'crypto';
import zlib from 'zlib';

console.log('[database.js] 📦 Module loaded');

dotenv.config();

// Configuration
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME   = process.env.DB_NAME   || 'flashscore';
const MATCHES_COLLECTION    = 'matches';
const CHECKPOINT_COLLECTION = 'checkpoints';

// Encryption setup (optional – left unchanged)
const algorithm  = 'aes-256-ctr';
const secretKey  = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  : Buffer.from('your-fallback-key-here'.repeat(2), 'utf8');

// DB connection (singleton style)
let client;
let db;
let isConnected = false;

export async function connect() {
  if (isConnected) return { db, client };

  console.time('[database.js] ⏳ Connecting to MongoDB');
  client = new MongoClient(MONGO_URI, { appName: 'flashscore-scraper' });
  await client.connect();
  db = client.db(DB_NAME);
  isConnected = true;
  console.timeEnd('[database.js] ⏳ Connecting to MongoDB');
  console.log(`[database.js] ✅ Connected to [32m${DB_NAME}\u001b[0m @ ${MONGO_URI}`);
  return { db, client };
}

// ──────────────────────────────────────────────────────────────
//  database.js   (only the saveMatches function shown here)
// ──────────────────────────────────────────────────────────────
// Add to database.js

// New schema definitions
export const matchDetailsSchema = {
  matchId:   String,
  internalId: String,
  basicInfo: Object,
  teams: Object,
  events: Array,
  processedAt: Date,
  processingStatus: {
    type:   String,
    enum:   ['pending', 'complete', 'failed'],
    default: 'pending'
  },
  createdAt: Date,
  updatedAt: Date
};

export const matchH2HSchema = {
  matchId:   String,
  internalId: String,
  sections: Array,
  processedAt: Date,
  processingStatus: {
    type:   String,
    enum:   ['pending', 'complete', 'failed'],
    default: 'pending'
  },
  createdAt: Date,
  updatedAt: Date
};

export async function saveMatches(matches) {
  if (!isConnected) await connect();

  if (!Array.isArray(matches) || matches.length === 0) {
    console.warn('[database.js] ⚠️ saveMatches called with empty array');
    return 0;
  }

  console.log(`[database.js] 💾 Attempting to insert ${matches.length} matches…`);

  try {
    const res = await db.collection(MATCHES_COLLECTION)
      .insertMany(
        matches.map(m => ({ ...m, createdAt: new Date() })),
        { ordered: false }              // keep going after dup-key errors
      );

    console.log(`[database.js] ✅ Inserted ${res.insertedCount} new docs`);
    return res.insertedCount;
  } catch (err) {
    // Duplicate-key errors (code 11000) are expected when index is unique
    if (err.code === 11000) {
      const inserted = err.result?.result?.nInserted ?? 0;
      const skipped  = matches.length - inserted;
      console.warn(
        `[database.js] ⚠️ Duplicate key error – ${skipped} doc(s) skipped, ` +
        `${inserted} inserted`
      );
      return inserted;
    }

    // Any other error is unexpected – re-throw so the caller can decide
    console.error('[database.js] ❌ Unexpected DB error:', err);
    throw err;
  }
}

//h2h and summary -- new
// Save match details to the match_details collection
export async function saveMatchDetails(details) {
  if (!isConnected) await connect();

  console.log(`[database.js] 💾 Saving details for match ${details.matchId}`);

  try {
    const res = await db.collection('match_details').updateOne(
      { matchId: details.matchId },
      { $set: { ...details, updatedAt: new Date() } },
      { upsert: true }
    );

    console.log(`[database.js] ✅ Match details saved`);
    return res.upsertedCount > 0 || res.modifiedCount > 0;
  } catch (err) {
    console.error('[database.js] ❌ Error saving match details:', err);
    throw err;
  }
}

// Save match H2H data to the match_h2h collection
export async function saveMatchH2H(h2hData) {
  if (!isConnected) await connect();

  console.log(`[database.js] 💾 Saving H2H data for match ${h2hData.matchId}`);

  try {
    const res = await db.collection('match_h2h').updateOne(
      { matchId: h2hData.matchId },
      { $set: { ...h2hData, updatedAt: new Date() } },
      { upsert: true }
    );

    console.log(`[database.js] ✅ Match H2H data saved`);
    return res.upsertedCount > 0 || res.modifiedCount > 0;
  } catch (err) {
    console.error('[database.js] ❌ Error saving match H2H data:', err);
    throw err;
  }
}

// Update match processing status
export async function updateMatchStatus(matchId, status) {
  if (!isConnected) await connect();

  console.log(`[database.js] 🔄 Updating match ${matchId} status to ${status}`);

  try {
    const res = await db.collection('matches').updateOne(
      { matchId: matchId },
      {
        $set: {
          processingStatus: status,
          updatedAt: new Date()
        },
        $inc: { processingAttempts: 1 }
      }
    );

    console.log(`[database.js] ✅ Match status updated`);
    return res.modifiedCount > 0;
  } catch (err) {
    console.error('[database.js] ❌ Error updating match status:', err);
    throw err;
  }
}

export async function getMatchesForProcessing(options = {}) {
  if (!isConnected) await connect();

  const {
    status = 'pending',
    country = null,
    league = null,
    team = null,
    limit = 100,
    maxAttempts = 3,
    excludePairs = null
  } = options;

  // Handle array of statuses or single status
  const statusCondition = Array.isArray(status)
    ? { $in: status }
    : status;

  const query = {
    processingStatus: statusCondition,
    processingAttempts: { $lt: maxAttempts }
  };

  if (country) query.country = country;
  if (league) query.league = league;
  if (team) query.team = team;

  // Handle exclusion of certain country-league pairs
  if (excludePairs && excludePairs.size > 0) {
    const excludeConditions = Array.from(excludePairs).map(pair => {
      const [excludeCountry, excludeLeague] = pair.split('-');
      return { country: excludeCountry, league: excludeLeague };
    });

    if (excludeConditions.length > 0) {
      query.$nor = excludeConditions;
    }
  }

  console.log(`[database.js] 🔍 Getting matches for processing with query:`, JSON.stringify(query));

  try {
    // First, check if the scrapeId field exists by examining one document
    const sampleMatch = await db.collection('matches').findOne({}, { projection: { scrapeId: 1 } });

    // Determine which sort to use based on whether scrapeId exists
    const sortCriteria = sampleMatch && sampleMatch.scrapeId !== undefined
      ? { scrapeId: 1 }          // Use scrapeId if it exists
      : { scrapedAt: 1 };        // Fall back to scrapedAt otherwise

    console.log(`[database.js] 📊 Sorting by ${Object.keys(sortCriteria)[0]}`);

    const matches = await db.collection('matches')
      .find(query)
      .sort(sortCriteria)
      .limit(limit)
      .toArray();

    console.log(`[database.js] ✅ Found ${matches.length} matches to process`);
    return matches;
  } catch (err) {
    console.error('[database.js] ❌ Error getting matches for processing:', err);
    throw err;
  }
}


// Get full match data (match + details + H2H)
export async function getFullMatchData(matchId) {
  if (!isConnected) await connect();

  console.log(`[database.js] 🔍 Getting full data for match ${matchId}`);

  try {
    const pipeline = [
      { $match: { matchId: matchId } },
      { $lookup: {
        from: 'match_details',
        localField: 'matchId',
        foreignField: 'matchId',
        as: 'details'
      }},
      { $lookup: {
        from: 'match_h2h',
        localField: 'matchId',
        foreignField: 'matchId',
        as: 'h2h'
      }},
      { $unwind: { path: '$details', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$h2h', preserveNullAndEmptyArrays: true } }
    ];

   const result = await db.collection('matches').aggregate(pipeline).toArray();

    if (result.length === 0) {
      console.log(`[database.js] ⚠️ No match found with ID ${matchId}`);
      return null;
    }

    console.log(`[database.js] ✅ Full match data retrieved`);
    return result[0];
  } catch (err) {
    console.error('[database.js] ❌ Error getting full match data:', err);
    throw err;
  }
}

export async function saveCheckpoint(data) {
  if (!isConnected) await connect();
  console.log('[database.js] 💾 Saving checkpoint');
  await db.collection(CHECKPOINT_COLLECTION).updateOne(
    { _id: 'scraper-state' },
    { $set: { ...data, updatedAt: new Date() } },
    { upsert: true }
  );
  console.log('[database.js] ✅ Checkpoint saved');
  return true;
}

export async function getCheckpoint() {
  if (!isConnected) await connect();
  console.log('[database.js] 🔍 Retrieving checkpoint');
  return db.collection(CHECKPOINT_COLLECTION).findOne({ _id: 'scraper-state' });
}

export async function disconnect() {
  if (!client) return;
  console.time('[database.js] ⏳ Disconnecting MongoDB');
  await client.close();
  isConnected = false;
  console.timeEnd('[database.js] ⏳ Disconnecting MongoDB');
  console.log('[database.js] 📦 Disconnected from MongoDB');
}


export async function saveLeagues(leagues) {
  if (!isConnected) await connect();

  if (!Array.isArray(leagues) || leagues.length === 0) {
    console.warn('[database.js] ⚠️ saveLeagues called with empty array');
    return 0;
  }

  console.log(`[database.js] 💾 Attempting to insert/update ${leagues.length} leagues…`);

  const bulkOps = leagues.map(league => ({
    updateOne: {
      filter: { country: league.country, league: league.league },
      update: { $set: { ...league, updatedAt: new Date() } },
      upsert: true
    }
  }));

  try {
    const res = await db.collection('leagues').bulkWrite(bulkOps, { ordered: false });
    console.log(`[database.js] ✅ Leagues inserted/updated`);
    return res;
  } catch (err) {
    console.error('[database.js] ❌ Error inserting/updating leagues:', err);
    throw err;
  }
}

export async function getLeagues(filter = {}) {
  if (!isConnected) await connect();

  console.log('[database.js] 🔍 Fetching leagues with filter:', filter);

  try {
    const leagues = await db.collection('leagues')
      .find(filter)
      .sort({ country: 1, league: 1 })
      .toArray();

    console.log(`[database.js] ✅ Found ${leagues.length} leagues`);
    return leagues;
  } catch (err) {
    console.error('[database.js] ❌ Error fetching leagues:', err);
    throw err;
  }
}

