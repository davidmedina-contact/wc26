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
      ko_M83: 'Croatia',
    }));
    localStorage.setItem('wc2026bracketOriginal', JSON.stringify({
      g_H_3: 'Uruguay',
      ko_M83: 'Portugal',
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
    groupText: document.querySelector('#bracketGrid')?.textContent || '',
    originalMarker: (() => {
      const marker = document.querySelector('.bracket-desktop-map [data-match-id="M83"] .bracket-original');
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
    const marker = document.querySelector('.bracket-mobile-visual [data-match-id="M83"] .bracket-original');
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
    connectorGaps: [...document.querySelectorAll('.bracket-mobile-path')].map(path => {
      const junction = path.querySelector('.bracket-mobile-path-junction')?.getBoundingClientRect();
      const target = path.querySelector('.bracket-mobile-target .bracket-node')?.getBoundingClientRect();
      const center = junction ? junction.left + junction.width / 2 : 0;
      return {
        sources: [...path.querySelectorAll('.bracket-mobile-source .bracket-node')]
          .map(node => Math.round((center - node.getBoundingClientRect().right) * 10) / 10),
        target: target ? Math.round((target.left - center) * 10) / 10 : null,
      };
    }),
    connectorAlignment: [...document.querySelectorAll('.bracket-mobile-path')].map(path => {
      const junction = path.querySelector('.bracket-mobile-path-junction')?.getBoundingClientRect();
      const sources = [...path.querySelectorAll('.bracket-mobile-source .bracket-node')];
      const target = path.querySelector('.bracket-mobile-target .bracket-node')?.getBoundingClientRect();
      if (!junction || sources.length !== 2 || !target) return null;
      const relativeCenter = rect => rect.top + rect.height / 2 - junction.top;
      return {
        sources: sources.map(node => relativeCenter(node.getBoundingClientRect())),
        expectedSources: [junction.height * 0.24, junction.height * 0.76],
        target: relativeCenter(target),
        expectedTarget: junction.height * 0.5,
      };
    }),
    cardHeights: [...document.querySelectorAll('.bracket-mobile-visual .bracket-node')]
      .map(node => node.getBoundingClientRect().height),
    utilityParent: document.querySelector('#themeBtn')?.parentElement?.className || '',
    searchParent: document.querySelector('#searchToggle')?.parentElement?.className || '',
    matchStripHeight: document.querySelector('#matchStrip')?.getBoundingClientRect().height || 0,
    matchStripGap: (() => {
      const strip = document.querySelector('#matchStrip')?.getBoundingClientRect();
      const info = document.querySelector('.bracket-info')?.getBoundingClientRect();
      return strip && info ? info.top - strip.bottom : null;
    })(),
    topBarHeight: document.querySelector('.top-bar')?.getBoundingClientRect().height || 0,
    seedsContentParent: document.querySelector('#bracketSeedsContent')?.parentElement?.className || '',
    controlsHidden: document.querySelector('#bracketControlsContent')?.hasAttribute('hidden'),
    standaloneSeeds: document.querySelectorAll('#tab-bracket > .bracket-seeds').length,
    roundPickerHeight: document.querySelector('.bracket-section-tabs')?.getBoundingClientRect().height || 0,
    infoExpanded: document.querySelector('[data-bracket-info-toggle]')?.getAttribute('aria-expanded'),
    infoToggleTag: document.querySelector('[data-bracket-info-toggle]')?.tagName,
    infoToggleText: document.querySelector('[data-bracket-info-toggle]')?.textContent.trim(),
    infoHeight: Math.round(document.querySelector('.bracket-info')?.getBoundingClientRect().height || 0),
    scroller: (() => {
      const node = document.querySelector('[data-mobile-bracket-scroll]');
      return node ? {
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollLeft: node.scrollLeft,
        scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop,
        overflowY: getComputedStyle(node).overflowY,
      } : null;
    })(),
    pageScroll: {
      scrollHeight: document.scrollingElement?.scrollHeight || 0,
      clientHeight: document.scrollingElement?.clientHeight || 0,
    },
  }));
  assert(mobile.bodyWidth <= mobile.viewport + 2, 'Bracket should not horizontally overflow on mobile', mobile);
  assert(mobile.citySample === 'Boston', 'Mobile R32 cards should retain canonical host-city labels', mobile);
  assert(mobile.teamCodeSample?.code === 'GER' && mobile.teamCodeSample.label === 'Germany' && mobile.teamCodeSample.visible, 'Known mobile teams should use consistent three-letter codes with full accessible labels', mobile);
  assert(mobile.buttons.every(button => button.width > 90), 'Mode buttons should remain usable on mobile', mobile);
  assert(mobile.sectionButtons.join(',') === 'R32,R16,QF,SF,Final', 'Mobile navigation should use standard tournament round names', mobile);
  assert(mobile.activeSection === 'r32', 'Mobile bracket should begin at the Round of 32', mobile);
  assert(mobile.connectorGaps.length === 8 && mobile.connectorGaps.every(gap => gap.target === 9 && gap.sources.length === 2 && gap.sources.every(value => value === 9)), 'Every mobile source and target card should meet its 9px connector arm', mobile);
  assert(mobile.connectorAlignment.length === 8 && mobile.connectorAlignment.every(alignment => alignment &&
    alignment.sources.every((value, index) => Math.abs(value - alignment.expectedSources[index]) < 0.2) &&
    Math.abs(alignment.target - alignment.expectedTarget) < 0.2), 'Continuous connector corners should align with every card center', mobile);
  assert(mobile.cardHeights.length === 24 && mobile.cardHeights.every(height => height >= 70 && height <= 73), 'Mobile cards should use the compact readable height contract', mobile);
  assert(mobile.utilityParent === 'nav-utilities' && mobile.searchParent === 'nav-utilities' && mobile.topBarHeight < 2, 'Search and Appearance should share zero-height mobile nav utilities', mobile);
  assert(mobile.matchStripHeight <= 31 && mobile.matchStripGap !== null && mobile.matchStripGap <= 9, 'Compact match ticker should hand off tightly to bracket content', mobile);
  assert(mobile.seedsContentParent === 'bracket-seeds-embedded' && mobile.controlsHidden && mobile.standaloneSeeds === 0, 'Group Seeds should live only inside the collapsed bracket controls panel', mobile);
  assert(mobile.roundPickerHeight <= 36, 'Mobile round picker should use compact secondary-tab chrome', mobile);
  assert(mobile.infoExpanded === 'false' && mobile.infoHeight < 70, 'Mobile bracket details should start compact', mobile);
  assert(mobile.infoToggleTag === 'BUTTON' && /Bracket/.test(mobile.infoToggleText), 'Bracket title and chevron should share one semantic disclosure button', mobile);
  assert(mobile.scroller && mobile.scroller.scrollWidth <= mobile.scroller.clientWidth + 2, 'Mobile bracket should not scroll horizontally', mobile);
  assert(mobile.scroller && mobile.scroller.scrollHeight === mobile.scroller.clientHeight && mobile.scroller.overflowY === 'visible', 'Mobile bracket must not create a second vertical scroll container', mobile);
  assert(mobile.pageScroll.scrollHeight > mobile.pageScroll.clientHeight, 'The document should own scrolling for a tall mobile bracket', mobile);
  assert(!mobile.desktopVisible && mobile.mobileVisible, 'Mobile should use the connected compact bracket instead of the desktop canvas', mobile);
  await page.click('.bracket-title-wide');
  assert(await page.getAttribute('[data-bracket-info-toggle]', 'aria-expanded') === 'true', 'Clicking bracket title text should expand its panel');
  const combinedPanel = await page.evaluate(() => {
    const panel = document.querySelector('.bracket-info');
    const content = document.querySelector('#bracketControlsContent');
    const seeds = document.querySelector('#bracketSeedsContent');
    return {
      controlsVisible: content && !content.hasAttribute('hidden'),
      seedsInsidePanel: Boolean(panel && seeds && panel.contains(seeds)),
      groupCount: seeds?.querySelectorAll('.bracket-match').length || 0,
      standaloneSeeds: document.querySelectorAll('#tab-bracket > .bracket-seeds').length,
    };
  });
  assert(combinedPanel.controlsVisible && combinedPanel.seedsInsidePanel && combinedPanel.groupCount === 12 && combinedPanel.standaloneSeeds === 0, 'One disclosure should reveal description and all 12 Group Seeds inside the bracket panel', combinedPanel);
  await page.click('.bracket-title-wide');
  assert(await page.getAttribute('[data-bracket-info-toggle]', 'aria-expanded') === 'false', 'Clicking bracket title text again should collapse its panel');
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-r32.png'), fullPage: false });

  await page.setViewportSize({ width: 320, height: 700 });
  const narrowMobile = await page.evaluate(() => {
    const theme = document.querySelector('#themeBtn')?.getBoundingClientRect();
    const heading = document.querySelector('.bracket-info-heading')?.getBoundingClientRect();
    const narrowTitle = document.querySelector('.bracket-title-narrow');
    const cards = [...document.querySelectorAll('.bracket-mobile-visual .bracket-node')];
    return {
      bodyWidth: document.body.scrollWidth,
      viewport: window.innerWidth,
      theme: theme ? { width: theme.width, height: theme.height } : null,
      headingOverflow: heading ? document.querySelector('.bracket-info-heading').scrollWidth - heading.width > 1 : true,
      headingWidth: heading?.width || 0,
      headingScrollWidth: document.querySelector('.bracket-info-heading')?.scrollWidth || 0,
      narrowTitleVisible: narrowTitle ? getComputedStyle(narrowTitle).display !== 'none' : false,
      cardWidths: cards.map(card => card.getBoundingClientRect().width),
      footerOverflow: [...document.querySelectorAll('.bracket-mobile-visual .bracket-node-footer')]
        .some(footer => footer.scrollWidth > footer.clientWidth),
    };
  });
  assert(narrowMobile.bodyWidth <= narrowMobile.viewport + 2, 'Narrow mobile bracket should not overflow the page', narrowMobile);
  assert(narrowMobile.theme?.width >= 44 && narrowMobile.theme?.height >= 44, 'Navigation appearance control should retain a mobile touch target', narrowMobile);
  assert(narrowMobile.narrowTitleVisible && !narrowMobile.headingOverflow, 'Narrow mobile header should use its compact readable title', narrowMobile);
  assert(narrowMobile.cardWidths.every(width => width >= 128) && !narrowMobile.footerOverflow, 'Narrow mobile cards should retain readable content without footer overflow', narrowMobile);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-320.png'), fullPage: false });
  await page.click('#searchToggle');
  const searchUtility = await page.evaluate(() => {
    const button = document.querySelector('#searchToggle')?.getBoundingClientRect();
    return {
      open: document.querySelector('#searchBox')?.classList.contains('open'),
      focused: document.activeElement?.id,
      button: button ? { width: button.width, height: button.height } : null,
    };
  });
  assert(searchUtility.open && searchUtility.focused === 'searchInput' && searchUtility.button?.width >= 44 && searchUtility.button?.height >= 44, 'Bottom-nav Search should open and focus the existing search field', searchUtility);
  await page.click('#searchToggle');
  const startingTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme-pref'));
  const themeCycle = [];
  for (let i = 0; i < 3; i++) {
    await page.click('#themeBtn');
    themeCycle.push(await page.evaluate(() => ({
      preference: document.documentElement.getAttribute('data-theme-pref'),
      stored: localStorage.getItem('wc2026-theme'),
      label: document.querySelector('#themeBtn')?.getAttribute('aria-label'),
    })));
  }
  assert(new Set(themeCycle.map(state => state.preference)).size === 3 &&
    themeCycle.every(state => state.preference === state.stored && state.label?.includes('Switch to')) &&
    themeCycle[2].preference === startingTheme, 'Appearance control should cycle, persist, and describe all three modes', { startingTheme, themeCycle });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click('[data-bracket-section="qf"]');
  await page.waitForTimeout(100);
  const qf = await page.evaluate(() => {
    const node = document.querySelector('[data-mobile-bracket-scroll]');
    return {
      ids: [...document.querySelectorAll('.bracket-mobile-visual [data-match-id]')].map(match => match.dataset.matchId).sort(),
      clientHeight: node?.clientHeight,
      scrollHeight: node?.scrollHeight,
      pathHeights: [...document.querySelectorAll('.bracket-mobile-path')].map(path => Math.round(path.getBoundingClientRect().height)),
      junctionHeights: [...document.querySelectorAll('.bracket-mobile-path-junction')].map(path => Math.round(path.getBoundingClientRect().height)),
    };
  });
  assert(qf.ids.join(',') === 'M100,M101,M102,M97,M98,M99', 'QF window should show four quarterfinals feeding two semifinals', qf);
  assert(qf.clientHeight === qf.scrollHeight && qf.clientHeight >= 350, 'QF window should fill available viewport space without its own scroll', qf);
  assert(qf.pathHeights.length === 2 && qf.pathHeights.every(height => height > 250), 'QF paths should expand to share the available bracket height', qf);
  assert(qf.junctionHeights.every(height => height === 150), 'Expanded path spacing must not stretch connector geometry away from card centers', qf);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-qf.png'), fullPage: false });

  await page.click('[data-bracket-section="sf"]');
  await page.waitForTimeout(100);
  const sf = await page.evaluate(() => {
    const node = document.querySelector('[data-mobile-bracket-scroll]');
    return {
      ids: [...document.querySelectorAll('.bracket-mobile-visual [data-match-id]')].map(match => match.dataset.matchId).sort(),
      clientHeight: node?.clientHeight,
      scrollHeight: node?.scrollHeight,
      pathHeights: [...document.querySelectorAll('.bracket-mobile-path')].map(path => Math.round(path.getBoundingClientRect().height)),
    };
  });
  assert(sf.ids.join(',') === 'M101,M102,M103,M104', 'SF window should show both semifinals, the final, and third place', sf);
  assert(sf.clientHeight === sf.scrollHeight && sf.clientHeight >= 290, 'SF window should fill available viewport space without its own scroll', sf);
  assert(sf.pathHeights.length === 1 && sf.pathHeights[0] > 400, 'The semifinal path should expand while the third-place card remains available', sf);
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
  assert(finals.scroller && finals.scroller.clientHeight === finals.scroller.scrollHeight, 'Final stage should use the page as its only vertical scroll container', finals);

  await page.goto(target.split('#')[0], { waitUntil: 'networkidle' });
  await page.waitForSelector('#tab-matches.active .match-card', { timeout: 15000 });
  const cleanLaunch = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#tab-matches .match-card')];
    const firstCard = cards[0];
    const firstTeam = firstCard?.querySelector('.mc-team');
    const cardStyle = firstCard ? getComputedStyle(firstCard) : null;
    const teamStyle = firstTeam ? getComputedStyle(firstTeam) : null;
    return {
      activeTab: document.body.getAttribute('data-active-tab'),
      hash: window.location.hash,
      navOrder: [...document.querySelectorAll('.nav-tab .tab-label')].map(label => label.textContent.trim()),
      activeNav: document.querySelector('.nav-tab.active')?.getAttribute('data-tab'),
      cardCount: cards.length,
      cardHeights: cards.slice(0, 4).map(card => Math.round(card.getBoundingClientRect().height)),
      cardPadding: cardStyle ? [cardStyle.paddingTop, cardStyle.paddingRight] : [],
      teamPadding: teamStyle ? [teamStyle.paddingTop, teamStyle.paddingRight] : [],
      cardOverflow: cards.some(card => card.scrollWidth > card.clientWidth + 1),
    };
  });
  assert(cleanLaunch.activeTab === 'matches' && cleanLaunch.activeNav === 'matches', 'A clean launch should activate Matches in both content and navigation', cleanLaunch);
  assert(/^#matches\/\d{4}-\d{2}-\d{2}$/.test(cleanLaunch.hash), 'A clean launch should canonicalize to a date-specific Matches hash', cleanLaunch);
  assert(cleanLaunch.navOrder.join(',') === 'Matches,Bracket,Groups,Stats', 'Primary navigation should use the requested task order', cleanLaunch);
  assert(cleanLaunch.cardCount > 0 && !cleanLaunch.cardOverflow, 'Compact match cards should render without horizontal overflow', cleanLaunch);
  assert(cleanLaunch.cardPadding.join(',') === '11px,14px' && cleanLaunch.teamPadding.join(',') === '8px,7px', 'Mobile match cards should use the moderate compact-spacing contract', cleanLaunch);
  const localStaticTarget = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target);
  const actionableBrowserErrors = browserErrors.filter(error =>
    !(localStaticTarget && error.includes('/_vercel/insights/script.js'))
  );
  assert(actionableBrowserErrors.length === 0, 'Bracket preview should not emit browser errors', { browserErrors: actionableBrowserErrors });
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'bracket-mobile-final.png'), fullPage: false });

  console.log(JSON.stringify({ target, live, picks, clickedPick, returnedLive, mobile, qf, sf, finals, cleanLaunch, browserErrors: actionableBrowserErrors }, null, 2));
} finally {
  await browser.close();
}
