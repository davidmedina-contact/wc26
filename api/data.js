// Combined bootstrap payload for the client.
// Returns the static snapshot plus live final scores, standings, and stats.

const SNAPSHOT = require('../data.json');

const NAME_MAP = {
  'USA': 'United States',
  'Turkey': 'Türkiye',
  'Democratic Republic of the Congo': 'DR Congo',
};
function norm(name) { return NAME_MAP[name] || String(name || '').trim(); }
function isKnownTeam(name) { return Boolean(SNAPSHOT.teams[norm(name)]); }

function parseScore(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 && score <= 99 ? score : null;
}

function validFinishedGames(games) {
  return (Array.isArray(games) ? games : []).filter(game =>
    String(game.finished).toUpperCase() === 'TRUE' &&
    isKnownTeam(game.home_team_name_en) &&
    isKnownTeam(game.away_team_name_en) &&
    parseScore(game.home_score) !== null &&
    parseScore(game.away_score) !== null
  );
}

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

async function fetchJson(url, timeoutMs, attempts) {
  attempts = attempts || 1;
  async function request(candidate, timeout) {
    const response = await fetch(candidate, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = await response.text();
    try { return JSON.parse(body); } catch (e) {
      const start = body.indexOf('{');
      const end = body.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
      throw e;
    }
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const separator = url.includes('?') ? '&' : '?';
    const candidate = attempt ? `${url}${separator}retry=${Date.now()}` : url;
    const proxyUrl = 'https://r.jina.ai/' + candidate.replace(/^https?:\/\//, 'http://');
    const result = await Promise.any([
      request(candidate, timeoutMs),
      request(proxyUrl, timeoutMs + 5000),
    ]).catch(() => null);
    if (result) return result;
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
  return globalBest && globalBest.score >= 48 ? globalBest : null;
}

function sumGoals(game) {
  return parseScore(game.home_score) + parseScore(game.away_score);
}

function computeStats(games) {
  const finishedGames = validFinishedGames(games);
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
    const homeScore = parseScore(game.home_score);
    const awayScore = parseScore(game.away_score);

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
    const homeScore = parseScore(game.home_score);
    const awayScore = parseScore(game.away_score);
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

function computeStandings(games) {
  const standings = {};
  Object.keys(SNAPSHOT.groups || {}).forEach(letter => {
    standings[letter] = SNAPSHOT.groups[letter].teams.map(team => ({
      t: team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
    }));
  });

  validFinishedGames(games).filter(game => game.type === 'group').forEach(game => {
    const group = standings[game.group];
    if (!group) return;
    const home = group.find(row => row.t === norm(game.home_team_name_en));
    const away = group.find(row => row.t === norm(game.away_team_name_en));
    if (!home || !away) return;
    const homeScore = parseScore(game.home_score);
    const awayScore = parseScore(game.away_score);
    home.p += 1; away.p += 1;
    home.gf += homeScore; home.ga += awayScore;
    away.gf += awayScore; away.ga += homeScore;
    if (homeScore > awayScore) {
      home.w += 1; home.pts += 3; away.l += 1;
    } else if (awayScore > homeScore) {
      away.w += 1; away.pts += 3; home.l += 1;
    } else {
      home.d += 1; away.d += 1; home.pts += 1; away.pts += 1;
    }
  });

  Object.values(standings).forEach(group => {
    group.forEach(row => { row.gd = row.gf - row.ga; });
    group.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.t.localeCompare(b.t));
  });
  return standings;
}

function readOfficialStandings(groupsResult, games) {
  const apiGroups = groupsResult?.groups;
  if (!Array.isArray(apiGroups)) return null;

  const teamById = {};
  (Array.isArray(games) ? games : []).forEach(game => {
    if (game.home_team_id && isKnownTeam(game.home_team_name_en)) {
      teamById[game.home_team_id] = norm(game.home_team_name_en);
    }
    if (game.away_team_id && isKnownTeam(game.away_team_name_en)) {
      teamById[game.away_team_id] = norm(game.away_team_name_en);
    }
  });

  const standings = {};
  for (const group of apiGroups) {
    if (!SNAPSHOT.groups[group.name] || !Array.isArray(group.teams) || group.teams.length !== 4) continue;
    const rows = group.teams.map(item => {
      const row = {
        t: teamById[item.team_id],
        p: Number(item.mp),
        w: Number(item.w),
        d: Number(item.d),
        l: Number(item.l),
        gf: Number(item.gf),
        ga: Number(item.ga),
        gd: Number(item.gd),
        pts: Number(item.pts),
      };
      const numbers = [row.p, row.w, row.d, row.l, row.gf, row.ga, row.gd, row.pts];
      const nonNegative = [row.p, row.w, row.d, row.l, row.gf, row.ga, row.pts];
      const valid = isKnownTeam(row.t) && numbers.every(Number.isInteger) &&
        nonNegative.every(value => value >= 0) &&
        row.p === row.w + row.d + row.l && row.gd === row.gf - row.ga && row.pts === (row.w * 3) + row.d;
      return valid ? row : null;
    });
    if (rows.every(Boolean) && new Set(rows.map(row => row.t)).size === 4) standings[group.name] = rows;
  }

  if (Object.keys(standings).length !== Object.keys(SNAPSHOT.groups).length) return null;
  const expectedAppearances = validFinishedGames(games).filter(game => game.type === 'group').length * 2;
  const actualAppearances = Object.values(standings).flat().reduce((sum, row) => sum + row.p, 0);
  return actualAppearances === expectedAppearances ? standings : null;
}

function expectedFinishedKeys(now) {
  const cutoff = Number(now || Date.now());
  return (SNAPSHOT.matchesData || [])
    .filter(match => !match.stage && isKnownTeam(match.h) && isKnownTeam(match.a))
    .filter(match => Date.parse(`${match.d}T${match.t}:00-04:00`) + (4 * 60 * 60 * 1000) <= cutoff)
    .map(match => `${match.h}_${match.a}`);
}

function buildData(games, now, groupsResult) {
  const finishedGames = validFinishedGames(games);
  const scores = {};
  finishedGames.forEach(game => {
    const home = norm(game.home_team_name_en);
    const away = norm(game.away_team_name_en);
    scores[`${home}_${away}`] = {
      h: parseScore(game.home_score),
      a: parseScore(game.away_score),
      status: 'FT',
    };
  });

  const data = JSON.parse(JSON.stringify(SNAPSHOT));
  data.actualScores = Object.assign({}, data.actualScores, scores);
  const officialStandings = readOfficialStandings(groupsResult, games);
  data.standingsData = officialStandings || computeStandings(games);
  data.statsData = computeStats(games);

  const missingFinals = expectedFinishedKeys(now).filter(key => !scores[key]);
  return {
    data,
    finishedMatches: finishedGames.length,
    missingFinals,
    standingsSource: officialStandings ? 'official-feed' : 'computed-fallback',
  };
}

module.exports = async (req, res) => {
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.json({ error: 'Method not allowed' });
  }

  const gamesResult = await fetchJson('https://worldcup26.ir/get/games', 15000, 2);
  const games = gamesResult?.games;
  const hasRecognizedGames = Array.isArray(games) && games.some(game =>
    isKnownTeam(game.home_team_name_en) && isKnownTeam(game.away_team_name_en)
  );
  if (!hasRecognizedGames) {
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ error: 'Live match data is temporarily unavailable' });
  }

  // The ordered table is optional. Scores and stats never wait on it before the
  // critical games feed has succeeded.
  const groupsResult = await fetchJson('https://worldcup26.ir/get/groups', 5000, 1);
  const result = buildData(games, Date.now(), groupsResult);
  if (result.missingFinals.length > 0) {
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ error: 'Live match data is incomplete', missingFinals: result.missingFinals });
  }

  res.statusCode = 200;
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=60');
  res.json({
    data: result.data,
    updatedAt: new Date().toISOString(),
    meta: {
      source: 'worldcup26.ir',
      finishedMatches: result.finishedMatches,
      standingsSource: result.standingsSource,
    },
  });
};

module.exports._test = {
  buildData,
  computeStandings,
  computeStats,
  expectedFinishedKeys,
  parseScore,
  readOfficialStandings,
  validFinishedGames,
};
