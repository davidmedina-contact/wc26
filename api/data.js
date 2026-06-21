// Combined bootstrap payload for the client.
// Returns the static snapshot plus live final scores, standings, and stats.

const SNAPSHOT = require('../data.json');

const NAME_MAP = { 'USA': 'United States', 'Turkey': 'Türkiye' };
function norm(name) { return NAME_MAP[name] || name; }

async function fetchJson(url, timeoutMs) {
  const proxyUrl = 'https://r.jina.ai/' + url.replace(/^https?:\/\//, 'http://');
  const direct = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(r => r.text())
    .catch(() => null);
  if (direct) {
    try { return JSON.parse(direct); } catch (e) {}
  }
  const proxied = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs + 5000) })
    .then(r => r.text())
    .catch(() => null);
  if (!proxied) return null;
  const start = proxied.indexOf('{');
  const end = proxied.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(proxied.slice(start, end + 1)); } catch (e) {}
  }
  return null;
}

const TEAM_CONFED = {
  'Mexico': 'CONCACAF',
  'United States': 'CONCACAF',
  'Canada': 'CONCACAF',
  'Haiti': 'CONCACAF',
  'Panama': 'CONCACAF',
  'Curaçao': 'CONCACAF',
  'Brazil': 'CONMEBOL',
  'Uruguay': 'CONMEBOL',
  'Argentina': 'CONMEBOL',
  'Colombia': 'CONMEBOL',
  'Paraguay': 'CONMEBOL',
  'Ecuador': 'CONMEBOL',
  'Germany': 'UEFA',
  'Netherlands': 'UEFA',
  'Sweden': 'UEFA',
  'Switzerland': 'UEFA',
  'Spain': 'UEFA',
  'France': 'UEFA',
  'England': 'UEFA',
  'Portugal': 'UEFA',
  'Belgium': 'UEFA',
  'Croatia': 'UEFA',
  'Austria': 'UEFA',
  'Scotland': 'UEFA',
  'Czech Republic': 'UEFA',
  'Türkiye': 'UEFA',
  'Bosnia and Herzegovina': 'UEFA',
  'Norway': 'UEFA',
  'South Korea': 'AFC',
  'Japan': 'AFC',
  'Iran': 'AFC',
  'Qatar': 'AFC',
  'Saudi Arabia': 'AFC',
  'Australia': 'AFC',
  'Uzbekistan': 'AFC',
  'Jordan': 'AFC',
  'Iraq': 'AFC',
  'New Zealand': 'OFC',
  'Morocco': 'CAF',
  'South Africa': 'CAF',
  'Ivory Coast': 'CAF',
  'Tunisia': 'CAF',
  'Egypt': 'CAF',
  'Ghana': 'CAF',
  'Algeria': 'CAF',
  'DR Congo': 'CAF',
  'Senegal': 'CAF',
  'Cape Verde': 'CAF',
};

function parseScorerTokens(raw) {
  if (!raw || raw === 'null') return [];
  const str = String(raw).replace(/[“”]/g, '"').trim();
  const out = [];
  const re = /"([^"]+)"/g;
  let match;
  while ((match = re.exec(str))) out.push(match[1]);
  if (out.length > 0) return out;
  return str
    .replace(/^[{\[]|[}\]]$/g, '')
    .split(',')
    .map(s => s.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

function scorerName(token) {
  if (!token || /(OG)|own goal/i.test(token)) return null;
  const name = token.replace(/\s+\d.*$/, '').trim();
  return name || null;
}

function sumGoals(game) {
  return (parseInt(game.home_score) || 0) + (parseInt(game.away_score) || 0);
}

function computeStats(games) {
  const finishedGames = games.filter(g => String(g.finished).toUpperCase() === 'TRUE');
  const finishedGroupGames = finishedGames.filter(g => g.type === 'group');

  const scorerTotals = {};
  const scorerTeams = {};
  const conf = {};

  function addConf(teamName, scored, conceded) {
    const key = TEAM_CONFED[teamName];
    if (!key) return;
    if (!conf[key]) conf[key] = { c: key, s: 0, con: 0 };
    conf[key].s += scored;
    conf[key].con += conceded;
  }

  finishedGames.forEach(game => {
    const home = norm(game.home_team_name_en || '');
    const away = norm(game.away_team_name_en || '');
    const homeScore = parseInt(game.home_score) || 0;
    const awayScore = parseInt(game.away_score) || 0;

    addConf(home, homeScore, awayScore);
    addConf(away, awayScore, homeScore);

    parseScorerTokens(game.home_scorers).forEach(token => {
      const name = scorerName(token);
      if (!name) return;
      scorerTotals[name] = (scorerTotals[name] || 0) + 1;
      scorerTeams[name] = home;
    });
    parseScorerTokens(game.away_scorers).forEach(token => {
      const name = scorerName(token);
      if (!name) return;
      scorerTotals[name] = (scorerTotals[name] || 0) + 1;
      scorerTeams[name] = away;
    });
  });

  const topScorers = Object.keys(scorerTotals)
    .map(name => ({ n: name, t: scorerTeams[name] || '', g: scorerTotals[name] }))
    .sort((a, b) => b.g - a.g || a.n.localeCompare(b.n))
    .slice(0, 20);

  const groupTotals = {};
  finishedGroupGames.forEach(game => {
    const letter = game.group;
    if (!groupTotals[letter]) groupTotals[letter] = { g: letter, m: 0, goals: 0 };
    groupTotals[letter].m += 1;
    groupTotals[letter].goals += sumGoals(game);
  });

  const groupGoals = Object.keys(groupTotals)
    .sort()
    .map(letter => groupTotals[letter]);

  const biggestWin = finishedGames.reduce((best, game) => {
    const homeScore = parseInt(game.home_score) || 0;
    const awayScore = parseInt(game.away_score) || 0;
    const margin = Math.abs(homeScore - awayScore);
    if (margin <= (best?.margin || 0)) return best;
    const winner = homeScore > awayScore ? (game.home_team_name_en || '') : (game.away_team_name_en || '');
    const loser = homeScore > awayScore ? (game.away_team_name_en || '') : (game.home_team_name_en || '');
    return {
      margin,
      label: `${winner} ${Math.max(homeScore, awayScore)}-${Math.min(homeScore, awayScore)} ${loser}`,
    };
  }, null);

  const highestScoring = finishedGames.reduce((best, game) => {
    const goals = sumGoals(game);
    if (goals <= (best?.goals || 0)) return best;
    return {
      goals,
      label: `${game.home_team_name_en || ''} ${game.home_score}-${game.away_score} ${game.away_team_name_en || ''}`,
    };
  }, null);

  const confStatsOrder = ['UEFA', 'CONMEBOL', 'AFC', 'CAF', 'CONCACAF', 'OFC'];
  const confStats = confStatsOrder.map(name => {
    const row = conf[name] || { c: name, s: 0, con: 0 };
    return { c: row.c, s: row.s, con: row.con };
  });

  const matchesPlayed = finishedGames.length;
  const goalsScored = finishedGames.reduce((sum, game) => sum + sumGoals(game), 0);

  const leader = topScorers[0] || { n: 'N/A', t: '', g: 0 };
  const leaderFlag = (SNAPSHOT.teams[leader.t] && SNAPSHOT.teams[leader.t].flag) ? SNAPSHOT.teams[leader.t].flag : '';
  const leaderTeam = leaderFlag ? `${leaderFlag} ${leader.t}` : leader.t;

  return {
    overview: {
      matchesPlayed,
      goalsScored,
      goalsPerMatch: matchesPlayed ? (goalsScored / matchesPlayed) : 0,
      teams: Object.keys(SNAPSHOT.teams || {}).length,
    },
    topScorers,
    groupGoals,
    confStats,
    records: [
      { label: 'Top scorer', detail: leader.t ? `${leader.n} (${leaderTeam}) leads with ${leader.g} goals.` : 'No scoring data available yet.' },
      { label: 'Biggest win', detail: biggestWin ? biggestWin.label : 'No completed matches yet.' },
      { label: 'Highest-scoring match', detail: highestScoring ? highestScoring.label : 'No completed matches yet.' },
    ],
  };
}

async function fetchStandings() {
  const [groupsRes, teamsRes] = await Promise.all([
    fetchJson('http://worldcup26.ir/get/groups', 10000),
    fetchJson('http://worldcup26.ir/get/teams', 10000),
  ]);

  const apiGroups = groupsRes?.groups || [];
  const apiTeams = teamsRes?.teams || [];
  if (!apiGroups.length || !apiTeams.length) return {};

  const teamById = {};
  apiTeams.forEach(t => { teamById[t.id] = norm(t.name_en); });

  const standings = {};
  apiGroups.forEach(group => {
    const letter = group.name;
    const teams = (group.teams || []).map(t => ({
      t: teamById[t.team_id] || ('Team ' + t.team_id),
      p: parseInt(t.mp) || 0,
      w: parseInt(t.w) || 0,
      d: parseInt(t.d) || 0,
      l: parseInt(t.l) || 0,
      gf: parseInt(t.gf) || 0,
      ga: parseInt(t.ga) || 0,
      gd: parseInt(t.gd) || 0,
      pts: parseInt(t.pts) || 0,
    }));
    teams.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    standings[letter] = teams;
  });

  return standings;
}

module.exports = async (req, res) => {
  const [gamesResult, standings] = await Promise.all([
    fetchJson('http://worldcup26.ir/get/games', 10000),
    fetchStandings(),
  ]);
  const scores = {};
  const liveStats = computeStats(gamesResult?.games || []);
  for (const e of (gamesResult?.games || [])) {
    if (String(e.finished).toUpperCase() !== 'TRUE') continue;
    const home = norm(e.home_team_name_en || '');
    const away = norm(e.away_team_name_en || '');
    if (home && away) {
      scores[`${home}_${away}`] = {
        h: parseInt(e.home_score) || 0,
        a: parseInt(e.away_score) || 0,
        status: 'FT',
      };
    }
  }
  const data = JSON.parse(JSON.stringify(SNAPSHOT));

  data.actualScores = Object.assign({}, data.actualScores, scores);
  if (Object.keys(standings).length > 0) data.standingsData = standings;
  data.statsData = liveStats;

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ data, updatedAt: new Date().toISOString() });
};
