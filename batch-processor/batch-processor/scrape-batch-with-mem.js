#!/usr/bin/env node
/**
 * scrape-batch-with-mem.js
 * ────────────────────────
 * Processes a batch of matches and logs memory + timing.
 * Usage:
 *   BATCH_FILE=batches/batch-001.json node scrape-batch-with-mem.js --sample 20
 * Flags:
 *   --sample <n>    only process first n matches (default: all)
 */

import minimist                   from 'minimist';
import puppeteer                  from 'puppeteer';
import fs                         from 'fs/promises';
import { extractMatchSummary }    from './scrape-match-summary.js';
import { createMatchDetails }     from '../../schema.js';

const argv      = minimist(process.argv.slice(2), { default: { sample: 0 } });
const SAMPLE    = parseInt(argv.sample, 10) || 0;
const BATCH_FILE = process.env.BATCH_FILE;
if (!BATCH_FILE) {
  console.error('❌  ERROR: Set BATCH_FILE env var to your batch JSON');
  process.exit(1);
}

const delay = ms => new Promise(res => setTimeout(res, ms));

function memLog(label) {
  const m = process.memoryUsage();
  console.log(
    `MEM[${label}] RSS ${(m.rss/1e6).toFixed(1)}MB  ` +
    `heapUsed ${(m.heapUsed/1e6).toFixed(1)}MB`
  );
}

(async () => {
  memLog('start');

  const raw   = await fs.readFile(BATCH_FILE, 'utf8');
  let batch   = JSON.parse(raw);
  if (SAMPLE > 0) batch = batch.slice(0, SAMPLE);
  console.log(`Loaded ${batch.length} matches${SAMPLE ? ` (sample of ${SAMPLE})` : ''}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const results = [];
  let count = 0;

  for (const { matchId, scrapeId } of batch) {
    count++;
    const t0 = Date.now();
    console.log(`── ${matchId} (scrapeId ${scrapeId})`);

    try {
      const summary = await extractMatchSummary(browser, matchId);
      const details = createMatchDetails({
        matchId,
        internalId: summary.dateInfo?.properInternalId,
        basicInfo: summary.basicInfo,
        teams: summary.teams,
        events: summary.events || [],
        processingStatus: 'complete'
      });
      results.push({ matchId, scrapeId });
    } catch (err) {
      console.error(`   ⚠️  ${err.message}`);
      results.push({ matchId, scrapeId, error: err.message });
    }

    const ms = Date.now() - t0;
    console.log(`   ⏱️  ${ms} ms`);

    if (count % 5 === 0) memLog(`after ${count}`);
    await delay(1000 + Math.random() * 500);
  }

  await browser.close();
  memLog('browser closed');

  await fs.writeFile('output.json', JSON.stringify(results, null, 2));
  memLog('post-write');

  console.log('Done.');
})();
