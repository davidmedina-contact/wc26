const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const handler = require('../api/data');
const {
  buildData,
  computeStandings,
  expectedFinishedKeys,
  parseScore,
  validFinishedGames,
} = handler._test;

const root = path.join(__dirname, '..');

function game(overrides) {
  return Object.assign({
    finished: 'TRUE',
    type: 'group',
    group: 'A',
    home_team_name_en: 'Mexico',
    away_team_name_en: 'South Africa',
    home_score: '2',
    away_score: '0',
    home_scorers: '',
    away_scorers: '',
  }, overrides);
}

function responseRecorder() {
  return {
    body: null,
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    json(value) { this.body = value; },
  };
}

test('scores must be finite non-negative integers', () => {
  assert.equal(parseScore('0'), 0);
  assert.equal(parseScore('4'), 4);
  assert.equal(parseScore(''), null);
  assert.equal(parseScore(null), null);
  assert.equal(parseScore(undefined), null);
  assert.equal(parseScore('-1'), null);
  assert.equal(parseScore('1.5'), null);
});

test('only complete, recognized finished games become finals', () => {
  const valid = game();
  const games = [
    valid,
    game({ finished: 'FALSE' }),
    game({ home_score: undefined }),
    game({ away_team_name_en: '<script>alert(1)</script>' }),
  ];
  assert.deepEqual(validFinishedGames(games), [valid]);
});

test('standings are derived from the same final games as scores', () => {
  const standings = computeStandings([
    game(),
    game({
      home_team_name_en: 'South Korea',
      away_team_name_en: 'Czech Republic',
      home_score: '1',
      away_score: '1',
    }),
  ]);
  assert.deepEqual(standings.A.map(row => [row.t, row.p, row.pts, row.gd]), [
    ['Mexico', 1, 3, 2],
    ['Czech Republic', 1, 1, 0],
    ['South Korea', 1, 1, 0],
    ['South Africa', 1, 0, -2],
  ]);
});

test('post-match completeness guard detects missing finals', () => {
  const beforeTournament = Date.parse('2026-06-11T18:00:00Z');
  assert.deepEqual(expectedFinishedKeys(beforeTournament), []);

  const afterJune21 = Date.parse('2026-06-22T14:00:00Z');
  const result = buildData([], afterJune21);
  assert.ok(result.missingFinals.includes('Spain_Saudi Arabia'));
  assert.ok(result.missingFinals.includes('Belgium_Iran'));
  assert.ok(result.missingFinals.includes('Uruguay_Cape Verde'));
  assert.ok(result.missingFinals.includes('New Zealand_Egypt'));
});

test('client uses one stable same-origin data endpoint', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /fetch\('\/api\/data'/);
  assert.doesNotMatch(app, /worldcup26\.ir|api\/scores|api\/standings|dataCacheKey/);
});

test('service worker keeps a last-known-good API response', () => {
  const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(worker, /if \(!response\.ok\)/);
  assert.match(worker, /caches\.match\(e\.request\)/);
  assert.match(worker, /wc26-v13/);
});

test('Vercel config stays within legacy and current Hobby limits', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.crons, undefined);
  assert.equal(config.functions['api/data.js'].maxDuration, 30);
  assert.ok(config.functions['api/data.js'].maxDuration <= 60);
});

test('serverless endpoint rejects unsupported methods', async () => {
  const res = responseRecorder();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('serverless endpoint rejects an incomplete live feed', async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  global.fetch = async url => ({
    ok: true,
    text: async () => JSON.stringify(String(url).includes('/groups') ? { groups: [] } : { games: [game()] }),
  });
  Date.now = () => Date.parse('2026-06-22T14:00:00Z');
  try {
    const res = responseRecorder();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.ok(res.body.missingFinals.includes('Spain_Saudi Arabia'));
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
  }
});
