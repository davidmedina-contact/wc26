import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    const fallback = process.env.PLAYWRIGHT_PATH ||
      '/Users/jdmedina/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
    return import(pathToFileURL(fallback).href);
  }
}

const target = process.argv[2] || 'http://127.0.0.1:4173/#bracket';
const apiUrl = process.env.BRACKET_SMOKE_API_URL || '';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function count(text, needle) {
  return (text.match(new RegExp(needle, 'g')) || []).length;
}

async function bracketText(page) {
  const titles = await page.locator('#tab-bracket .bracket-round-title').evaluateAll(nodes => nodes.map((node, index) => ({
    index,
    text: node.textContent || '',
  })));
  const r32 = titles.find(row => row.text.includes('Round of 32'));
  return page.evaluate(index => {
    const title = document.querySelectorAll('#tab-bracket .bracket-round-title')[index];
    return title && title.nextElementSibling ? title.nextElementSibling.innerText : '';
  }, r32.index);
}

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  if (apiUrl) {
    await page.route('**/api/data', async route => {
      const response = await fetch(apiUrl, {
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });
      const body = await response.text();
      await route.fulfill({
        status: response.status,
        headers: {
          'content-type': response.headers.get('content-type') || 'application/json',
          etag: response.headers.get('etag') || '',
        },
        body,
      });
    });
  }

  await page.goto(target, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tab-bracket.active .bracket-info', { timeout: 15000 });

  const live = await page.evaluate(() => ({
    mode: document.querySelector('[data-bracket-mode].active')?.textContent.trim(),
    progress: document.querySelector('.bracket-progress-label')?.textContent.trim(),
    resetVisible: Boolean(document.querySelector('#resetBtn')),
    tapHints: document.querySelectorAll('#tab-bracket .bracket-tap-hint').length,
    confirmedRanks: [...document.querySelectorAll('#tab-bracket .bt-rank')]
      .filter(node => node.textContent.includes('confirmed')).length,
    dateTimeLabels: [...document.querySelectorAll('#tab-bracket .bracket-date-time')]
      .map(node => node.textContent.trim()).slice(0, 4),
    matchLabels: [...document.querySelectorAll('#tab-bracket .bracket-match-lbl')]
      .map(node => node.childNodes[0]?.textContent?.trim() || node.textContent.trim()),
    banner: document.querySelector('#matchStrip .ms-teams')?.textContent.trim() || '',
  }));
  assert(live.mode === 'Live Bracket', 'Live Bracket should be the default mode', live);
  assert(live.progress === 'Live bracket uses confirmed seeds and FT winners only', 'Live mode should not show a picks-made counter', live);
  assert(live.resetVisible === false, 'Live mode should not show Reset Picks', live);
  assert(live.tapHints === 0, 'Live mode should be read-only and hide tap-to-pick hints', live);
  assert(live.confirmedRanks > 0, 'Live bracket should visibly mark confirmed teams', live);
  assert(live.dateTimeLabels.some(label => /Jun|Jul/.test(label) && /\d:\d{2} (AM|PM)/.test(label)), 'Bracket cards should show date and local time labels', live);
  assert(live.matchLabels.includes('M89 · W M74 vs W M77'), 'R16 Match 89 must follow FIFA official paths', live);
  assert(live.matchLabels.includes('M98 · W M93 vs W M94'), 'Quarterfinal Match 98 must follow FIFA official paths', live);
  assert(live.matchLabels.includes('M103 · L M101 vs L M102'), 'Bronze final must receive both semifinal losers', live);
  assert(live.matchLabels.includes('M104 · Final'), 'Final must use FIFA Match 104', live);
  assert(!/Group|TBD|W M|L M/.test(live.banner), 'Next-match banner should use confirmed teams when available', live);

  await page.evaluate(() => {
    localStorage.setItem('wc2026bracketMode', 'picks');
    localStorage.setItem('wc2026bracket', JSON.stringify({
      g_H_3: 'Uruguay',
      g_I_1: 'Uruguay',
      ko_M79: 'Uruguay',
      ko_R16_0: 'South Africa',
    }));
    localStorage.setItem('wc2026bracketOriginal', JSON.stringify({
      g_H_3: 'Uruguay',
      ko_M79: 'Uruguay',
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#tab-bracket.active .bracket-info', { timeout: 15000 });

  const picksR32 = await bracketText(page);
  const picks = await page.evaluate(() => ({
    mode: document.querySelector('[data-bracket-mode].active')?.textContent.trim(),
    progress: document.querySelector('.bracket-progress-label')?.textContent.trim(),
    resetVisible: Boolean(document.querySelector('#resetBtn')),
    tapHints: document.querySelectorAll('#tab-bracket .bracket-tap-hint').length,
    groupText: document.querySelector('#bracketGrid')?.innerText || '',
  }));
  assert(picks.mode === 'My Picks', 'Saved picks mode should restore My Picks', picks);
  assert(/knockout picks made$/.test(picks.progress), 'My Picks should show knockout-pick progress', picks);
  assert(picks.resetVisible === true, 'My Picks should show Reset Picks', picks);
  assert(picks.tapHints > 0, 'My Picks should keep tap-to-pick affordances', picks);
  assert(count(picksR32, 'Uruguay') <= 1, 'A stale third-place Uruguay pick must not be reused across R32 slots', { picksR32 });
  assert(/3rd (pick|auto|confirmed)/.test(picks.groupText), 'Group cards should expose third-place state labels', picks);
  assert(picks.progress === '1/32 knockout picks made', 'Legacy R16 picks should migrate to official match IDs', picks);

  await page.click('[data-bracket-mode="live"]');
  await page.waitForTimeout(250);
  const liveR32 = await bracketText(page);
  const returnedLive = await page.evaluate(() => ({
    mode: document.querySelector('[data-bracket-mode].active')?.textContent.trim(),
    progress: document.querySelector('.bracket-progress-label')?.textContent.trim(),
    resetVisible: Boolean(document.querySelector('#resetBtn')),
    tapHints: document.querySelectorAll('#tab-bracket .bracket-tap-hint').length,
    savedPicks: JSON.parse(localStorage.getItem('wc2026bracket') || '{}'),
  }));
  assert(returnedLive.mode === 'Live Bracket', 'Switching modes should activate Live Bracket', returnedLive);
  assert(returnedLive.progress === 'Live bracket uses confirmed seeds and FT winners only', 'Switching to Live should reset visible pick progress', returnedLive);
  assert(returnedLive.resetVisible === false, 'Switching to Live should hide Reset Picks', returnedLive);
  assert(returnedLive.tapHints === 0, 'Switching to Live should hide pick hints', returnedLive);
  assert(count(liveR32, 'Uruguay') <= 1, 'Live Bracket must not display stale duplicate Uruguay picks', { liveR32 });
  assert(returnedLive.savedPicks.g_H_3 === 'Uruguay', 'Switching to Live should not delete saved My Picks data', returnedLive);
  assert(returnedLive.savedPicks.ko_M90 === 'South Africa' && !returnedLive.savedPicks.ko_R16_0, 'Legacy internal match IDs should migrate without losing picks', returnedLive);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#tab-bracket.active .bracket-info', { timeout: 15000 });
  const mobile = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewport: window.innerWidth,
    progress: document.querySelector('.bracket-progress-label')?.textContent.trim(),
    dateTimeSample: document.querySelector('#tab-bracket .bracket-date-time')?.textContent.trim(),
    buttons: [...document.querySelectorAll('[data-bracket-mode]')].map(button => ({
      text: button.textContent.trim(),
      width: Math.round(button.getBoundingClientRect().width),
    })),
  }));
  assert(mobile.bodyWidth <= mobile.viewport + 2, 'Bracket should not horizontally overflow on mobile', mobile);
  assert(mobile.buttons.every(button => button.width > 90), 'Mode buttons should remain usable on mobile', mobile);

  console.log(JSON.stringify({ target, live, picks, returnedLive, mobile }, null, 2));
} finally {
  await browser.close();
}
