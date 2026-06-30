#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const origin = process.env.PRODUCTION_ORIGIN || 'https://wc26.medina.contact';
const timeoutMs = Number(process.env.DEPLOY_VERIFY_TIMEOUT_MS || 180000);
const pollMs = 5000;
const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const expectedBuild = sw.match(/var BUILD_TS = '([^']+)'/)?.[1];

if (!expectedBuild) throw new Error('Unable to read local service-worker BUILD_TS');

async function getText(pathname) {
  const separator = pathname.includes('?') ? '&' : '?';
  const response = await fetch(`${origin}${pathname}${separator}verify=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const deadline = Date.now() + timeoutMs;
  let observedBuild = '';
  while (Date.now() < deadline) {
    const deployedSw = await getText('/service-worker.js');
    observedBuild = deployedSw.match(/var BUILD_TS = '([^']+)'/)?.[1] || '';
    if (observedBuild === expectedBuild) break;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  if (observedBuild !== expectedBuild) {
    throw new Error(`production BUILD_TS stayed at ${observedBuild || 'unknown'}; expected ${expectedBuild}`);
  }

  const payload = JSON.parse(await getText('/api/data'));
  const data = payload.data || payload;
  const scoreCount = Object.keys(data.actualScores || {}).length;
  const matchesPlayed = data.statsData?.overview?.matchesPlayed || 0;
  if (scoreCount === 0 || matchesPlayed === 0) {
    throw new Error(`production API failed sanity checks: ${scoreCount} scores, ${matchesPlayed} matches`);
  }
  console.log(`Production verified: BUILD_TS ${expectedBuild}, ${scoreCount} scores, ${matchesPlayed} matches`);
}

main().catch(error => {
  console.error('Production verification failed:', error.message);
  process.exit(1);
});
