#!/usr/bin/env node

/**
 * scrape-match-summary.js
 * -----------------
 * Modified version that processes matches without H2H data
 */

import { parseDate, createInternalId } from '../../utils.js';
import { createMatchDetails } from '../../schema.js';
import puppeteer from 'puppeteer';
import fs from 'fs/promises';

// Helper functions
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to dedupe events (copied from your utils.js)
function dedupeEvents(events) {
  // Implement deduplication logic here or import from utils
  // This is a placeholder - use your actual implementation
  return events.filter((event, index, self) =>
    index === self.findIndex(e =>
      e.minute === event.minute &&
      e.type === event.type &&
      e.player === event.player
    )
  );
}

// Summary extraction
async function extractMatchSummary(browser, matchId) {
  const url = `https://www.flashscoreusa.com/game/soccer/${matchId}/#/game-summary/game-summary`;
  console.log(`🔍 Summary URL: ${url}`);

  const page = await browser.newPage();

  // Optimize page loading - block unnecessary resources
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    // Keep CSS for better compatibility with clicks and element detection
    if (['image', 'font', 'media'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });

  // Dismiss cookie popup
  try {
    await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000 });
    await page.click('#onetrust-accept-btn-handler');
    console.log('✅ Cookie popup accepted');
    await delay(500);
  } catch {
    console.log('⚠️ No cookie popup found or already dismissed');
  }

  // Basic info
  const basicInfo = await page.evaluate(() => ({
    homeTeam: document.querySelector('.duelParticipant__home .participant__participantName')?.textContent.trim() || null,
    awayTeam: document.querySelector('.duelParticipant__away .participant__participantName')?.textContent.trim() || null,
    score: {
      home: document.querySelector('.detailScore__wrapper span:first-child')?.textContent.trim() || null,
      away: document.querySelector('.detailScore__wrapper span:last-child')?.textContent.trim() || null
    },
    dateStr: document.querySelector('.duelParticipant__startTime')?.textContent.trim() || null,
    competition: (
      Array.from(document.querySelectorAll('.detail__breadcrumbs a[itemprop="item"] span[data-testid="wcl-scores-overline-03"]')).pop()?.textContent.trim() || null
    )
  }));

  // Team & league data
  const teamData = await page.evaluate(() => {
    const getTeamData = sel => {
      const name = document.querySelector(`${sel} .participant__participantName`)?.textContent.trim() || null;
      const href = document.querySelector(`${sel} a.participant__participantLink`)?.href || null;
      const id = href ? href.split('/').filter(Boolean).pop() : null;
      return { name, id };
    };
    const home = getTeamData('.duelParticipant__home');
    const away = getTeamData('.duelParticipant__away');
    const spans = Array.from(document.querySelectorAll('.detail__breadcrumbs a[itemprop="item"] span'));
    let league = spans.pop()?.textContent.trim() || '';
    league = league.replace(/ - Round\s*\d+$/i, '');
    return { home, away, league };
  });

  // Parse date and create internalId
  // Instead of updating DB, we'll include this in the output
  const matchDate = parseDate(basicInfo.dateStr);
  let dateInfo = null;

  if (matchDate) {
    const properInternalId = createInternalId(teamData.home.name, teamData.away.name, matchDate);
    dateInfo = {
      parsedDate: matchDate,
      properInternalId
    };
    console.log(`✅ Date parsed: ${matchDate} with ID: ${properInternalId}`);
  } else {
    console.warn(`⚠️ Unable to parse date '${basicInfo.dateStr}' for ${matchId}`);
  }

  // Normalize teams
  const normalize = s => s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  const teams = {
    home: { ...teamData.home, internalId: normalize(teamData.home.name) },
    away: { ...teamData.away, internalId: normalize(teamData.away.name) },
    league: teamData.league
  };

  // Events with improved goal detection
// Event extraction
const events = await page.evaluate(() => {
  const list = [];
  const incs = document.querySelectorAll(
    '.smv__incident, .detailScore__incident, .event__incident'
  );
  incs.forEach(inc => {
    const minute = inc.querySelector(
      '.smv__timeBox, .time, .incident__time'
    )?.textContent.trim() || null;

    const t = inc.textContent || '';
    const own = /Own goal/i.test(t);
    const goal = own || /Goal|Gooal/i.test(t) ||
                 inc.querySelector('.smv__incidentHomeScore, .smv__incidentAwayScore');

    let type = 'other';
    if (goal)          type = own ? 'ownGoal' : 'goal';
    else if (inc.querySelector('.yellowCard-ico')) type = 'yellowCard';
    else if (inc.querySelector('.redCard-ico'))    type = 'redCard';
    else if (/substitution/i.test(t))              type = 'substitution';

    const player = inc.querySelector(
      'a.smv__playerName, .participant__participantName'
    )?.textContent.trim() || null;

    const assist = inc.querySelector('.smv__assist a')?.textContent.trim() || null;

    list.push({ minute, type, player, assist });
  });
  return list;
});

  // Clean up events
  const stripped = events.map(event => {
    const { hasHomeScore, hasAwayScore, hasSoccerIcon,
            hasGoalClass, goalTextMatch, ...clean } = event;

    if (event.type === 'ownGoal') {
      clean.type = 'goal';
      clean.isOwnGoal = true;
    }
    return clean;
  });

  const cleanedEvents = dedupeEvents(stripped);

  const raw   = events.length;
  const kept  = cleanedEvents.length;
  const goals = cleanedEvents.filter(e => e.type === 'goal').length;
  console.log(`   📊 Raw ${raw} → Unique ${kept} (dropped ${raw - kept}), goals: ${goals}`);

  await page.close();

  return {
    matchId,
    basicInfo,
    events: kept ? cleanedEvents : null,
    teams,
    dateInfo  // Include date information in the output
  };
}

// Export the function
export { extractMatchSummary };
