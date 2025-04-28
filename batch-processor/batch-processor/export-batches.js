#!/usr/bin/env node
/**
 * export-batches.js
 * ─────────────────
 * Dump **pending** matches into JSON batch files and mark them queued.
 *
 * Flags
 *  --limit   <n>           docs per file (default 400)
 *  --start   <id>          minimum scrapeId (default 0)
 *  --excludeCountry <c1,c2>   skip whole countries      (optional)
 *  --excludeLeague  <l1,l2>   skip specific leagues     (optional)
 *
 * Examples
 *  node export-batches.js --limit 400
 *  node export-batches.js --excludeLeague "Premier League,LaLiga"
 *  node export-batches.js --start 15000 --excludeCountry England
 */

import minimist           from 'minimist';
import fs                 from 'fs/promises';
import { connect }        from '../../database.js';

const argv     = minimist(process.argv.slice(2));
const LIMIT    = +argv.limit  || 2500;
const START    = +argv.start  || 0;

const EX_COUNTRY = (argv.excludeCountry || '')
  .split(',').map(s=>s.trim()).filter(Boolean);          // ["England","Spain"]
const EX_LEAGUE  = (argv.excludeLeague  || '')
  .split(',').map(s=>s.trim()).filter(Boolean);          // ["Premier League","La Liga"]

await fs.mkdir('batches', { recursive: true });

const { db, client } = await connect();

/* --------------------------- query --------------------------- */
const query = { processingStatus: 'pending' };
if (START)             query.scrapeId = { $gte: START };
if (EX_COUNTRY.length) query.country  = { $nin: EX_COUNTRY };
if (EX_LEAGUE.length)  query.league   = { $nin: EX_LEAGUE };

/* ------------------------ export loop ------------------------ */
const cur = db.collection('matches')
              .find(query)
              .project({ scrapeId:1, matchId:1, _id:0 })
              .sort({ scrapeId:1 });

let buf=[], fileIdx=0;

for await (const m of cur) {
  buf.push(m);
  if (buf.length===LIMIT) await flush();
}
if (buf.length) await flush();

await client.close();
console.log('✅ export-batches DONE');

async function flush(){
  fileIdx++;
  const name=`batches/batch-${String(fileIdx).padStart(3,'0')}.json`;
  await fs.writeFile(name,JSON.stringify(buf));
  const ids=buf.map(x=>x.matchId);
  await db.collection('matches').updateMany(
    { matchId:{ $in: ids } },
    { $set:{ processingStatus:'queued', updatedAt:new Date() }});
  console.log(`Wrote ${buf.length} ➜ ${name}`);
  buf=[];
}
