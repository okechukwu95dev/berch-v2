#!/usr/bin/env node
/**
 * scrape-batch.js
 * ---------------
 *  • Reads BATCH_FILE (JSON array [{scrapeId,matchId},…]).
 *  • Scrapes summary (no H2H) with full event extraction.
 *  • Outputs result list to output.json.
 *  • Logs per-match timing and average.
 */

import puppeteer                from 'puppeteer';
import fs                       from 'fs/promises';
import { extractMatchSummary }  from './scrape-match-summary.js';
import { createMatchDetails }   from '../../schema.js';

const BATCH_FILE = process.env.BATCH_FILE;
if (!BATCH_FILE) {
  console.error('❌  Set BATCH_FILE env var'); process.exit(1);
}

const delay   = ms => new Promise(r => setTimeout(r, ms));
const elapsed = t  => { const m=new Date()-t;return `${(m/1000).toFixed(1)} s`; };

const stats = { ok:0, fail:0, total:0, t0:new Date() };
const times = [];

console.log(`Batch → ${BATCH_FILE}`);

const raw = await fs.readFile(BATCH_FILE,'utf8');
const batch = JSON.parse(raw);
console.log(`Loaded ${batch.length} rows`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
});

const results = [];

try {
  for (const {matchId,scrapeId} of batch) {
    const t0 = Date.now();
    console.log(`── ${matchId} (scrapeId ${scrapeId})`);

    try {
      const summary = await extractMatchSummary(browser, matchId);

      const details = createMatchDetails({
        matchId,
        internalId: summary.dateInfo?.properInternalId,
        basicInfo:  summary.basicInfo,
        teams:      summary.teams,
        events:     summary.events || [],
        processingStatus: 'complete'
      });

      results.push({matchId,scrapeId,details,dateInfo:summary.dateInfo});
      stats.ok++;
    } catch (err) {
      console.error(`   ⚠️  ${err.message}`);
      stats.fail++;
      results.push({matchId,scrapeId,error:err.message});
    }

    const ms = Date.now()-t0;
    times.push(ms);
    console.log(`   ⏱️  ${ms} ms`);
    stats.total++;
    await delay(1000+Math.random()*500);
  }
} finally {
  await browser.close();
}

await fs.writeFile('output.json', JSON.stringify(results,null,2));
const avg = Math.round(times.reduce((a,b)=>a+b)/times.length);
console.log(`Saved output.json (${results.length})`);
console.log(`Average: ${avg} ms (${(avg/1000).toFixed(2)} s)`);
console.log(`Done in ${elapsed(stats.t0)}  OK:${stats.ok}  FAIL:${stats.fail}`);
