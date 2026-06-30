const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const handler = require('../api/data');
const {
  buildData,
  buildScores,
  buildScorerVerification,
  cachePolicyFor,
  computeStandings,
  dataVersionFor,
  expectedFinishedKeys,
  parseScore,
  scorerCompletenessIssues,
  sourceEventsToTokens,
  sortGroupStandings,
  thirdPlaceDataForStandings,
  validFinishedGames,
} = handler._test;

const root = path.join(__dirname, '..');
const knockoutBracket = require('../knockout-bracket');

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

function standingRow(t, pts, gd, gf) {
  return {
    t,
    p: 3,
    w: Math.floor(pts / 3),
    d: pts % 3,
    l: 0,
    gf: gf === undefined ? Math.max(gd, 0) : gf,
    ga: gf === undefined ? Math.max(-gd, 0) : gf - gd,
    gd,
    pts,
  };
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

test('knockout scores preserve the winner when penalties decide a tie', () => {
  const scores = buildScores([
    game({
      type: 'r32',
      home_team_name_en: 'Mexico',
      away_team_name_en: 'South Africa',
      home_score: '1',
      away_score: '1',
      home_penalties: '4',
      away_penalties: '3',
    }),
  ]);
  assert.equal(scores['Mexico_South Africa'].winner, 'Mexico');
  assert.equal(scores['Mexico_South Africa'].hp, 4);
  assert.equal(scores['Mexico_South Africa'].ap, 3);
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
    code: 'won-group',
    label: 'Group winner',
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

  const currentMexicoGroup = buildData([
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Africa', home_score: '2', away_score: '0' }),
    game({ home_team_name_en: 'South Korea', away_team_name_en: 'Czech Republic', home_score: '2', away_score: '1' }),
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Korea', home_score: '1', away_score: '0' }),
    game({ home_team_name_en: 'Czech Republic', away_team_name_en: 'South Africa', home_score: '1', away_score: '1' }),
  ]);
  assert.deepEqual(currentMexicoGroup.data.standingsData.A.find(row => row.t === 'Mexico').status, {
    code: 'won-group',
    label: 'Group winner',
  });

  const currentUsGroup = buildData([
    game({ group: 'D', home_team_name_en: 'United States', away_team_name_en: 'Paraguay', home_score: '4', away_score: '1' }),
    game({ group: 'D', home_team_name_en: 'Australia', away_team_name_en: 'Türkiye', home_score: '2', away_score: '0' }),
    game({ group: 'D', home_team_name_en: 'United States', away_team_name_en: 'Australia', home_score: '2', away_score: '0' }),
    game({ group: 'D', home_team_name_en: 'Türkiye', away_team_name_en: 'Paraguay', home_score: '0', away_score: '1' }),
  ]);
  assert.deepEqual(currentUsGroup.data.standingsData.D.find(row => row.t === 'United States').status, {
    code: 'won-group',
    label: 'Group winner',
  });
  assert.deepEqual(currentUsGroup.data.standingsData.D.find(row => row.t === 'Türkiye').status, {
    code: 'eliminated',
    label: 'Eliminated',
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

test('third-place table is ranked server-side from standings data', () => {
  const result = buildData([
    game({ home_team_name_en: 'Mexico', away_team_name_en: 'South Africa', home_score: '2', away_score: '0' }),
    game({ home_team_name_en: 'South Korea', away_team_name_en: 'Czech Republic', home_score: '2', away_score: '1' }),
    game({ group: 'D', home_team_name_en: 'United States', away_team_name_en: 'Paraguay', home_score: '4', away_score: '1' }),
    game({ group: 'D', home_team_name_en: 'Australia', away_team_name_en: 'Türkiye', home_score: '2', away_score: '0' }),
  ]);

  assert.equal(result.data.thirdPlaceData.length, 12);
  assert.deepEqual(result.data.thirdPlaceData.map(row => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(result.data.thirdPlaceData.every(row => row.group && row.t && row.status && typeof row.tieBreakPending === 'boolean'));
  assert.equal(result.data.thirdPlaceData.filter(row => row.status.code === 'in-position').length, 8);
  assert.equal(result.data.thirdPlaceData[8].status.code, 'below-cut');
});

test('third-place paths use the Annex C round-of-32 combination table', () => {
  const standings = {
    A: [standingRow('Mexico', 9, 6), standingRow('South Africa', 4, -1), standingRow('South Korea', 3, -1)],
    B: [standingRow('Switzerland', 7, 4), standingRow('Canada', 4, 5), standingRow('Bosnia and Herzegovina', 4, -1, 5)],
    C: [standingRow('Brazil', 7, 6), standingRow('Morocco', 7, 3), standingRow('Scotland', 3, -3)],
    D: [standingRow('United States', 6, 5), standingRow('Australia', 3, 0), standingRow('Paraguay', 3, -2)],
    E: [standingRow('Germany', 6, 6), standingRow('Ivory Coast', 6, 2), standingRow('Ecuador', 4, 0)],
    F: [standingRow('Netherlands', 4, 4), standingRow('Japan', 4, 4), standingRow('Sweden', 3, 0, 6)],
    G: [standingRow('Egypt', 4, 2), standingRow('Iran', 2, 0), standingRow('Belgium', 2, 0)],
    H: [standingRow('Spain', 4, 4), standingRow('Uruguay', 2, 0), standingRow('Cape Verde', 2, 0, 2)],
    I: [standingRow('France', 6, 5), standingRow('Norway', 6, 4), standingRow('Senegal', 0, -3, 3)],
    J: [standingRow('Argentina', 6, 5), standingRow('Austria', 3, 0), standingRow('Algeria', 3, -2, 2)],
    K: [standingRow('Colombia', 6, 3), standingRow('Portugal', 4, 5), standingRow('DR Congo', 1, -1)],
    L: [standingRow('England', 4, 2), standingRow('Ghana', 4, 1), standingRow('Croatia', 3, -1, 3)],
  };

  const paths = Object.fromEntries(thirdPlaceDataForStandings(standings)
    .filter(row => row.path)
    .map(row => [row.group, row.path]));

  assert.equal(paths.E.combinationNo, 482);
  assert.deepEqual(Object.fromEntries(Object.entries(paths).map(([group, path]) => [group, path.opponentSlot])), {
    E: '1L',
    B: '1D',
    F: '1I',
    L: '1K',
    A: '1G',
    J: '1B',
    D: '1E',
    C: '1A',
  });
  assert.equal(paths.E.opponentTeam, 'England');
  assert.equal(paths.B.opponentTeam, 'United States');

  const data = { actualScores: {}, standingsData: {}, thirdPlaceData: [{ group: 'E', path: { opponentSlot: '1L', match: 'M80' } }], statsData: {} };
  const first = dataVersionFor(data, { scorerCompleteness: 'verified', scorerIssueCount: 0, finishedMatches: 1, standingsSource: 'test' });
  data.thirdPlaceData[0].path.match = 'M81';
  const second = dataVersionFor(data, { scorerCompleteness: 'verified', scorerIssueCount: 0, finishedMatches: 1, standingsSource: 'test' });
  assert.notEqual(first, second);
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
    game({
      group: 'B',
      home_team_name_en: 'Switzerland',
      away_team_name_en: 'Canada',
      home_score: '2',
      away_score: '1',
      home_scorers: "{\"Rubén Vargas 46'\",\"Jvhan Mnzambi 57'\"}",
      away_scorers: "{\"Prvmis Divid 76'\"}",
    }),
    game({
      group: 'B',
      home_team_name_en: 'Bosnia and Herzegovina',
      away_team_name_en: 'Qatar',
      home_score: '3',
      away_score: '1',
      home_scorers: "{\"Karim Alaibgvvich 29'\",\"Abvnad 34'\",\"Armin Mhmich 80'\"}",
      away_scorers: "{\"Hassan Al-Haydos 42'\"}",
    }),
    game({
      group: 'C',
      home_team_name_en: 'Morocco',
      away_team_name_en: 'Haiti',
      home_score: '4',
      away_score: '2',
      home_scorers: "{\"Achraf Hakimi 39'\",\"Asmaail Saibari 45+1'\",\"Svfian Rhimi 78'\",\"Gessime Yassine 89'\"}",
      away_scorers: "{\"Yassine Bounou 10'\",\"Wilson Isidor 43'\"}",
    }),
    game({
      group: 'A',
      home_team_name_en: 'Czech Republic',
      away_team_name_en: 'Mexico',
      home_score: '0',
      away_score: '3',
      home_scorers: 'null',
      away_scorers: "{\"Mateo Chávez 55'\",\"Jvlian Kviinvnz 61'\",\"Álvaro Fidalgo 90+4'\"}",
    }),
    game({
      group: 'A',
      home_team_name_en: 'South Africa',
      away_team_name_en: 'South Korea',
      home_score: '1',
      away_score: '0',
      home_scorers: "{\"Taplv Maskv 63'\"}",
      away_scorers: 'null',
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
  assert.deepEqual(result.data.actualScores.Switzerland_Canada.as, ["David 76'"]);
  assert.deepEqual(result.data.actualScores['Bosnia and Herzegovina_Qatar'].hs, [
    "Alajbegović 29'",
    "Al-Brake 34' (OG)",
    "Mahmić 80'",
  ]);
  assert.deepEqual(result.data.actualScores.Morocco_Haiti.hs, [
    "Hakimi 39'",
    "Saibari 45+1'",
    "Rahimi 78'",
    "Gessime 89'",
  ]);
  assert.deepEqual(result.data.actualScores['Czech Republic_Mexico'].as, [
    "Chávez 55'",
    "Quiñones 61'",
    "Fidalgo 90+4'",
  ]);
  assert.deepEqual(result.data.actualScores['South Africa_South Korea'].hs, ["Maseko 63'"]);
  assert.equal(result.data.statsData.topScorers.some(row => row.n === 'Damián Bobadilla'), false);
  assert.equal(result.data.statsData.topScorers.some(row => row.n === 'Sultan Al-Brake'), false);
  assert.equal(result.data.statsData.topScorers.some(row => row.n === 'Yassine Bounou'), false);
});

test('serverless scorer verifier can replace incomplete feed scorer strings', async () => {
  const originalFetch = global.fetch;
  const match = game({
    local_date: '06/13/2026 21:00',
    home_score: '2',
    away_score: '0',
    home_scorers: 'null',
    away_scorers: 'null',
  });
  const scoreboard = {
    events: [{
      id: 'espn-1',
      competitions: [{
        competitors: [
          { team: { displayName: 'Mexico' } },
          { team: { displayName: 'South Africa' } },
        ],
      }],
    }],
  };
  const summary = {
    header: {
      competitions: [{
        details: [
          {
            scoringPlay: true,
            team: { displayName: 'Mexico' },
            clock: { value: 600 },
            participants: [{ athlete: { displayName: 'Raúl Jiménez' } }],
            ownGoal: false,
          },
          {
            scoringPlay: true,
            team: { displayName: 'Mexico' },
            clock: { value: 4800 },
            participants: [{ athlete: { displayName: 'Teboho Mokoena' } }],
            ownGoal: true,
          },
        ],
      }],
    },
  };
  global.fetch = async url => ({
    ok: true,
    json: async () => String(url).includes('/summary') ? summary : scoreboard,
  });

  try {
    const verification = await buildScorerVerification([match], Date.parse('2026-06-14T04:00:00Z'));
    const result = buildData([match], Date.parse('2026-06-14T04:00:00Z'), null, verification);

    assert.equal(verification.report.checkedMatches, 1);
    assert.equal(verification.report.matches[0].source, 'espn');
    assert.deepEqual(result.scorerIssues, []);
    assert.deepEqual(result.data.actualScores['Mexico_South Africa'].hs, ["Jiménez 10'", "Mokoena 80' (OG)"]);
    assert.equal(result.data.statsData.topScorers.some(row => row.n === 'Teboho Mokoena'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('source scorer events must match final score by side before acceptance', () => {
  const tokens = sourceEventsToTokens([
    { team: 'Mexico', player: 'Raúl Jiménez', minute: 10 },
    { team: 'South Africa', player: 'Teboho Mokoena', minute: 80 },
  ], 'Mexico', 'South Africa', 2, 0);

  assert.equal(tokens, null);
});

test('scorer matching accepts reversed first-last name order from the live feed', () => {
  const result = buildData([
    game({
      group: 'F',
      home_team_name_en: 'Japan',
      away_team_name_en: 'Sweden',
      home_score: '1',
      away_score: '1',
      home_scorers: '{"Daizen Maeda 56\'"}',
      away_scorers: '{"Anthony Elanga 62\'"}',
    }),
  ]);

  assert.deepEqual(result.scorerIssues, []);
  assert.deepEqual(result.data.actualScores.Japan_Sweden.hs, ["Maeda 56'"]);
  assert.deepEqual(result.data.actualScores.Japan_Sweden.as, ["Elanga 62'"]);
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
  assert.match(app, /function isValidThirdPlaceData/);
  assert.match(app, /localStorage\.removeItem\(DATA_CACHE_KEY\)/);
  assert.doesNotMatch(app, /worldcup26\.ir|api\/scores|api\/standings|dataCacheKey/);
});

test('app shell declares an existing browser icon', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<link rel="icon" type="image\/png" href="\/icon-512\.png">/);
});

test('client hash routing persists every primary tab across refreshes', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(app, /var nextHash = tab === 'matches' \? '#matches\/' \+ selectedMatchDate : '#' \+ tab/);
  assert.match(app, /if \(tab === 'matches' && parts\[1\]\) selectedMatchDate = parts\[1\]/);
  assert.match(app, /var validTabs = \['matches', 'bracket', 'groups', 'stats'\]/);
  assert.match(app, /b\.getAttribute\('data-tab'\) === tab/);
  assert.match(app, /switchTab\('matches'\);/);
  assert.match(html, /<body data-active-tab="matches">/);
  assert.match(html, /nav-tab active" data-tab="matches"/);
  assert.ok(html.indexOf('data-tab="matches"') < html.indexOf('data-tab="bracket"'));
  assert.ok(html.indexOf('data-tab="bracket"') < html.indexOf('data-tab="groups"'));
  assert.ok(html.indexOf('data-tab="groups"') < html.indexOf('data-tab="stats"'));
});

test('match cards use moderately compact spacing without shrinking labels', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /\.match-list \{[^}]*gap: 8px/);
  assert.match(css, /\.match-card \{[\s\S]*?padding: 15px 20px/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.match-card \{[\s\S]*?padding: 11px 14px;[\s\S]*?gap: 7px/);
  assert.match(css, /\.mc-name \{ font-size: 0\.95rem/);
  assert.match(app, /Number\.isInteger\(actual\.hp\)[\s\S]*?actual\.hp !== actual\.ap/);
  assert.match(app, /class="mc-pen-score" aria-label="Penalty shootout:/);
  assert.match(css, /\.mc-pen-score \{[^}]*font-size: 0\.62rem/);
});

test('match date navigation preserves position during adjacent browsing', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /var previousDateScroll = existingDateNav \? existingDateNav\.scrollLeft : null/);
  assert.match(app, /previousDateScroll !== null && !centerDateNavAfterRender/);
  assert.match(app, /nav\.scrollLeft = previousDateScroll/);
  assert.match(app, /data-date="' \+ dateStr/);
  assert.match(app, /aria-pressed="' \+ isActive/);
  assert.match(app, /document\.querySelector\('\.nav-tab\[data-tab="matches"\]'\)/);
  assert.match(app, /renderedTabs\.matches = false/);
  assert.doesNotMatch(app, /active\.scrollIntoView\(\{behavior:'smooth',block:'nearest',inline:'center'\}\)/);
});

test('client renders compact standings status markers with an inline legend', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /function standingsStatusShort/);
  assert.match(app, /return 'W';/);
  assert.match(app, /return 'Q';/);
  assert.match(app, /return 'E';/);
  assert.match(app, /function renderStandingsLegend/);
  assert.match(app, /aria-label="Qualification legend"/);
  assert.match(app, /function renderThirdPlaceTable/);
  assert.match(app, /Third-place race/);
  assert.match(app, /third-place-subtitle-sep/);
  assert.match(app, /fair-play\/FIFA ranking may decide ties/);
  assert.match(app, /Likely Round of 32 opponent/);
  assert.match(app, /third-place-path/);
  assert.match(app, /\.standings-row\[data-team\], \.third-place-row\[data-team\]/);
  assert.match(app, /thirdPlaceData = data\.thirdPlaceData/);
  assert.match(app, /thirdPlaceData: thirdPlaceData/);
});

test('bracket uses live locked seeds before user picks and keeps third-place slots server-driven', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /function liveGroupSeed/);
  assert.match(app, /function autoThirdSeed/);
  assert.match(app, /status\.code === 'won-group'/);
  assert.match(app, /bracketViewMode === 'picks'/);
  assert.match(app, /isTeamEliminatedFromGroup/);
  assert.match(app, /eliminated \? 'out'/);
  assert.match(app, /autoLive3 === team/);
  assert.match(app, /data-locked="true"/);
  assert.match(app, /if \(row && row\.status && row\.status\.code === 'eliminated'\) return;/);
  assert.match(app, /team === live1 \|\| team === live2 \|\| team === directLive3 \|\| team === autoLive3/);
  assert.match(app, /if \(eliminated\) return;/);
  assert.match(app, /Confirmed teams and FT winners lead the bracket/);
  assert.equal(knockoutBracket.byId.M79.a, '3 C/E/F/H/I');
  assert.match(app, /return liveThird \|\| slot/);
  assert.doesNotMatch(app, /validStoredThirdPlacePick/);
  assert.doesNotMatch(app, /getQualified3rdTeams/);
  assert.doesNotMatch(app, /elo: \(eloRatings/);
});

test('bracket preserves original picks and supports live versus prediction modes', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /wc2026bracketOriginal/);
  assert.match(app, /function rememberOriginalPick/);
  assert.match(app, /bracketViewMode = 'live'/);
  assert.match(app, /data-bracket-mode="picks"/);
  assert.match(app, /data-bracket-mode="live"/);
  assert.match(app, /liveThirdPlaceSeedForMatch/);
  assert.match(app, /function compactMatchNode/);
  assert.match(app, /var knockoutModels = \{\}/);
  assert.doesNotMatch(app, /Live bracket uses confirmed seeds and FT winners only/);
  assert.match(app, /knockout picks made/);
  assert.match(app, /if \(bracketViewMode === 'picks'\) totalKoPicks\+\+/);
  assert.match(app, /knockoutScoreOutcome\(homeTeam, awayTeam\)/);
  assert.match(app, /migrateLegacyBracketMatchIds/);
  assert.match(app, /wcData\.teams\[teamName\]/);
  assert.match(app, /Original pick: /);
});

test('bracket cards include knockout dates and local-time labels', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.equal(knockoutBracket.byId.M73.d, '2026-06-28');
  assert.equal(knockoutBracket.byId.M104.d, '2026-07-19');
  assert.match(app, /function bracketDateTime\(matchId\)/);
  assert.match(app, /etToLocal\(schedule\.t, schedule\.d\) \+ ' ' \+ localTz/);
  assert.match(app, /function compactDateTime\(matchId\)/);
  assert.match(app, /function compactVenueCity\(matchId\)/);
  assert.match(app, /bracket-date-time/);
  assert.match(app, /bracket-node-city/);
  assert.match(app, /KnockoutBracket\.byId\[matchId\]\.v/);
});

test('bracket uses connected desktop and dynamic two-column mobile maps', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(app, /function desktopBracketMap\(\)/);
  assert.match(app, /function mobileBracketMap\(\)/);
  assert.match(app, /data-bracket-section=/);
  assert.match(app, /\{id:'r32', label:'R32', title:'Round of 32'/);
  assert.match(app, /\{id:'sf', label:'SF', title:'Semi-finals'/);
  assert.match(app, /function mobileVisualBracket\(round\)/);
  assert.match(app, /function mobileStagePath\(sourceIds, targetId\)/);
  assert.match(app, /viewBox="0 0 18 100"/);
  assert.match(app, /M0 24H9V76H0M9 50H18/);
  assert.match(app, /data-mobile-stage=/);
  assert.match(app, /\[\['M97','M98'\],'M101'\]/);
  assert.match(app, /data-bracket-info-toggle/);
  assert.match(app, /<button type="button" class="bracket-info-heading" data-bracket-info-toggle/);
  assert.match(app, /bracket-title-narrow/);
  assert.match(app, /id="bracketControlsContent" class="bracket-info-content"/);
  assert.match(app, /class="bracket-seeds-embedded"/);
  assert.doesNotMatch(app, /data-bracket-seeds-toggle/);
  assert.match(app, /Original pick: /);
  assert.match(app, /icon\('history',\{size:9\}\)/);
  assert.match(app, /visualSlot\('M104', 5, 8/);
  assert.match(app, /visualSlot\('M103', 5, 12/);
  assert.match(app, /'South Africa':'RSA'/);
  assert.match(app, /aria-label="' \+ esc\(model\.home\)/);
  assert.match(app, /data-team="' \+ esc\(model\.home\)/);
  assert.match(app, /var teamName = koDiv\.getAttribute\('data-team'\)/);
  assert.match(css, /\.bracket-desktop-map/);
  assert.match(css, /\.bracket-mobile-scroll/);
  assert.match(css, /\.bracket-mobile-visual/);
  assert.match(css, /\.bracket-mobile-path/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 18px minmax\(0, 1fr\)/);
  assert.match(css, /\.bracket-mobile-source-stack > \.bracket-visual-slot \{[\s\S]*?width: 100%/);
  assert.match(css, /--mobile-card-height: 72px/);
  assert.match(css, /\.bracket-mobile-path-junction path/);
  assert.match(css, /\.bracket-info-content \{ margin-top: 10px; padding-top: 10px; border-top: 1px solid var\(--border\); \}/);
  assert.match(css, /\.bracket-section-tabs button \{[\s\S]*?height: 32px/);
  assert.match(css, /--bracket-line:/);
  assert.match(css, /body\[data-active-tab="bracket"\] #tab-bracket\.active \{[\s\S]*?min-height: calc\(100dvh/);
  assert.match(css, /\.bracket-mobile-scroll \{[^}]*overflow: visible/);
  assert.doesNotMatch(css, /\.bracket-mobile-scroll \{[^}]*max-height:/);
  assert.match(css, /\.bracket-mobile-visual \.bt-label-code/);
  assert.match(html, /id="navTabs"[\s\S]*class="nav-utilities"[\s\S]*id="searchToggle"[\s\S]*id="themeBtn"/);
});

test('official knockout graph defines every FIFA path through the final', () => {
  const expected = {
    M89: ['W M74', 'W M77'], M90: ['W M73', 'W M75'],
    M91: ['W M76', 'W M78'], M92: ['W M79', 'W M80'],
    M93: ['W M83', 'W M84'], M94: ['W M81', 'W M82'],
    M95: ['W M86', 'W M88'], M96: ['W M85', 'W M87'],
    M97: ['W M89', 'W M90'], M98: ['W M93', 'W M94'],
    M99: ['W M91', 'W M92'], M100: ['W M95', 'W M96'],
    M101: ['W M97', 'W M98'], M102: ['W M99', 'W M100'],
    M103: ['L M101', 'L M102'], M104: ['W M101', 'W M102'],
  };
  assert.equal(knockoutBracket.matches.length, 32);
  Object.entries(expected).forEach(([id, slots]) => {
    assert.deepEqual([knockoutBracket.byId[id].h, knockoutBracket.byId[id].a], slots, id);
  });
  assert.equal(new Set(knockoutBracket.matches.map(match => match.id)).size, 32);
  assert.equal(Object.keys(knockoutBracket.bySchedule).length, 32);
});

test('matches tab resolves knockout teams from live standings data', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /KnockoutBracket\.bySchedule/);
  assert.match(app, /function liveKnockoutTeamsForMatch\(m\)/);
  assert.match(app, /function liveGroupSeedForSlot\(slot\)/);
  assert.match(app, /function liveThirdPlaceForMatch\(matchId\)/);
  assert.match(app, /function liveKnockoutWinners\(\)/);
  assert.match(app, /function liveKnockoutOutcomes\(\)/);
  assert.match(app, /var displayTeams = liveKnockoutTeamsForMatch\(m\)/);
  assert.match(app, /var homeName = displayTeams\.h/);
  assert.match(app, /var awayName = displayTeams\.a/);
  assert.match(app, /h: wcData\.teams\[home\] \? home : m\.h/);
  assert.match(app, /a: wcData\.teams\[away\] \? away : m\.a/);
});

test('next-match banner uses the same confirmed knockout team resolver', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const strip = app.slice(app.indexOf('function renderMatchStrip'), app.indexOf('function getMatchKickoffDate'));
  assert.match(strip, /liveKnockoutTeamsForMatch\(target\)/);
  assert.match(strip, /homeName \+ ' vs ' \+ awayName/);
  assert.match(strip, /Next match: /);
  assert.match(strip, /el\.title = el\.getAttribute\('aria-label'\)/);
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
