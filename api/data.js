// Combined bootstrap payload for the client.
// Returns the static snapshot plus live final scores, standings, and stats.

const SNAPSHOT = require('../data.json');

const NAME_MAP = { 'USA': 'United States', 'Turkey': 'Türkiye' };
function norm(name) { return NAME_MAP[name] || name; }

const SCORER_ALIASES_RAW = {
  'j quiñones': 'Julián Quiñones',
  'r jiménez': 'Raúl Jiménez',
  'i b hwang': 'Hwang Inbeom',
  'h g oh': 'Oh Hyeongyu',
  'l krejčí': 'Ladislav Krejčí',
  'c larin': 'Cyle Larin',
  'd bobadilla': 'Damián Bobadilla',
  'f balogun': 'Folarin Balogun',
  'g reyna': 'Gio Reyna',
  'j mcginn': 'John McGinn',
  'v junior': 'Vinícius Júnior',
  'i saibari': 'Ismael Saibari',
  'b khoukhi': 'Boualem Khoukhi',
  'a diallo': 'Amad Diallo',
  'n schlotterbeck': 'Nico Schlotterbeck',
  'k havertz': 'Kai Havertz',
  'j musiala': 'Jamal Musiala',
  'd undav': 'Denis Undav',
  'c summerville': 'Crysencio Summerville',
  'k nakamura': 'Keito Nakamura',
  'k ogawa': 'Koki Ogawa',
  'y ayari': 'Yasin Ayari',
  'a isak': 'Alexander Isak',
  'v gyökeres': 'Viktor Gyökeres',
  'm svanberg': 'Mattias Svanberg',
  'o rekik': 'Omar Rekik',
  'ramin rezaiian': 'Ramin Rezaeian',
  'elijah just': 'Eli Just',
  'mohamed hany': 'Mohamed Hany',
  'abdulelah al amri': 'Abdulelah Al-Amri',
  'k mbappé': 'Kylian Mbappé',
  'b barcola': 'Bradley Barcola',
  'i mbaye': 'Ibrahima Mbaye',
  'leo østigård': 'Leo Skiri Østigård',
  'rvmanv ashmid': 'Romano Schmid',
  'izn alarb': 'Yazan Al Arab',
  'ali avlvan': 'Ali Olwan',
  'j neves': 'João Neves',
  'y wissa': 'Yoane Wissa',
  'h kane': 'Harry Kane',
  'j bellingham': 'Jude Bellingham',
  'm rashford': 'Marcus Rashford',
  'm baturina': 'Martin Baturina',
  'p musa': 'Petar Musa',
  'abas bk fiz allh af': 'Abbosbek Fayzullaev',
  'dnil mvnvz': 'Daniel Muñoz',
  'lviiz diaz': 'Luis Díaz',
  'khamintvn kampaz': 'Jaminton Campaz',
  'kalb iirnki': 'Caleb Yirenkyi',
  'jvhan mnzambi': 'Johan Manzambi',
  'rvbn vargas': 'Ruben Vargas',
  'aiash ivida': 'Ueda Ayase',
  'dniz avndav': 'Denis Undav',
  'kvdi khakpv': 'Cody Gakpo',
  'kamrvn bargs': 'Cameron Burgess',
  'mohamed almnai': 'Mohammed Al-Mannai',
  'ashmaail saibari': 'Ismael Saibari',
};

function compactName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function words(name) {
  return compactName(name).split(/\s+/).filter(Boolean);
}

const SCORER_ALIASES = Object.fromEntries(
  Object.entries(SCORER_ALIASES_RAW).map(([k, v]) => [compactName(k), v])
);

function levenshtein(a, b) {
  a = compactName(a); b = compactName(b);
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

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

function parseSurname(token) {
  const cleaned = compactName(token);
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const initials = /^[a-z](?:\.[a-z])+/.test(cleaned) ? cleaned.replace(/[^a-z]/g, ' ').trim().split(/\s+/).slice(-1)[0] : '';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  if (last.length > 1) return last;
  return initials || last;
}

function playerScore(token, playerName) {
  const t = compactName(token);
  const p = compactName(playerName);
  if (!t || !p) return 0;
  if (t === p) return 100;
  if (SCORER_ALIASES[t] && compactName(SCORER_ALIASES[t]) === p) return 99;

  const tWords = words(token);
  const pWords = words(playerName);
  const tLast = tWords[tWords.length - 1] || '';
  const pFirst = pWords[0] || '';
  const pLast = pWords[pWords.length - 1] || '';
  const tInitials = tWords.filter(w => w.length === 1).join('');
  const pInitials = pWords.map(w => w[0]).join('');

  let score = 0;
  if (tLast && (pFirst === tLast || pLast === tLast)) score += 35;
  if (tInitials && pInitials && tInitials === pInitials) score += 25;
  if (p.includes(t) || t.includes(p)) score += 20;
  const dist = levenshtein(t, p);
  const maxLen = Math.max(t.length, p.length) || 1;
  score += Math.max(0, 40 - Math.round((dist / maxLen) * 40));
  return score;
}

function resolvePlayerTeam(playerName, homeTeam, awayTeam) {
  const target = compactName(playerName);
  for (const teamName of [homeTeam, awayTeam].filter(Boolean)) {
    const squad = (SNAPSHOT.teams[teamName] && SNAPSHOT.teams[teamName].squad) || [];
    if (squad.some(player => compactName(player.n) === target)) return teamName;
  }
  for (const teamName of Object.keys(SNAPSHOT.teams || {})) {
    const squad = (SNAPSHOT.teams[teamName] && SNAPSHOT.teams[teamName].squad) || [];
    if (squad.some(player => compactName(player.n) === target)) return teamName;
  }
  return homeTeam || awayTeam || '';
}

function resolveScorerToken(token, homeTeam, awayTeam) {
  const cleaned = scorerName(token);
  if (!cleaned) return null;
  const alias = SCORER_ALIASES[compactName(cleaned)];
  if (alias) return { name: alias, team: resolvePlayerTeam(alias, homeTeam, awayTeam), score: 99 };

  const teams = [homeTeam, awayTeam].filter(Boolean);
  let best = null;
  teams.forEach(teamName => {
    const squad = (SNAPSHOT.teams[teamName] && SNAPSHOT.teams[teamName].squad) || [];
    squad.forEach(player => {
      const score = playerScore(cleaned, player.n);
      if (!best || score > best.score) best = { name: player.n, team: teamName, score };
    });
  });

  if (best && best.score >= 50) return best;

  // Last-ditch pass across the whole snapshot for badly transliterated tokens.
  let globalBest = best;
  Object.keys(SNAPSHOT.teams || {}).forEach(teamName => {
    const squad = (SNAPSHOT.teams[teamName] && SNAPSHOT.teams[teamName].squad) || [];
    squad.forEach(player => {
      const score = playerScore(cleaned, player.n) - 5;
      if (!globalBest || score > globalBest.score) globalBest = { name: player.n, team: teamName, score };
    });
  });
  return globalBest && globalBest.score >= 48 ? globalBest : { name: cleaned, team: homeTeam || awayTeam || '', score: 0 };
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
      const resolved = resolveScorerToken(token, home, away);
      if (!resolved || !resolved.name) return;
      scorerTotals[resolved.name] = (scorerTotals[resolved.name] || 0) + 1;
      scorerTeams[resolved.name] = resolved.team || home;
    });
    parseScorerTokens(game.away_scorers).forEach(token => {
      const resolved = resolveScorerToken(token, home, away);
      if (!resolved || !resolved.name) return;
      scorerTotals[resolved.name] = (scorerTotals[resolved.name] || 0) + 1;
      scorerTeams[resolved.name] = resolved.team || away;
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

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ data, updatedAt: new Date().toISOString() });
};
