const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const handler = require('../api/data');
const {
  buildData,
  cachePolicyFor,
  computeStandings,
  expectedFinishedKeys,
  parseScore,
  scorerCompletenessIssues,
  sortGroupStandings,
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
    end() { this.ended = true; },
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
    ['South Korea', 1, 1, 0],
    ['Czech Republic', 1, 1, 0],
    ['South Africa', 1, 0, -2],
  ]);
});

test('standings rows are sorted by FIFA group ranking criteria, not provider order', () => {
  const games = [
    game({
      group: 'L',
      home_team_name_en: 'England',
      away_team_name_en: 'Croatia',
      home_score: '4',
      away_score: '2',
    }),
    game({
      group: 'L',
      home_team_name_en: 'Ghana',
      away_team_name_en: 'Panama',
      home_score: '1',
      away_score: '0',
    }),
  ];
  const providerRows = [
    { t: 'England', p: 1, w: 1, d: 0, l: 0, gf: 4, ga: 2, gd: 2, pts: 3 },
    { t: 'Croatia', p: 1, w: 0, d: 0, l: 1, gf: 2, ga: 4, gd: -2, pts: 0 },
    { t: 'Ghana', p: 1, w: 1, d: 0, l: 0, gf: 1, ga: 0, gd: 1, pts: 3 },
    { t: 'Panama', p: 1, w: 0, d: 0, l: 1, gf: 0, ga: 1, gd: -1, pts: 0 },
  ];

  assert.deepEqual(sortGroupStandings(providerRows, games, 'L').map(row => row.t), [
    'England',
    'Ghana',
    'Panama',
    'Croatia',
  ]);
});

test('standings include conservative clinch and elimination statuses', () => {
  const clinchedTopTwo = buildData([
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Africa', home_score: '2', away_score: '0' }),
    game({ home_team_name_en: 'South Korea', away_team_name_en: 'Czech Republic', home_score: '1', away_score: '1' }),
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Korea', home_score: '1', away_score: '0' }),
    game({ home_team_name_en: 'Czech Republic', away_team_name_en: 'South Africa', home_score: '1', away_score: '0' }),
  ]);
  assert.deepEqual(clinchedTopTwo.data.standingsData.A.find(row => row.t === 'Mexico').status, {
    code: 'qualified',
    label: 'Qualified',
  });

  const openRace = buildData([
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Africa', home_score: '2', away_score: '0' }),
    game({ home_team_name_en: 'South Korea', away_team_name_en: 'Czech Republic', home_score: '1', away_score: '1' }),
  ]);
  assert.equal(openRace.data.standingsData.A.find(row => row.t === 'Mexico').status, null);

  const chasersPlayEachOther = buildData([
    game({ group: 'J', home_team_name_en: 'Argentina', away_team_name_en: 'Algeria', home_score: '3', away_score: '0' }),
    game({ group: 'J', home_team_name_en: 'Austria', away_team_name_en: 'Jordan', home_score: '1', away_score: '0' }),
    game({ group: 'J', home_team_name_en: 'Argentina', away_team_name_en: 'Austria', home_score: '2', away_score: '0' }),
    game({ group: 'J', home_team_name_en: 'Jordan', away_team_name_en: 'Algeria', home_score: '1', away_score: '2' }),
  ]);
  assert.deepEqual(chasersPlayEachOther.data.standingsData.J.find(row => row.t === 'Argentina').status, {
    code: 'qualified',
    label: 'Qualified',
  });

  const wonGroup = buildData([
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Africa', home_score: '2', away_score: '0' }),
    game({ home_team_name_en: 'South Korea', away_team_name_en: 'Czech Republic', home_score: '1', away_score: '1' }),
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Korea', home_score: '1', away_score: '0' }),
    game({ home_team_name_en: 'Czech Republic', away_team_name_en: 'South Africa', home_score: '1', away_score: '1' }),
    game({ home_team_name_en: 'Czech Republic', away_team_name_en: 'Mexico', home_score: '0', away_score: '1' }),
  ]);
  assert.deepEqual(wonGroup.data.standingsData.A.find(row => row.t === 'Mexico').status, {
    code: 'won-group',
    label: 'Group winner',
  });

  const completeGroup = buildData([
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Africa', home_score: '2', away_score: '0' }),
    game({ home_team_name_en: 'South Korea', away_team_name_en: 'Czech Republic', home_score: '1', away_score: '1' }),
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Korea', home_score: '1', away_score: '0' }),
    game({ home_team_name_en: 'Czech Republic', away_team_name_en: 'South Africa', home_score: '1', away_score: '1' }),
    game({ home_team_name_en: 'Czech Republic', away_team_name_en: 'Mexico', home_score: '0', away_score: '1' }),
    game({ home_team_name_en: 'South Africa', away_team_name_en: 'South Korea', home_score: '0', away_score: '2' }),
  ]);
  assert.equal(completeGroup.data.standingsData.A[0].status.code, 'won-group');
  assert.equal(completeGroup.data.standingsData.A[1].status.code, 'qualified');
  assert.equal(completeGroup.data.standingsData.A[3].status.code, 'eliminated');
});

test('scorer aliases preserve every goal event on match cards', () => {
  const result = buildData([
    game({
      group: 'K',
      home_team_name_en: 'Portugal',
      away_team_name_en: 'Uzbekistan',
      home_score: '5',
      away_score: '0',
      home_scorers: "{\"Cristiano Ronaldo 6'\",\"Nvnv Mndz 17'\",\"Cristiano Ronaldo 39'\",\"Abdalvhid Namtvf 60'\",\"Rafael Leão 87'\"}",
      away_scorers: 'null',
    }),
  ]);

  assert.deepEqual(result.data.actualScores.Portugal_Uzbekistan.hs, [
    "Ronaldo 6'",
    "Mendes 17'",
    "Ronaldo 39'",
    "Nematov 60' (OG)",
    "Leão 87'",
  ]);
  assert.equal(result.data.statsData.topScorers.some(row => row.n === 'Abduvohid Nematov'), false);
});

test('reviewed finished matches have complete scorer labels', () => {
  const reviewedGames = [
    game({
      group: 'D',
      home_team_name_en: 'United States',
      away_team_name_en: 'Paraguay',
      home_score: '4',
      away_score: '1',
      home_scorers: "{\"D. Bobadilla 7'(OG)\",\"F. Balogun 31'\",\"F. Balogun 45'+5'\",\"G. Reyna 90'+8'\"}",
      away_scorers: "{\"Maurício 73'\"}",
    }),
    game({
      group: 'F',
      home_team_name_en: 'Netherlands',
      away_team_name_en: 'Japan',
      home_score: '2',
      away_score: '2',
      home_scorers: "{\"Virgil van Dijk 51'\",\"C. Summerville 64'\"}",
      away_scorers: "{\"K. Nakamura 57'\",\"K. Ogawa 89'\"}",
    }),
    game({
      group: 'J',
      home_team_name_en: 'Austria',
      away_team_name_en: 'Jordan',
      home_score: '3',
      away_score: '1',
      home_scorers: "{\"Rvmanv Ashmid 21'\",\"Izn Alarb 76'\"}",
      away_scorers: "{\"Ali Avlvan 50'\"}",
    }),
    game({
      group: 'B',
      home_team_name_en: 'Switzerland',
      away_team_name_en: 'Bosnia and Herzegovina',
      home_score: '4',
      away_score: '1',
      home_scorers: "{\"Jvhan Mnzambi 74'\",\"Rvbn Vargas 84'\",\"Jvhan Mnzambi 90'\"}",
      away_scorers: "{\"Armin Mhmich 90+3'\"}",
    }),
    game({
      group: 'A',
      home_team_name_en: 'Czech Republic',
      away_team_name_en: 'South Africa',
      home_score: '1',
      away_score: '1',
      home_scorers: "{\"‫mikhal Sadilk 6'\"}",
      away_scorers: 'null',
    }),
    game({
      group: 'F',
      home_team_name_en: 'Tunisia',
      away_team_name_en: 'Japan',
      home_score: '0',
      away_score: '4',
      home_scorers: 'null',
      away_scorers: "{\"Daichi Kamada 4'\",\"Aiash Ivida 31'\",\"Junya Itō 69'\",\"Aiash Ivida 83'\"}",
    }),
    game({
      group: 'G',
      home_team_name_en: 'New Zealand',
      away_team_name_en: 'Egypt',
      home_score: '1',
      away_score: '3',
      home_scorers: "{\"Fin Svrman 15'\"}",
      away_scorers: "{\"Mostafa Ziko 58'\",\"Mohamed Salah 67'\",\"Mahmoud Hassan Trezeguet 82'\"}",
    }),
    game({
      group: 'H',
      home_team_name_en: 'Spain',
      away_team_name_en: 'Saudi Arabia',
      home_score: '4',
      away_score: '0',
      home_scorers: "{\"Lamine Yamal 10'\",\"Mikel Oyarzabal 21'\",\"Mikel Oyarzabal 24'\",\"Hassan Mohamed Altmbkti 49'\"}",
      away_scorers: 'null',
    }),
    game({
      group: 'H',
      home_team_name_en: 'Uruguay',
      away_team_name_en: 'Cape Verde',
      home_score: '2',
      away_score: '2',
      home_scorers: "{\"Maximiliano Araújo 44'\",\"Agustín Canobbio 45+6'\"}",
      away_scorers: "{\"Kevin Pina 21'\",\"Hliv Varla 61'\"}",
    }),
    game({
      group: 'I',
      home_team_name_en: 'Norway',
      away_team_name_en: 'Senegal',
      home_score: '3',
      away_score: '2',
      home_scorers: "{\"Markvs Hlmgrn Pdrsn 43'\",\"Erling Haaland 48'\",\"Erling Haaland 58'\"}",
      away_scorers: "{\"Ismaïla Sarr 53'\",\"Ismaïla Sarr 90+3'\"}",
    }),
    game({
      group: 'J',
      home_team_name_en: 'Jordan',
      away_team_name_en: 'Algeria',
      home_score: '1',
      away_score: '2',
      home_scorers: "{\"Al Rashdan 36'\"}",
      away_scorers: "{\"Nzir Bnbvali 69'\",\"Amine Gouiri 82'\"}",
    }),
  ];

  const result = buildData(reviewedGames);
  assert.deepEqual(result.scorerIssues, []);
  assert.deepEqual(scorerCompletenessIssues(reviewedGames, result.data.actualScores), []);
  assert.deepEqual(result.data.actualScores['United States_Paraguay'].hs, [
    "Bobadilla 7' (OG)",
    "Balogun 31'",
    "Balogun 45+5'",
    "Reyna 90+8'",
  ]);
  assert.deepEqual(result.data.actualScores.Austria_Jordan.hs, [
    "Schmid 21'",
    "Arab 76' (OG)",
    "Arnautović 90+11'",
  ]);
  assert.deepEqual(result.data.actualScores['Czech Republic_South Africa'].as, ["Mokoena 84'"]);
  assert.deepEqual(result.data.actualScores.Norway_Senegal.hs, [
    "Pedersen 43'",
    "Haaland 48'",
    "Haaland 58'",
  ]);
  assert.equal(result.data.statsData.topScorers.some(row => row.n === 'Damián Bobadilla'), false);
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

test('bundled snapshot covers every final through June 21', () => {
  const snapshot = require('../data.json');
  const afterJune21 = Date.parse('2026-06-22T14:00:00Z');
  const expected = expectedFinishedKeys(afterJune21);
  assert.equal(expected.length, 40);
  expected.forEach(key => assert.equal(snapshot.actualScores[key]?.status, 'FT', key));
  assert.equal(snapshot.statsData.overview.matchesPlayed, 40);
  assert.equal(snapshot.statsData.overview.goalsScored, 121);
});

test('client uses one stable same-origin data endpoint', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /fetch\('\/api\/data'/);
  assert.match(app, /If-None-Match/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /currentDataVersion/);
  assert.match(app, /cache: 'reload'/);
  assert.match(app, /Cache-Control': 'no-cache'/);
  assert.match(app, /incomingCount < currentCount/);
  assert.doesNotMatch(app, /worldcup26\.ir|api\/scores|api\/standings|dataCacheKey/);
});

test('client renders compact standings status markers with an inline legend', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /function standingsStatusShort/);
  assert.match(app, /return 'W';/);
  assert.match(app, /return 'Q';/);
  assert.match(app, /return 'E';/);
  assert.match(app, /function renderStandingsLegend/);
  assert.match(app, /aria-label="Qualification legend"/);
});

test('service worker keeps a last-known-good API response', () => {
  const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(worker, /if \(!response\.ok\)/);
  assert.match(worker, /caches\.match\(e\.request\)/);
  assert.match(worker, /wc26-v20/);
  assert.match(worker, /BUILD_TS/);
  assert.match(worker, /wantsFresh/);
  assert.match(worker, /dataVersionFromBody/);
  assert.match(worker, /includeUncontrolled: true/);
});

test('Vercel config stays within legacy and current Hobby limits', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.crons, undefined);
  assert.equal(config.functions['api/data.js'].maxDuration, 45);
  assert.ok(config.functions['api/data.js'].maxDuration <= 60);
});

test('serverless cache policy adapts around post-match settlement windows', () => {
  const quiet = cachePolicyFor(Date.parse('2026-06-10T12:00:00Z'));
  assert.equal(quiet.cacheMode, 'quiet');
  assert.match(quiet.cacheControl, /s-maxage=1800/);

  const settlement = cachePolicyFor(Date.parse('2026-06-23T22:30:00Z'));
  assert.equal(settlement.cacheMode, 'settlement');
  assert.match(settlement.cacheControl, /s-maxage=120/);
});

test('serverless endpoint rejects unsupported methods', async () => {
  const res = responseRecorder();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('serverless endpoint emits stable data versions and honors ETag revalidation', async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const gamesPayload = { games: [
    game({
      home_team_id: 'mx',
      away_team_id: 'za',
      home_scorers: "{\"Raúl Jiménez 10'\",\"Teboho Mokoena 80'(OG)\"}",
      away_scorers: 'null',
    }),
  ] };
  const groupsPayload = {
    groups: Object.keys(require('../data.json').groups).map(letter => ({
      name: letter,
      teams: require('../data.json').groups[letter].teams.map(team => ({ team_id: team, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })),
    })),
  };
  global.fetch = async url => ({
    ok: true,
    text: async () => JSON.stringify(String(url).includes('/groups') ? groupsPayload : gamesPayload),
  });
  Date.now = () => Date.parse('2026-06-10T12:00:00Z');
  try {
    const first = responseRecorder();
    await handler({ method: 'GET', headers: {} }, first);
    assert.equal(first.statusCode, 200);
    assert.match(first.headers.ETag, /^"[a-f0-9]{16}"$/);
    assert.equal(first.body.meta.dataVersion, first.headers.ETag.replace(/"/g, ''));

    const second = responseRecorder();
    await handler({ method: 'GET', headers: { 'if-none-match': first.headers.ETag } }, second);
    assert.equal(second.statusCode, 304);
    assert.equal(second.headers.ETag, first.headers.ETag);
    assert.equal(second.ended, true);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
  }
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
