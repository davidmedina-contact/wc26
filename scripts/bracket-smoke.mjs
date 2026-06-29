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
    cityLabels: [...document.querySelectorAll('.bracket-desktop-map .bracket-node-city')]
      .map(node => node.textContent.trim()).slice(0, 4),
    desktopIds: [...document.querySelectorAll('.bracket-desktop-map [data-match-id]')].map(node => node.dataset.matchId),
    mobileStageTabs: document.querySelectorAll('[data-bracket-section]').length,
    mobileIds: [...document.querySelectorAll('.bracket-mobile-visual [data-match-id]')].map(node => node.dataset.matchId),
    banner: document.querySelector('#matchStrip .ms-teams')?.textContent.trim() || '',
  }));
  assert(live.mode === 'Live Bracket', 'Live Bracket should be the default mode', live);
  assert(!live.progress, 'Live mode should not spend vertical space on a redundant status line', live);
  assert(live.resetVisible === false, 'Live mode should not show Reset Picks', live);
  assert(live.tapHints === 0, 'Live mode should be read-only and hide tap-to-pick hints', live);
  assert(live.confirmedNodes > 0, 'Live bracket should visibly mark confirmed matchups', live);
  assert(live.dateTimeLabels.some(label => /Jun|Jul/.test(label) && /\d:\d{2} (AM|PM)/.test(label)), 'Bracket cards should show date and local time labels', live);
  assert(live.cityLabels.includes('Boston'), 'Bracket cards should show canonical host cities', live);
  assert(live.desktopIds.length === 32 && new Set(live.desktopIds).size === 32, 'Desktop map should render every knockout match exactly once', live);
  assert(live.mobileStageTabs === 5, 'Mobile map should expose each knockout stage', live);
  assert(live.mobileIds.length === 24 && new Set(live.mobileIds).size === 24, 'R32 mobile window should show 16 source and 8 target matches', live);
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
      ko_M74: 'Germany',
    }));
    localStorage.setItem('wc2026bracketOriginal', JSON.stringify({
      g_H_3: 'Uruguay',
      ko_M74: 'Portugal',
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
    originalMarker: (() => {
      const marker = document.querySelector('.bracket-desktop-map [data-match-id="M74"] .bracket-original');
      return marker ? { text: marker.textContent.trim(), label: marker.getAttribute('aria-label'), width: marker.getBoundingClientRect().width } : null;
    })(),
  }));
  assert(picks.mode === 'My Picks', 'Saved picks mode should restore My Picks', picks);
  assert(/knockout picks made$/.test(picks.progress), 'My Picks should show knockout-pick progress', picks);
  assert(picks.resetVisible === true, 'My Picks should show Reset Picks', picks);
  assert(picks.tapHints > 0, 'My Picks should keep tap-to-pick affordances', picks);
  assert(count(picksR32, 'Uruguay') <= 1, 'A stale third-place Uruguay pick must not be reused across R32 slots', { picksR32 });
  assert(/3rd (pick|auto|confirmed)/.test(picks.groupText), 'Group cards should expose third-place state labels', picks);
  assert(Number.parseInt(picks.progress, 10) >= 2, 'Legacy R16 picks should migrate alongside current official-ID picks and live winners', picks);
  assert(picks.originalMarker?.text === 'POR' && picks.originalMarker.label === 'Original pick: Portugal', 'Original picks should use a compact code with a full accessible label', picks);
  assert(picks.originalMarker.width <= 42, 'Original-pick marker should stay within the compact match header', picks);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOriginalMarker = await page.evaluate(() => {
    const marker = document.querySelector('.bracket-mobile-visual [data-match-id="M74"] .bracket-original');
    const header = marker?.closest('.bracket-node-meta');
    return marker && header ? { width: marker.getBoundingClientRect().width, headerWidth: header.getBoundingClientRect().width } : null;
  });
  assert(mobileOriginalMarker && mobileOriginalMarker.width <= 42 && mobileOriginalMarker.width < mobileOriginalMarker.headerWidth, 'Original-pick marker should remain contained on mobile', mobileOriginalMarker || {});
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-picks.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.click('.bracket-desktop-map [data-match-id="M74"] [data-pick="away"]');
  await page.waitForTimeout(100);
  const clickedPick = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('wc2026bracket') || '{}').ko_M74,
    progress: document.querySelector('.bracket-progress-label')?.textContent.trim(),
  }));
  assert(clickedPick.saved === 'Paraguay', 'Clicking a compact knockout team should replace the saved data-team value', clickedPick);
  assert(clickedPick.progress === picks.progress, 'Replacing a knockout pick should keep the progress count accurate', { before: picks.progress, after: clickedPick.progress });

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
  assert(!returnedLive.progress, 'Switching to Live should hide prediction progress', returnedLive);
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
    citySample: document.querySelector('.bracket-mobile-visual .bracket-node-city')?.textContent.trim(),
    teamCodeSample: (() => {
      const row = document.querySelector('.bracket-mobile-visual [data-match-id="M74"] [data-team="Germany"]');
      const code = row?.querySelector('.bt-label-code');
      return row && code ? {
        code: code.textContent.trim(),
        label: row.getAttribute('aria-label'),
        visible: getComputedStyle(code).display !== 'none',
      } : null;
    })(),
    buttons: [...document.querySelectorAll('[data-bracket-mode]')].map(button => ({
      text: button.textContent.trim(),
      width: Math.round(button.getBoundingClientRect().width),
    })),
    sectionButtons: [...document.querySelectorAll('[data-bracket-section]')].map(button => button.textContent.trim()),
    desktopVisible: getComputedStyle(document.querySelector('.bracket-desktop-shell')).display !== 'none',
    mobileVisible: getComputedStyle(document.querySelector('.bracket-mobile-map')).display !== 'none',
    activeSection: document.querySelector('[data-bracket-section].active')?.dataset.bracketSection,
    infoExpanded: document.querySelector('[data-bracket-info-toggle]')?.getAttribute('aria-expanded'),
    infoHeight: Math.round(document.querySelector('.bracket-info')?.getBoundingClientRect().height || 0),
    seedsExpanded: document.querySelector('[data-bracket-seeds-toggle]')?.getAttribute('aria-expanded'),
    scroller: (() => {
      const node = document.querySelector('[data-mobile-bracket-scroll]');
      return node ? {
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollLeft: node.scrollLeft,
        scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop,
      } : null;
    })(),
  }));
  assert(mobile.bodyWidth <= mobile.viewport + 2, 'Bracket should not horizontally overflow on mobile', mobile);
  assert(mobile.citySample === 'Boston', 'Mobile R32 cards should retain canonical host-city labels', mobile);
  assert(mobile.teamCodeSample?.code === 'GER' && mobile.teamCodeSample.label === 'Germany' && mobile.teamCodeSample.visible, 'Known mobile teams should use consistent three-letter codes with full accessible labels', mobile);
  assert(mobile.buttons.every(button => button.width > 90), 'Mode buttons should remain usable on mobile', mobile);
  assert(mobile.sectionButtons.join(',') === 'R32,R16,QF,SF,Final', 'Mobile navigation should use standard tournament round names', mobile);
  assert(mobile.activeSection === 'r32', 'Mobile bracket should begin at the Round of 32', mobile);
  assert(mobile.infoExpanded === 'false' && mobile.infoHeight < 70, 'Mobile bracket details should start compact', mobile);
  assert(mobile.seedsExpanded === 'false', 'Group Seeds should start collapsed', mobile);
  assert(mobile.scroller && mobile.scroller.scrollWidth <= mobile.scroller.clientWidth + 2, 'Mobile bracket should not scroll horizontally', mobile);
  assert(mobile.scroller && mobile.scroller.scrollHeight > mobile.scroller.clientHeight, 'Tall mobile bracket should scroll inside its own viewport', mobile);
  assert(!mobile.desktopVisible && mobile.mobileVisible, 'Mobile should use the connected compact bracket instead of the desktop canvas', mobile);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-r32.png'), fullPage: false });

  await page.click('[data-bracket-section="qf"]');
  await page.waitForTimeout(100);
  const qf = await page.evaluate(() => {
    const node = document.querySelector('[data-mobile-bracket-scroll]');
    return {
      ids: [...document.querySelectorAll('.bracket-mobile-visual [data-match-id]')].map(match => match.dataset.matchId).sort(),
      clientHeight: node?.clientHeight,
      scrollHeight: node?.scrollHeight,
    };
  });
  assert(qf.ids.join(',') === 'M100,M101,M102,M97,M98,M99', 'QF window should show four quarterfinals feeding two semifinals', qf);
  assert(qf.clientHeight === qf.scrollHeight && qf.clientHeight < 450, 'QF window should collapse to show every path without scrolling', qf);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-qf.png'), fullPage: false });

  await page.click('[data-bracket-section="sf"]');
  await page.waitForTimeout(100);
  const sf = await page.evaluate(() => {
    const node = document.querySelector('[data-mobile-bracket-scroll]');
    return {
      ids: [...document.querySelectorAll('.bracket-mobile-visual [data-match-id]')].map(match => match.dataset.matchId).sort(),
      clientHeight: node?.clientHeight,
      scrollHeight: node?.scrollHeight,
    };
  });
  assert(sf.ids.join(',') === 'M101,M102,M103,M104', 'SF window should show both semifinals, the final, and third place', sf);
  assert(sf.clientHeight === sf.scrollHeight && sf.clientHeight < 360, 'SF window should collapse to its four match cards', sf);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-sf.png'), fullPage: false });

  await page.click('[data-bracket-section="final"]');
  await page.waitForTimeout(100);
  const finals = await page.evaluate(() => ({
    activeSection: document.querySelector('[data-bracket-section].active')?.dataset.bracketSection,
    ids: [...document.querySelectorAll('.bracket-mobile-visual [data-match-id]')]
      .filter(node => node.dataset.matchId === 'M103' || node.dataset.matchId === 'M104')
      .map(node => node.dataset.matchId).sort(),
    champion: Boolean(document.querySelector('.bracket-mobile-champion-card')),
    scroller: (() => {
      const node = document.querySelector('[data-mobile-bracket-scroll]');
      return node ? {
        clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
      } : null;
    })(),
  }));
  assert(finals.activeSection === 'final', 'Final tab should select the championship stage', finals);
  assert(finals.ids.join(',') === 'M103,M104', 'Connected mobile bracket should contain the final and third-place match', finals);
  assert(finals.champion, 'Final stage should include the champion destination', finals);
  assert(finals.scroller && finals.scroller.clientHeight === finals.scroller.scrollHeight && finals.scroller.clientHeight < 280, 'Final stage should collapse to the final, champion, and third-place cards', finals);
  const localStaticTarget = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target);
  const actionableBrowserErrors = browserErrors.filter(error =>
    !(localStaticTarget && error.includes('/_vercel/insights/script.js'))
  );
  assert(actionableBrowserErrors.length === 0, 'Bracket preview should not emit browser errors', { browserErrors: actionableBrowserErrors });
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-final.png'), fullPage: false });

  console.log(JSON.stringify({ target, live, picks, clickedPick, returnedLive, mobile, qf, sf, finals, browserErrors: actionableBrowserErrors }, null, 2));
} finally {
  await browser.close();
}
