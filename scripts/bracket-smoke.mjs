import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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
const screenshotDir = process.env.BRACKET_SMOKE_SCREENSHOTS || '';
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

function count(text, needle) {
  return (text.match(new RegExp(needle, 'g')) || []).length;
}

async function bracketText(page) {
  return page.evaluate(() => [...document.querySelectorAll('.bracket-desktop-map [data-match-id]')]
    .filter(node => /^M(7[3-9]|8[0-8])$/.test(node.dataset.matchId))
    .map(node => node.innerText).join('\n'));
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
    extraHTTPHeaders: protectionBypass ? {
      'x-vercel-protection-bypass': protectionBypass,
      'x-vercel-set-bypass-cookie': 'true',
    } : {},
  });
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push('pageerror: ' + error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      const location = message.location();
      browserErrors.push('console: ' + message.text() + (location.url ? ' [' + location.url + ']' : ''));
    }
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
    confirmedNodes: [...document.querySelectorAll('.bracket-desktop-map .bracket-live-badge')]
      .filter(node => node.textContent.includes('set')).length,
    dateTimeLabels: [...document.querySelectorAll('#tab-bracket .bracket-date-time')]
      .map(node => node.textContent.trim()).slice(0, 4),
    desktopIds: [...document.querySelectorAll('.bracket-desktop-map [data-match-id]')].map(node => node.dataset.matchId),
    mobilePanels: document.querySelectorAll('[data-mobile-panel]').length,
    activeMobileIds: [...document.querySelectorAll('[data-mobile-panel].active [data-match-id]')].map(node => node.dataset.matchId),
    banner: document.querySelector('#matchStrip .ms-teams')?.textContent.trim() || '',
  }));
  assert(live.mode === 'Live Bracket', 'Live Bracket should be the default mode', live);
  assert(live.progress === 'Live bracket uses confirmed seeds and FT winners only', 'Live mode should not show a picks-made counter', live);
  assert(live.resetVisible === false, 'Live mode should not show Reset Picks', live);
  assert(live.tapHints === 0, 'Live mode should be read-only and hide tap-to-pick hints', live);
  assert(live.confirmedNodes > 0, 'Live bracket should visibly mark confirmed matchups', live);
  assert(live.dateTimeLabels.some(label => /Jun|Jul/.test(label) && /\d:\d{2} (AM|PM)/.test(label)), 'Bracket cards should show date and local time labels', live);
  assert(live.desktopIds.length === 32 && new Set(live.desktopIds).size === 32, 'Desktop map should render every knockout match exactly once', live);
  assert(live.mobilePanels === 5, 'Mobile map should expose four QF paths and a Finals panel', live);
  assert(['M74','M77','M89','M73','M75','M90','M97'].every(id => live.activeMobileIds.includes(id)), 'QF1 mobile path should contain its complete eight-team subtree', live);
  assert(!/Group|TBD|W M|L M/.test(live.banner), 'Next-match banner should use confirmed teams when available', live);
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, 'bracket-desktop.png'), fullPage: false });
  }

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

  await page.click('.bracket-desktop-map [data-match-id="M74"] [data-pick="home"]');
  await page.waitForTimeout(100);
  const clickedPick = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('wc2026bracket') || '{}').ko_M74,
    progress: document.querySelector('.bracket-progress-label')?.textContent.trim(),
  }));
  assert(clickedPick.saved === 'Germany', 'Clicking a compact knockout team should save the explicit data-team value', clickedPick);
  assert(clickedPick.progress === '2/32 knockout picks made', 'A knockout click should update pick progress immediately', clickedPick);

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
    sectionButtons: [...document.querySelectorAll('[data-bracket-section]')].map(button => button.textContent.trim()),
    desktopVisible: getComputedStyle(document.querySelector('.bracket-desktop-shell')).display !== 'none',
    mobileVisible: getComputedStyle(document.querySelector('.bracket-mobile-map')).display !== 'none',
    activePanel: document.querySelector('[data-mobile-panel].active')?.dataset.mobilePanel,
  }));
  assert(mobile.bodyWidth <= mobile.viewport + 2, 'Bracket should not horizontally overflow on mobile', mobile);
  assert(mobile.buttons.every(button => button.width > 90), 'Mode buttons should remain usable on mobile', mobile);
  assert(mobile.sectionButtons.join(',') === 'QF1,QF2,QF3,QF4,Finals', 'Mobile path navigation should expose all five sections', mobile);
  assert(!mobile.desktopVisible && mobile.mobileVisible, 'Mobile should use the sectioned bracket instead of the full desktop canvas', mobile);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-qf1.png'), fullPage: false });

  await page.click('[data-bracket-section="finals"]');
  const finals = await page.evaluate(() => ({
    activePanel: document.querySelector('[data-mobile-panel].active')?.dataset.mobilePanel,
    ids: [...document.querySelectorAll('[data-mobile-panel="finals"] [data-match-id]')].map(node => node.dataset.matchId),
  }));
  assert(finals.activePanel === 'finals', 'Finals tab should activate the championship path', finals);
  assert(['M97','M98','M101','M99','M100','M102','M103','M104'].every(id => finals.ids.includes(id)), 'Finals panel should include QFs, semifinals, bronze, and final', finals);
  const localStaticTarget = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target);
  const actionableBrowserErrors = browserErrors.filter(error =>
    !(localStaticTarget && error.includes('/_vercel/insights/script.js'))
  );
  assert(actionableBrowserErrors.length === 0, 'Bracket preview should not emit browser errors', { browserErrors: actionableBrowserErrors });
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-finals.png'), fullPage: false });

  console.log(JSON.stringify({ target, live, picks, clickedPick, returnedLive, mobile, finals, browserErrors: actionableBrowserErrors }, null, 2));
} finally {
  await browser.close();
}
