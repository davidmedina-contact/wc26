// FIFA World Cup 2026 Guide - Application Logic
// Data is loaded asynchronously from the serverless bootstrap endpoint

var wcData, jerseyNumbers, matchesData, scorePredictions, teamStrength,
    eloRatings, injuryIntel, actualScores, standingsData, bracketVenues,
    groupColors, modelPredictions;
var statsData, thirdPlaceData;
var statsView = 'overview';
var teamStatsView = 'attack';

function isValidBootstrapData(data) {
  return Boolean(data && data.groups && data.teams && Array.isArray(data.matchesData));
}

function isValidThirdPlaceData(rows) {
  if (!Array.isArray(rows) || !rows.length) return true;
  var topRows = rows.filter(function(row) {
    return row && row.status && (row.status.code === 'in-position' || row.status.code === 'qualified-third');
  });
  if (!topRows.length) topRows = rows.slice(0, 8);
  return topRows.every(function(row) {
    return row && row.path && row.path.opponentSlot && row.path.match;
  });
}

function isUsableDynamicCache(data) {
  return Boolean(data && isValidThirdPlaceData(data.thirdPlaceData));
}

let bracketState = {};
let bracketOriginalState = {};
let bracketViewMode = 'live';
let bracketMobileSection = 'r32';
let bracketMobileSectionChosen = false;
let bracketInfoExpanded = false;
var selectedMatchDate = '2026-06-11';
var centerDateNavAfterRender = false;
var matchDateTransitionDirection = '';

function saveBracketState() {
  try { localStorage.setItem('wc2026bracket', JSON.stringify(bracketState)); } catch(e) {}
}

function saveBracketOriginalState() {
  try { localStorage.setItem('wc2026bracketOriginal', JSON.stringify(bracketOriginalState)); } catch(e) {}
}

function saveBracketViewMode() {
  try { localStorage.setItem('wc2026bracketMode', bracketViewMode); } catch(e) {}
}

function rememberOriginalPick(key, team) {
  if (!key || !team || bracketOriginalState[key]) return;
  bracketOriginalState[key] = team;
  saveBracketOriginalState();
}

function switchBracketMode(mode) {
  bracketViewMode = mode === 'picks' ? 'picks' : 'live';
  saveBracketViewMode();
  renderBracket();
}

function getMatchPrediction(home, away) {
  var hStr = teamStrength[home] || 50;
  var aStr = teamStrength[away] || 50;
  var total = hStr + aStr;
  var drawPct = 24;
  var hWin = Math.round((hStr / total) * (100 - drawPct));
  var aWin = Math.round((aStr / total) * (100 - drawPct));
  hWin = Math.max(8, Math.min(82, hWin));
  aWin = Math.max(8, Math.min(82, aWin));
  drawPct = 100 - hWin - aWin;
  if (drawPct < 12) { var fix = 12 - drawPct; hWin -= Math.ceil(fix/2); aWin -= Math.floor(fix/2); drawPct = 12; }
  return {h: hWin, d: drawPct, a: aWin};
}




var renderedTabs = {};
function ensureTabRendered(tab) {
  if (renderedTabs[tab]) return;
  renderedTabs[tab] = true;
  try {
    switch(tab) {
      case 'groups': if (typeof renderGroups === 'function') renderGroups(); break;
      case 'matches': if (typeof renderMatches === 'function') renderMatches(); break;
      case 'bracket': if (typeof renderBracket === 'function') renderBracket(); break;
      case 'stats': if (typeof renderStats === 'function') renderStats(); break;
    }
  } catch(e) { console.error('Error rendering ' + tab + ':', e); }
}

function switchTab(tab, btn) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  var activeButton = btn || document.querySelector('.nav-tab[data-tab="' + tab + '"]');
  if (activeButton) activeButton.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  document.body.setAttribute('data-active-tab', tab);
  ensureTabRendered(tab);
  var nextHash = tab === 'matches' ? '#matches/' + selectedMatchDate : '#' + tab;
  if (window.location.hash !== nextHash) history.replaceState(null, '', nextHash);
}

function getPC(pos) {
  if (pos === 'GK') return 'pos-gk';
  if (['CB','RB','LB','RWB','LWB'].includes(pos)) return 'pos-def';
  if (['CDM','CM','CAM','RM','LM'].includes(pos)) return 'pos-mid';
  return 'pos-fwd';
}

function getTeamsIndex() {
  return (typeof wcData !== 'undefined' && wcData && wcData.teams) ? wcData.teams : {};
}

function compactTeamLabel(name) {
  var labels = {
    'United States': 'USA',
    'Bosnia and Herzegovina': 'Bosnia',
    'Switzerland': 'SUI',
    'Colombia': 'COL',
    'Czech Republic': 'Czechia',
    'South Korea': 'S. Korea',
    'South Africa': 'S. Africa',
    'DR Congo': 'DR Congo',
    'Democratic Republic of the Congo': 'DR Congo',
  };
  return labels[name] || name;
}

var TEAM_CODES = {
  'Algeria':'ALG','Argentina':'ARG','Australia':'AUS','Austria':'AUT',
  'Belgium':'BEL','Bosnia and Herzegovina':'BIH','Brazil':'BRA','Canada':'CAN',
  'Cape Verde':'CPV','Colombia':'COL','Croatia':'CRO','Curaçao':'CUW',
  'Czech Republic':'CZE','DR Congo':'COD','Democratic Republic of the Congo':'COD',
  'Ecuador':'ECU','Egypt':'EGY','England':'ENG','France':'FRA','Germany':'GER',
  'Ghana':'GHA','Haiti':'HAI','Iran':'IRN','Iraq':'IRQ','Ivory Coast':'CIV',
  'Japan':'JPN','Jordan':'JOR','Mexico':'MEX','Morocco':'MAR','Netherlands':'NED',
  'New Zealand':'NZL','Norway':'NOR','Panama':'PAN','Paraguay':'PAR','Portugal':'POR',
  'Qatar':'QAT','Saudi Arabia':'KSA','Scotland':'SCO','Senegal':'SEN','South Africa':'RSA',
  'South Korea':'KOR','Spain':'ESP','Sweden':'SWE','Switzerland':'SUI','Tunisia':'TUN',
  'Türkiye':'TUR','United States':'USA','Uruguay':'URU','Uzbekistan':'UZB'
};

function bracketTeamCode(name) {
  return TEAM_CODES[name] || name;
}

function handleSearch(q) {
  var el = document.getElementById('searchResults');
  if (!q || q.length < 2) { el.classList.remove('visible'); return; }
  var ql = q.toLowerCase(), matches = [];
  Object.keys(wcData.teams).forEach(function(team) {
    if (team.toLowerCase().indexOf(ql) >= 0)
      matches.push({type:'team',name:team,detail:'Manager: ' + wcData.teams[team].manager.name,color:groupColors[getGroupForTeam(team)]||'#6366f1'});
  });
  Object.keys(wcData.teams).forEach(function(team) {
    wcData.teams[team].squad.forEach(function(p) {
      if (p.n.toLowerCase().indexOf(ql) >= 0)
        matches.push({type:'player',name:p.n,detail:team + ' · ' + p.p + ' · ' + p.c,color:groupColors[getGroupForTeam(team)]||'#6366f1'});
    });
  });
  if (!matches.length) { el.classList.remove('visible'); return; }
  el.innerHTML = matches.slice(0,12).map(function(m) {
    var teamName = m.type === 'team' ? m.name : m.detail.split(' · ')[0];
    return '<div class="sr-item" data-team="' + teamName + '">' +
      '<div class="sr-type" style="color:' + m.color + '">' + m.type + '</div>' +
      '<div class="sr-name">' + m.name + '</div>' +
      '<div class="sr-detail">' + m.detail + '</div></div>';
  }).join('');
  // Delegation for search result clicks
  if (!el._hasSearchListener) {
    el._hasSearchListener = true;
    el.addEventListener('mousedown', function(e) {
      var item = e.target.closest('.sr-item[data-team]');
      if (item) {
        e.preventDefault();
        openTeamModal(item.dataset.team);
      }
    });
  }
  el.classList.add('visible');
}

function getGroupForTeam(teamName) {
  var groups = wcData.groups;
  for (var g in groups) { if (groups[g].teams.indexOf(teamName) >= 0) return g; }
  return '';
}

function openTeamModal(teamName) {
  var team = wcData.teams[teamName];
  if (!team) return;
  var g = getGroupForTeam(teamName);
  var gc = groupColors[g] || '#6366f1';
  var el = document.getElementById('modalContent');

  // Get position for top5 players
  function getPlayerPos(name) {
    for (var i = 0; i < team.squad.length; i++) {
      if (team.squad[i].n === name) return team.squad[i].p;
    }
    return '';
  }

  // Wikipedia link
  function wikiLink(name) {
    var slug = name.replace(/ /g, '_');
    return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(slug);
  }

  // Split analysis into sections by finding sentences containing keywords
  function parseAnalysis(text) {
    // Split text into sentences
    var sentences = text.split(/(?<=[.!?])\s+/);
    var callups = '', snubs = '', watch = '', overviewSentences = [];

    sentences.forEach(function(sent) {
      sent = sent.trim();
      if (!sent) return;
      if (/players? to watch/i.test(sent)) {
        watch = sent;
      } else if (/call[- ]?ups?|call[- ]?up|surprise call|inclusion of/i.test(sent)) {
        callups = callups ? callups + ' ' + sent : sent;
      } else if (/snub|omission|left out|leaving out|absence|dropped|axed|not included/i.test(sent)) {
        snubs = snubs ? snubs + ' ' + sent : sent;
      } else {
        overviewSentences.push(sent);
      }
    });

    return { overview: overviewSentences.join(' '), callups: callups, snubs: snubs, watch: watch };
  }

  var analysis = parseAnalysis(team.analysis);

  function resolvedMatchTeams(m) {
    return m.stage ? liveKnockoutTeamsForMatch(m) : {h: m.h, a: m.a};
  }

  function scoreForModalTeams(home, away) {
    var score = actualScores && actualScores[home + '_' + away];
    var reverse = false;
    if (!score) {
      score = actualScores && actualScores[away + '_' + home];
      reverse = Boolean(score);
    }
    return score ? {score: score, reverse: reverse} : null;
  }

  function modalScoreLine(scoreInfo) {
    if (!scoreInfo || !scoreInfo.score) return '';
    var score = scoreInfo.score;
    var homeScore = scoreInfo.reverse ? score.a : score.h;
    var awayScore = scoreInfo.reverse ? score.h : score.a;
    var homePens = scoreInfo.reverse ? score.ap : score.hp;
    var awayPens = scoreInfo.reverse ? score.hp : score.ap;
    var line = homeScore + ' - ' + awayScore;
    if (typeof homePens === 'number' && typeof awayPens === 'number') line += ' (' + homePens + '-' + awayPens + ' pens)';
    return line;
  }

  function modalScorers(scoreInfo, side) {
    if (!scoreInfo || !scoreInfo.score) return [];
    var score = scoreInfo.score;
    var source = side === 'home'
      ? (scoreInfo.reverse ? score.as : score.hs)
      : (scoreInfo.reverse ? score.hs : score.as);
    return Array.isArray(source) ? source : [];
  }

  function modalScorerGroups(scoreInfo, side) {
    var groups = [];
    modalScorers(scoreInfo, side).forEach(function(token) {
      var raw = String(token || '').trim();
      if (!raw) return;
      var match = raw.match(/^(.*?)(\d+(?:\+\d+)?['’]?)(?:\s*(.*))$/);
      var name = match ? match[1].trim() : raw;
      var minute = match ? match[2].replace(/[’]/g, "'") : '';
      var note = match ? match[3].trim() : '';
      var key = name.toLowerCase() + '|' + note.toLowerCase();
      var existing = groups.find(function(group) { return group.key === key; });
      if (!existing) {
        existing = {key:key, name:name, note:note, minutes:[]};
        groups.push(existing);
      }
      if (minute) existing.minutes.push(minute);
    });
    return groups;
  }

  function renderScorerLane(scoreInfo, side, teamNameForLane, flag) {
    var groups = modalScorerGroups(scoreInfo, side);
    var items = groups.map(function(group) {
      var minuteText = group.minutes.join(', ');
      var note = group.note ? '<span class="mmr-scorer-note">' + esc(group.note) + '</span>' : '';
      return '<div class="mmr-scorer-item"><span class="mmr-scorer-name">' + esc(group.name) + '</span><span class="mmr-scorer-minutes">' + esc(minuteText) + '</span>' + note + '</div>';
    }).join('');
    return '<div class="mmr-scorer-side mmr-scorer-' + side + (groups.length ? '' : ' mmr-scorer-empty') + '">' +
      '<div class="mmr-scorer-team">' + flag + ' ' + esc(teamNameForLane) + '</div>' +
      (items || '<div class="mmr-scorer-none">No goals</div>') +
      '</div>';
  }

  function resultForTeam(scoreInfo, home, away) {
    if (!scoreInfo || !scoreInfo.score || scoreInfo.score.status !== 'FT') return '';
    var score = scoreInfo.score;
    if (score.winner === teamName) return 'w';
    if (score.winner && (score.winner === home || score.winner === away)) return 'l';
    var hGoals = parseInt(scoreInfo.reverse ? score.a : score.h);
    var aGoals = parseInt(scoreInfo.reverse ? score.h : score.a);
    if (home === teamName) return hGoals > aGoals ? 'w' : hGoals < aGoals ? 'l' : 'd';
    return aGoals > hGoals ? 'w' : aGoals < hGoals ? 'l' : 'd';
  }

  function resultLabel(result) {
    return result === 'w' ? 'Win' : result === 'l' ? 'Loss' : result === 'd' ? 'Draw' : 'Set';
  }

  function renderFixtureRow(m, teams, opts) {
    opts = opts || {};
    var scoreInfo = scoreForModalTeams(teams.h, teams.a);
    var dateInfo = formatDatePill(m.d);
    var hFlag = wcData.teams[teams.h] ? wcData.teams[teams.h].flag : '';
    var aFlag = wcData.teams[teams.a] ? wcData.teams[teams.a].flag : '';
    var scoreHtml = scoreInfo
      ? '<div class="mmr-center">' + modalScoreLine(scoreInfo) + '</div>'
      : '<div class="mmr-center mmr-time">' + etToLocal(m.t, m.d) + '</div>';
    var result = resultForTeam(scoreInfo, teams.h, teams.a);
    var status = scoreInfo ? resultLabel(result) : 'Upcoming';
    var scorers = scoreInfo
      ? '<div class="mmr-scorers" aria-label="Goal scorers">' +
        renderScorerLane(scoreInfo, 'home', teams.h, hFlag) +
        renderScorerLane(scoreInfo, 'away', teams.a, aFlag) +
        '</div>'
      : '';
    var round = opts.round ? '<span class="mmr-round">' + esc(opts.round) + '</span>' : '';
    var venue = m.v ? '<div class="mmr-venue">' + esc(m.v) + '</div>' : '';
    return '<div class="mmr-row mmr-result-' + result + (opts.journey ? ' mmr-journey-row' : '') + '" onclick="goToMatch(\'' + m.d + '\')">' +
      '<div class="mmr-dot"></div>' +
      '<div class="mmr-date">' + dateInfo.day + ' ' + dateInfo.date + round + '</div>' +
      '<div class="mmr-home">' + esc(teams.h) + ' ' + hFlag + '</div>' +
      scoreHtml +
      '<div class="mmr-away">' + aFlag + ' ' + esc(teams.a) + '</div>' +
      '<div class="mmr-status">' + status + '</div>' +
      scorers + venue +
    '</div>';
  }

  // Injury/fitness intel
  var injuryNote = (typeof injuryIntel !== 'undefined' && injuryIntel[teamName]) ? injuryIntel[teamName] : '';

  // Build analysis HTML in specified order:
  // 1. Squad summary, 2. Players to watch, 3. Fitness, 4. Call-ups, 5. Snubs
  var analysisHtml = '';
  if (analysis.overview) analysisHtml += '<p class="analysis" style="margin-bottom:12px">' + analysis.overview + '</p>';
  if (analysis.watch) analysisHtml += '<div class="analysis-block" style="border-left-color:#6366f1"><span class="analysis-tag tag-watch">' + icon('eye',{size:12}) + ' PLAYERS TO WATCH</span><p class="analysis">' + analysis.watch + '</p></div>';
  if (injuryNote) analysisHtml += '<div class="analysis-block" style="border-left-color:var(--color-warning, #f59e0b)"><span class="analysis-tag" style="background:rgba(245,158,11,0.12);color:var(--color-warning, #f59e0b)">' + icon('pulse',{size:12}) + ' FITNESS & INJURIES</span>' + injuryNote + '</div>';
  if (analysis.callups) analysisHtml += '<div class="analysis-block" style="border-left-color:#22c55e"><span class="analysis-tag tag-callup">' + icon('userPlus',{size:12}) + ' CALL-UPS</span><p class="analysis">' + analysis.callups + '</p></div>';
  if (analysis.snubs) analysisHtml += '<div class="analysis-block" style="border-left-color:#ef4444"><span class="analysis-tag tag-snub">' + icon('userX',{size:12}) + ' SNUBS</span><p class="analysis">' + analysis.snubs + '</p></div>';

  el.innerHTML = '<div class="modal-hero" style="--gc:' + gc + '">' +
      '<button class="modal-close" onclick="closeModal()" aria-label="Back">' + icon('arrowLeft',{size:18}) + '</button>' +
      '<span class="modal-flag">' + team.flag + '</span>' +
      '<div class="modal-hero-info">' +
        '<h2>' + teamName + '</h2>' +
        '<div class="modal-hero-meta"><span class="modal-group-pill" style="background:' + gc + '">Group ' + g + '</span><span class="modal-mgr-line">' + icon('user',{size:13}) + ' ' + team.manager.name + ' (' + team.manager.nat + ')</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-section"><h3 style="color:' + gc + ';border-color:' + gc + '">' + icon('star') + ' Top 5 Players</h3><div class="top5-grid">' +
    team.top5.map(function(name) {
      var pos = getPlayerPos(name);
      return '<a href="' + wikiLink(name) + '" target="_blank" rel="noopener" class="top5-chip-link"><span class="top5-chip"><span class="top5-pos">' + pos + '</span> ' + name + ' <span class="top5-wiki">↗</span></span></a>';
    }).join('') +
    '</div></div>' +
    '<div class="modal-section"><h3 style="color:' + gc + ';border-color:' + gc + '">' + icon('clipboard') + ' Squad Analysis</h3>' + analysisHtml + '</div>' +
    '<div class="modal-section"><h3 style="color:' + gc + ';border-color:' + gc + '">' + icon('users') + ' Full Squad (' + team.squad.length + ' players)</h3><div style="overflow-x:auto"><table class="squad-tbl"><thead><tr><th>Kit</th><th>Player</th><th>Pos</th><th>Age</th><th>Club</th></tr></thead><tbody>' +
    team.squad.map(function(p, i) {
      var isStar = team.top5.indexOf(p.n) >= 0;
      var wiki = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.n.replace(/ /g,'_'));
      var nameHtml = isStar ? '<a href="' + wiki + '" target="_blank" rel="noopener" class="squad-star-link"><span class="star-icon">★</span>' + p.n + ' <span class="top5-wiki">↗</span></a>' : p.n;
      var kitNum = '';
      try { kitNum = (jerseyNumbers && jerseyNumbers[teamName] && jerseyNumbers[teamName][p.n]) ? jerseyNumbers[teamName][p.n] : ''; } catch(e) {}
      return '<tr><td class="kit-num">' + kitNum + '</td><td>' + nameHtml + '</td><td><span class="pos ' + getPC(p.p) + '">' + p.p + '</span></td><td style="font-family:var(--mono)">' + p.a + '</td><td style="color:var(--text-sec)">' + p.c + '</td></tr>';
    }).join('') +
    '</tbody></table></div></div>';

  // Team matches section — group schedule first, knockout journey second.
  var groupMatches = matchesData.filter(function(m) { return !m.stage && (m.h === teamName || m.a === teamName); });
  groupMatches.sort(function(a, b) { return a.d.localeCompare(b.d) || a.t.localeCompare(b.t); });
  var fixtureHtml = '';
  if (groupMatches.length > 0) {
    fixtureHtml += '<div class="modal-section"><h3 style="color:' + gc + ';border-color:' + gc + '">' + icon('calendar') + ' Group Stage Fixtures</h3><div class="modal-matches">';
    groupMatches.forEach(function(m) { fixtureHtml += renderFixtureRow(m, {h:m.h, a:m.a}); });
    fixtureHtml += '</div></div>';
  }

  var knockoutMatches = matchesData.map(function(m) {
    return {match:m, teams:resolvedMatchTeams(m)};
  }).filter(function(item) {
    return item.match.stage && (item.teams.h === teamName || item.teams.a === teamName);
  }).sort(function(a, b) { return a.match.d.localeCompare(b.match.d) || a.match.t.localeCompare(b.match.t); });
  if (knockoutMatches.length > 0) {
    var latest = knockoutMatches[knockoutMatches.length - 1];
    var latestScore = scoreForModalTeams(latest.teams.h, latest.teams.a);
    var journeyStatus = latestScore && latestScore.score && latestScore.score.winner === teamName
      ? 'Still alive after ' + latest.match.stage
      : latestScore && latestScore.score
        ? 'Reached ' + latest.match.stage
        : 'Next: ' + latest.match.stage;
    fixtureHtml += '<div class="modal-section"><h3 style="color:' + gc + ';border-color:' + gc + '">' + icon('trophy') + ' Knockout Journey</h3>' +
      '<div class="team-journey-summary"><strong>' + esc(journeyStatus) + '</strong><span>' + knockoutMatches.length + ' knockout fixture' + (knockoutMatches.length === 1 ? '' : 's') + '</span></div>' +
      '<div class="modal-matches team-journey">';
    knockoutMatches.forEach(function(item) { fixtureHtml += renderFixtureRow(item.match, item.teams, {round:item.match.stage, journey:true}); });
    fixtureHtml += '</div></div>';
  }
  if (fixtureHtml) el.innerHTML += fixtureHtml;

  document.getElementById('modal').classList.add('visible');
  document.body.style.overflow = 'hidden';
  document.getElementById('searchResults').classList.remove('visible');
}

function closeModal() {
  document.getElementById('modal').classList.remove('visible');
  document.body.style.overflow = '';
}

function goToMatch(dateStr) {
  closeModal();
  setTimeout(function() {
    selectedMatchDate = dateStr;
    centerDateNavAfterRender = true;
    var matchTab = document.querySelector('.nav-tab[data-tab="matches"]');
    renderedTabs.matches = false;
    switchTab('matches', matchTab);
    setTimeout(function() {
      var activePill = document.querySelector('.date-pill.active');
      if (activePill) {
        activePill.style.transition = 'transform 0.3s, box-shadow 0.3s';
        activePill.style.transform = 'scale(1.15)';
        activePill.style.boxShadow = '0 0 16px rgba(99,102,241,0.6)';
        setTimeout(function() {
          activePill.style.transform = '';
          activePill.style.boxShadow = '';
        }, 700);
      }
    }, 200);
  }, 250);
}


// Utility: escape HTML special characters to prevent XSS/rendering issues
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// === UI: Inline SVG icon system (unified visual language with the tab bar) ===
var ICONS = {
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="11" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  userX: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="11" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  stadium: '<ellipse cx="12" cy="12" rx="10" ry="6"/><ellipse cx="12" cy="12" rx="3.5" ry="2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  barChart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  reset: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronUp: '<polyline points="18 15 12 9 6 15"/>'
};

// Returns an inline SVG string. opts: {size, cls, fill}
function icon(name, opts) {
  opts = opts || {};
  var size = opts.size || 16;
  var cls = opts.cls ? ' ' + opts.cls : '';
  var fill = opts.fill || 'none';
  return '<svg class="ui-icon' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}


// === UI: Match Strip (Live Now / Next Up) ===
function renderMatchStrip() {
  var el = document.getElementById('matchStrip');
  if (!el || !matchesData || !matchesData.length) { if (el) el.innerHTML = ''; return; }
  var now = new Date();
  var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  
  // Find live match (match happening right now based on kickoff + ~2h window)
  var liveMatch = null, nextMatch = null;
  for (var i = 0; i < matchesData.length; i++) {
    var m = matchesData[i];
    var kickoff = getMatchKickoffDate(m);
    var endTime = new Date(kickoff.getTime() + 120 * 60000);
    if (now >= kickoff && now <= endTime) { liveMatch = m; break; }
  }
  if (!liveMatch) {
    // Find next upcoming match
    var upcoming = matchesData.filter(function(m) { return getMatchKickoffDate(m) > now; });
    upcoming.sort(function(a, b) { return getMatchKickoffDate(a) - getMatchKickoffDate(b); });
    if (upcoming.length) nextMatch = upcoming[0];
  }

  var target = liveMatch || nextMatch;
  if (!target) { el.innerHTML = ''; return; }

  var displayTeams = liveKnockoutTeamsForMatch(target);
  var homeName = displayTeams.h;
  var awayName = displayTeams.a;
  var hFlag = wcData && wcData.teams[homeName] ? wcData.teams[homeName].flag : '';
  var aFlag = wcData && wcData.teams[awayName] ? wcData.teams[awayName].flag : '';
  var predKey = homeName + '_' + awayName;
  var actual = (typeof actualScores !== 'undefined' && actualScores[predKey]) ? actualScores[predKey] : null;

  var html = '';
  if (liveMatch) {
    html += '<span class="ms-label ms-label-live">LIVE</span>';
    html += '<span class="ms-teams">' + hFlag + ' ' + homeName + ' vs ' + awayName + ' ' + aFlag + '</span>';
    if (actual) html += '<span class="ms-score">' + actual.h + ' - ' + actual.a + '</span>';
  } else {
    html += '<span class="ms-label ms-label-next">NEXT</span>';
    html += '<span class="ms-teams">' + hFlag + ' ' + homeName + ' vs ' + awayName + ' ' + aFlag + '</span>';
    var pdt = etToLocal(target.t, target.d);
    html += '<span class="ms-time">' + pdt + ' ' + localTz + '</span>';
  }
  el.innerHTML = html;
  el.setAttribute('aria-label', (liveMatch ? 'Live match: ' : 'Next match: ') + homeName + ' versus ' + awayName +
    (liveMatch ? '' : ' at ' + pdt + ' ' + localTz));
  el.title = el.getAttribute('aria-label');
}

function getMatchKickoffDate(m) {
  var parts = m.t.split(':');
  var etHour = parseInt(parts[0]);
  var etMin = parseInt(parts[1]);
  var utcHour = etHour + 4;
  var dateParts = m.d.split('-');
  var utcDay = parseInt(dateParts[2]);
  var utcMonth = parseInt(dateParts[1]) - 1;
  var utcYear = parseInt(dateParts[0]);
  if (utcHour >= 24) { utcHour -= 24; utcDay += 1; }
  return new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHour, etMin));
}

// === UI: Search Toggle ===
function toggleSearch() {
  var box = document.getElementById('searchBox');
  if (!box) return;
  var isOpen = box.classList.contains('open');
  if (isOpen) {
    closeSearch();
  } else {
    box.classList.add('open');
    var input = document.getElementById('searchInput');
    if (input) { input.value = ''; input.focus(); }
  }
}
function closeSearch() {
  var box = document.getElementById('searchBox');
  if (box) box.classList.remove('open');
}

// === UI: Updated indicator (transient refresh confirmation) ===
// Pattern: show "Updating…" while fetching, briefly confirm "Updated just now"
// on completion, then auto-dismiss. A permanently parked overlay competes with
// content for attention; a transient toast gives the same reassurance without
// the lingering visual noise.
var lastDataFetchTime = null;
var updatedAgoHideTimer = null;

function setAgoText() {
  var el = document.getElementById('updatedAgo');
  if (!el || !lastDataFetchTime) return;
  var diff = Math.floor((Date.now() - lastDataFetchTime) / 60000);
  if (diff < 1) el.textContent = 'Updated just now';
  else if (diff === 1) el.textContent = 'Updated 1m ago';
  else el.textContent = 'Updated ' + diff + 'm ago';
}

function showUpdatedAgo() {
  lastDataFetchTime = Date.now();
  setAgoText();
  var el = document.getElementById('updatedAgo');
  if (el) el.classList.add('visible');
  // Auto-dismiss after confirmation window (6s to survive iOS PWA launch animation)
  if (updatedAgoHideTimer) clearTimeout(updatedAgoHideTimer);
  updatedAgoHideTimer = setTimeout(function() {
    var elx = document.getElementById('updatedAgo');
    if (elx) elx.classList.remove('visible');
  }, 6000);
}

// === UI: Match Card Expand/Collapse (Phase 5) ===
function toggleMatchDetails(btn) {
  var details = btn.previousElementSibling;
  if (!details) return;
  var isOpen = details.classList.contains('open');
  details.classList.toggle('open');
  btn.classList.toggle('open');
}

// === UI: Form Sparkline (Phase 7) ===
function getTeamForm(teamName) {
  if (!matchesData || !actualScores) return [];
  var form = [];
  for (var i = 0; i < matchesData.length; i++) {
    var m = matchesData[i];
    if (m.h !== teamName && m.a !== teamName) continue;
    var key = m.h + '_' + m.a;
    var score = actualScores[key];
    if (!score) continue;
    var hGoals = parseInt(score.h), aGoals = parseInt(score.a);
    if (isNaN(hGoals) || isNaN(aGoals)) continue;
    if (m.h === teamName) {
      if (hGoals > aGoals) form.push('w');
      else if (hGoals < aGoals) form.push('l');
      else form.push('d');
    } else {
      if (aGoals > hGoals) form.push('w');
      else if (aGoals < hGoals) form.push('l');
      else form.push('d');
    }
  }
  return form.slice(-5);
}
function renderFormDots(teamName) {
  var form = getTeamForm(teamName);
  if (!form.length) return '';
  var html = '<span class="form-dots">';
  form.forEach(function(r) { html += '<span class="form-dot form-dot-' + r + '"></span>'; });
  html += '</span>';
  return html;
}

function standingsStatusShort(code) {
  if (code === 'won-group') return 'W';
  if (code === 'qualified' || code === 'qualified-third') return 'Q';
  if (code === 'eliminated') return 'E';
  return '';
}

function renderStandingsStatus(status) {
  if (!status || !status.code) return '';
  var shortLabel = standingsStatusShort(status.code);
  if (!shortLabel) return '';
  var label = esc(status.label);
  var statusClass = 'standings-status-' + status.code;
  return '<span class="standings-status ' + statusClass + '" title="' + label + '" aria-label="' + label + '">' + shortLabel + '</span>';
}

function renderStandingsLegend(teams) {
  var seen = {};
  var order = ['won-group', 'qualified', 'qualified-third', 'eliminated'];
  var html = '';
  (teams || []).forEach(function(t) {
    if (t.status && t.status.code) seen[t.status.code] = t.status;
  });
  order.forEach(function(code) {
    if (!seen[code]) return;
    var shortLabel = standingsStatusShort(code);
    var label = esc(seen[code].label);
    html += '<span class="standings-legend-item"><span class="standings-status standings-status-' + code + '">' + shortLabel + '</span>' + label + '</span>';
  });
  return html ? '<div class="standings-legend" aria-label="Qualification legend">' + html + '</div>' : '';
}

function renderThirdPlaceTable() {
  if (!Array.isArray(thirdPlaceData) || !thirdPlaceData.length) return '';
  var teamsIndex = getTeamsIndex();
  var html = '<section class="third-place-section" aria-label="Third-place qualification table">' +
    '<div class="third-place-header"><div><div class="third-place-title">Third-place race</div><div class="third-place-subtitle"><span>Top 8 advance</span><span class="third-place-subtitle-sep">·</span><span>fair-play/FIFA ranking may decide ties</span></div></div></div>' +
    '<div class="standings-table-wrap"><table class="standings-table third-place-table"><thead><tr><th>#</th><th>Team</th><th>Grp</th><th>P</th><th>GD</th><th>GF</th><th>Pts</th><th>Status</th><th title="Likely Round of 32 opponent from the current Annex C combination">R32</th></tr></thead><tbody>';
  thirdPlaceData.forEach(function(row) {
    var flag = (teamsIndex[row.t] && teamsIndex[row.t].flag) ? teamsIndex[row.t].flag + ' ' : '';
    var status = row.status || {};
    var code = status.code || '';
    var label = status.label || '';
    var pending = row.tieBreakPending ? '<span class="third-place-pending" title="Fair-play/FIFA ranking tie-break may be needed">TB</span>' : '';
    var path = row.path || null;
    var pathTitle = path
      ? 'Annex C combination ' + path.combinationNo + ': ' + path.opponentSlot + ' in ' + path.match
      : 'Current row is outside the top-eight third-place combination';
    var pathLabel = path
      ? '<span class="third-place-path" title="' + esc(pathTitle) + '">vs ' + esc(compactTeamLabel(path.opponentTeam || path.opponentSlot)) + '<span>' + esc(path.match || '') + '</span></span>'
      : '<span class="third-place-path muted" title="' + esc(pathTitle) + '">If qualifies</span>';
    html += '<tr class="third-place-row third-place-status-' + code + '" data-team="' + row.t + '">' +
      '<td>' + row.rank + '</td>' +
      '<td>' + flag + row.t + pending + '</td>' +
      '<td>' + row.group + '</td>' +
      '<td>' + row.p + '</td>' +
      '<td>' + row.gd + '</td>' +
      '<td>' + row.gf + '</td>' +
      '<td class="pts">' + row.pts + '</td>' +
      '<td><span class="third-place-status-label">' + esc(label) + '</span></td>' +
      '<td>' + pathLabel + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div></section>';
  return html;
}

function renderGroups() {
  var el = document.getElementById('tab-groups');
  if (!wcData || !wcData.groups) {
    // If no data yet and no shell, show placeholder
    if (!el.hasAttribute('data-shell')) {
      el.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading live data…</div>';
    }
    return;
  }

  // Check if static shell is present — hydrate in-place instead of rebuilding
  if (el.hasAttribute('data-shell')) {
    hydrateGroupShell(el);
    el.removeAttribute('data-shell');
  } else {
    // Full rebuild (used on re-renders after tab switch, data refresh, etc.)
    var html = '';
    var letters = Object.keys(wcData.groups);
    var teamsIndex = getTeamsIndex();

    // Jump bar
    html += '<div class="group-jumpbar" id="groupJumpbar">';
    letters.forEach(function(letter) { html += '<a class="jumpbar-pill" href="#grp-' + letter + '">' + letter + '</a>'; });
    html += '</div>';
    html += renderThirdPlaceTable();

    letters.forEach(function(letter) {
      var group = wcData.groups[letter];
      var gc = groupColors[letter] || '#6366f1';
      // Matchday progress: count how many games this group has completed
      var groupMatches = matchesData ? matchesData.filter(function(m) { return m.g === letter && !m.stage; }) : [];
      var played = 0;
      if (actualScores) { groupMatches.forEach(function(m) { if (actualScores[m.h + '_' + m.a]) played++; }); }
      var totalMD = groupMatches.length || 6;
      var mdNum = Math.min(3, Math.ceil((played / (totalMD / 3)) || 0));
      var mdLabel = played > 0 ? ' · MD ' + mdNum + '/3' : '';

      html += '<div class="group-section group-' + letter + '" id="grp-' + letter + '">' +
        '<div class="group-header"><div class="group-badge">' + letter + '</div><div><div class="group-title">Group ' + letter + '<span class="group-md">' + mdLabel + '</span></div><div class="group-region">' + group.region + '</div></div></div>' +
        '<div class="standings-table-wrap"><table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th></th></tr></thead><tbody>';
      var teams = standingsData[letter] || [];
      teams.forEach(function(t, i) {
        var flag = (teamsIndex[t.t] && teamsIndex[t.t].flag) ? teamsIndex[t.t].flag + ' ' : '';
        var posClass = '', statusHtml = '', statusClass = '';
        if (i < 2) posClass = ' standings-pos-qualify';
        else if (i === 2) posClass = ' standings-pos-third';
        if (t.status && t.status.code) {
          statusClass = ' standings-status-' + t.status.code;
          statusHtml = renderStandingsStatus(t.status);
        }
        var formHtml = renderFormDots(t.t);
        html += '<tr class="standings-row' + posClass + statusClass + '" data-team="' + t.t + '">' +
          '<td>' + (i+1) + '</td>' +
          '<td>' + flag + t.t + formHtml + statusHtml + '</td>' +
          '<td>' + t.p + '</td><td>' + t.w + '</td><td>' + t.d + '</td><td>' + t.l + '</td>' +
          '<td>' + t.gf + '</td><td>' + t.ga + '</td><td>' + t.gd + '</td>' +
          '<td class="pts">' + t.pts + '</td>' +
          '<td class="standings-chevron">›</td></tr>';
      });
      html += '</tbody></table></div>' + renderStandingsLegend(teams) + '</div>';
    });
    el.innerHTML = html;
  }

  // Initialize jump bar interaction + intersection observer
  initGroupJumpbar();

  // Event delegation for team card clicks
  if (!el._hasTeamListener) {
    el._hasTeamListener = true;
    el.addEventListener('click', function(e) {
      var row = e.target.closest('.standings-row, .third-place-row');
      if (row && row.dataset.team) {
        openTeamModal(row.dataset.team);
      }
    });
  }
}

// Hydrate the static HTML shell with real standings data
function hydrateGroupShell(el) {
  var teamsIndex = getTeamsIndex();
  var letters = Object.keys(wcData.groups);
  letters.forEach(function(letter) {
    var standings = standingsData[letter] || [];
    if (!standings.length) return;
    var section = el.querySelector('.group-' + letter);
    if (!section) return;
    var rows = section.querySelectorAll('.standings-row');

    // Rebuild rows in correct sorted order
    var tbody = section.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    standings.forEach(function(t, i) {
      var flag = (teamsIndex[t.t] && teamsIndex[t.t].flag) ? teamsIndex[t.t].flag + ' ' : '';
      var posClass = '', statusHtml = '', statusClass = '';
      if (i < 2) posClass = ' standings-pos-qualify';
      else if (i === 2) posClass = ' standings-pos-third';
      if (t.status && t.status.code) {
        statusClass = ' standings-status-' + t.status.code;
        statusHtml = renderStandingsStatus(t.status);
      }
      var tr = document.createElement('tr');
      tr.className = 'standings-row' + posClass + statusClass;
      tr.setAttribute('data-team', t.t);
      var formHtml = renderFormDots(t.t);
      tr.innerHTML = '<td>' + (i+1) + '</td>' +
        '<td>' + flag + t.t + formHtml + statusHtml + '</td>' +
        '<td>' + t.p + '</td><td>' + t.w + '</td><td>' + t.d + '</td><td>' + t.l + '</td>' +
        '<td>' + t.gf + '</td><td>' + t.ga + '</td><td>' + t.gd + '</td>' +
        '<td class="pts">' + t.pts + '</td>' +
        '<td class="standings-chevron">›</td>';
      tbody.appendChild(tr);
    });
    var existingLegend = section.querySelector('.standings-legend');
    if (existingLegend) existingLegend.remove();
    var legendHtml = renderStandingsLegend(standings);
    if (legendHtml) section.insertAdjacentHTML('beforeend', legendHtml);
  });
  // Remove loading pulse
  el.classList.remove('shell-loading');

  // Inject jump bar at the top of the groups tab (for the shell path)
  if (!el.querySelector('.group-jumpbar')) {
    var letters = Object.keys(wcData.groups);
    var barHtml = '<div class="group-jumpbar" id="groupJumpbar">';
    letters.forEach(function(letter) { barHtml += '<a class="jumpbar-pill" href="#grp-' + letter + '">' + letter + '</a>'; });
    barHtml += '</div>';
    el.insertAdjacentHTML('afterbegin', barHtml);
    // Add id anchors to each group section
    letters.forEach(function(letter) {
      var section = el.querySelector('.group-' + letter);
      if (section && !section.id) section.id = 'grp-' + letter;
    });
  }
  var existingThirdTable = el.querySelector('.third-place-section');
  if (existingThirdTable) existingThirdTable.remove();
  var thirdTableHtml = renderThirdPlaceTable();
  if (thirdTableHtml) {
    var jumpbar = el.querySelector('.group-jumpbar');
    if (jumpbar) jumpbar.insertAdjacentHTML('afterend', thirdTableHtml);
    else el.insertAdjacentHTML('afterbegin', thirdTableHtml);
  }

  // Add matchday progress to group headers
  if (matchesData && actualScores) {
    var letters2 = Object.keys(wcData.groups);
    letters2.forEach(function(letter) {
      var section = el.querySelector('.group-' + letter);
      if (!section) return;
      var titleEl = section.querySelector('.group-title');
      if (!titleEl || titleEl.querySelector('.group-md')) return;
      var groupMatches = matchesData.filter(function(m) { return m.g === letter && !m.stage; });
      var played = 0;
      groupMatches.forEach(function(m) { if (actualScores[m.h + '_' + m.a]) played++; });
      var totalMD = groupMatches.length || 6;
      var mdNum = Math.min(3, Math.ceil((played / (totalMD / 3)) || 0));
      if (played > 0) titleEl.insertAdjacentHTML('beforeend', '<span class="group-md"> · MD ' + mdNum + '/3</span>');
    });
  }
}

// === Group Jump Bar Interaction ===
function initGroupJumpbar() {
  var bar = document.getElementById('groupJumpbar');
  if (!bar) return;

  // Smooth scroll on click (prevent default hash jump)
  bar.addEventListener('click', function(e) {
    var pill = e.target.closest('.jumpbar-pill');
    if (!pill) return;
    e.preventDefault();
    var target = document.querySelector(pill.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // IntersectionObserver to highlight the active group letter
  var pills = bar.querySelectorAll('.jumpbar-pill');
  var sections = document.querySelectorAll('#tab-groups .group-section');
  if (!sections.length || !('IntersectionObserver' in window)) return;

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var id = entry.target.id; // "grp-A", "grp-B", etc.
        var letter = id.replace('grp-', '');
        pills.forEach(function(p) { p.classList.toggle('active', p.textContent === letter); });
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });

  sections.forEach(function(s) { observer.observe(s); });
}


// === GROUP STANDINGS ===
function knockoutScoreOutcome(homeTeam, awayTeam) {
  if (!wcData.teams[homeTeam] || !wcData.teams[awayTeam]) return {winner:null, loser:null};
  var score = actualScores && actualScores[homeTeam + '_' + awayTeam];
  var reverse = false;
  if (!score) {
    score = actualScores && actualScores[awayTeam + '_' + homeTeam];
    reverse = Boolean(score);
  }
  if (!score || score.status !== 'FT') return {winner:null, loser:null};

  var explicitWinner = score.winner;
  if (explicitWinner === homeTeam || explicitWinner === awayTeam) {
    return {winner:explicitWinner, loser:explicitWinner === homeTeam ? awayTeam : homeTeam};
  }
  var homeScore = reverse ? score.a : score.h;
  var awayScore = reverse ? score.h : score.a;
  var homePens = reverse ? score.ap : score.hp;
  var awayPens = reverse ? score.hp : score.ap;
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return {winner:null, loser:null};
  if (homeScore === awayScore && typeof homePens === 'number' && typeof awayPens === 'number') {
    homeScore = homePens;
    awayScore = awayPens;
  }
  if (homeScore === awayScore) return {winner:null, loser:null};
  return homeScore > awayScore
    ? {winner:homeTeam, loser:awayTeam}
    : {winner:awayTeam, loser:homeTeam};
}

function renderBracket() {
  var el = document.getElementById('tab-bracket');

  function bracketDateTime(matchId) {
    var schedule = KnockoutBracket.byId[matchId];
    if (!schedule) return '';
    var dateInfo = formatDatePill(schedule.d);
    return dateInfo.day + ', ' + dateInfo.date + ' · ' + etToLocal(schedule.t, schedule.d) + ' ' + localTz;
  }

  function groupComplete(letter) {
    var rows = (standingsData && standingsData[letter]) || [];
    return rows.length === 4 && rows.every(function(row) { return row.p === 3; });
  }

  function liveGroupSeed(letter, pos) {
    var rows = (standingsData && standingsData[letter]) || [];
    if (!rows.length) return null;
    if (pos === '1') {
      var winner = rows.find(function(row) { return row.status && row.status.code === 'won-group'; });
      if (winner) return winner.t;
      return groupComplete(letter) ? rows[0].t : null;
    }
    if (pos === '2') return groupComplete(letter) ? rows[1].t : null;
    if (pos === '3') {
      var third = rows[2];
      return third && third.status && third.status.code === 'qualified-third' ? third.t : null;
    }
    return null;
  }

  function autoThirdSeed(letter) {
    var rows = (standingsData && standingsData[letter]) || [];
    if (!liveGroupSeed(letter, '1') || !liveGroupSeed(letter, '2')) return null;
    var candidates = rows.filter(function(row) {
      var code = row.status && row.status.code;
      return row.t !== liveGroupSeed(letter, '1') && row.t !== liveGroupSeed(letter, '2') && code !== 'eliminated';
    });
    return candidates.length === 1 ? candidates[0].t : null;
  }

  function teamGroupStatus(letter, team) {
    var rows = (standingsData && standingsData[letter]) || [];
    var row = rows.find(function(candidate) { return candidate.t === team; });
    return row && row.status ? row.status.code : '';
  }

  function isTeamEliminatedFromGroup(letter, team) {
    return teamGroupStatus(letter, team) === 'eliminated';
  }

  function isTeamEliminated(team) {
    return Object.keys(wcData.groups || {}).some(function(letter) {
      return isTeamEliminatedFromGroup(letter, team);
    });
  }

  function validStoredGroupPick(letter, pos) {
    var key = 'g_' + letter + '_' + pos;
    var team = bracketState[key];
    return team && !isTeamEliminatedFromGroup(letter, team) ? team : null;
  }

  function liveThirdPlaceSeedForMatch(matchId) {
    var row = Array.isArray(thirdPlaceData) ? thirdPlaceData.find(function(candidate) {
      return candidate.path && candidate.path.match === matchId;
    }) : null;
    return row && row.t ? row.t : null;
  }

  function pickedWinner(matchId) {
    var team = bracketState['ko_' + matchId];
    return team && !isTeamEliminated(team) ? team : null;
  }

  // Resolve a slot like "1A", "2B", or a third-place candidate slot.
  function resolveSlot(slot, matchId) {
    if (slot.charAt(0) === '3') {
      var liveThird = liveThirdPlaceSeedForMatch(matchId);
      return liveThird || slot;
    }
    var pos = slot[0]; // '1' or '2'
    var grp = slot.substring(1); // 'A', 'B', etc.
    var liveSeed = liveGroupSeed(grp, pos);
    var pickSeed = validStoredGroupPick(grp, pos);
    return bracketViewMode === 'picks'
      ? (pickSeed || liveSeed || slot)
      : (liveSeed || slot);
  }

  function getFlag(teamName) {
    return (wcData.teams[teamName] && wcData.teams[teamName].flag) ? wcData.teams[teamName].flag + ' ' : '';
  }

  var totalKoPicks = 0, madeKoPicks = 0;
  var resolvedWinners = {};
  var resolvedLosers = {};
  var knockoutModels = {};

  function resolvedPathSlot(slot) {
    if (slot.indexOf('W ') === 0) return resolvedWinners[slot.substring(2)] || slot;
    if (slot.indexOf('L ') === 0) return resolvedLosers[slot.substring(2)] || slot;
    return slot;
  }

  function scoreForTeams(homeTeam, awayTeam) {
    var score = actualScores && actualScores[homeTeam + '_' + awayTeam];
    var reverse = false;
    if (!score) {
      score = actualScores && actualScores[awayTeam + '_' + homeTeam];
      reverse = Boolean(score);
    }
    if (!score || score.status !== 'FT') return null;
    return {
      h: reverse ? score.a : score.h,
      a: reverse ? score.h : score.a,
      hp: reverse ? score.ap : score.hp,
      ap: reverse ? score.hp : score.ap,
    };
  }

  KnockoutBracket.matches.forEach(function(match) {
    var homeTeam = match.stage === 'r32' ? resolveSlot(match.h, match.id) : resolvedPathSlot(match.h);
    var awayTeam = match.stage === 'r32' ? resolveSlot(match.a, match.id) : resolvedPathSlot(match.a);
    var userPick = pickedWinner(match.id);
    var liveOutcome = knockoutScoreOutcome(homeTeam, awayTeam);
    var liveWinner = liveOutcome.winner;
    var winner = bracketViewMode === 'live' ? liveWinner : (userPick || liveWinner);
    var needsPick = bracketViewMode === 'picks' && !winner && wcData.teams[homeTeam] && wcData.teams[awayTeam];
    if (bracketViewMode === 'picks') totalKoPicks++;
    if (winner) {
      if (bracketViewMode === 'picks') madeKoPicks++;
      resolvedWinners[match.id] = winner;
      resolvedLosers[match.id] = liveOutcome.loser || (winner === homeTeam ? awayTeam : homeTeam);
    }
    knockoutModels[match.id] = {
      match: match,
      home: homeTeam,
      away: awayTeam,
      userPick: userPick,
      liveWinner: liveWinner,
      winner: winner,
      needsPick: needsPick,
      score: scoreForTeams(homeTeam, awayTeam),
    };
  });

  if (!bracketMobileSectionChosen && KnockoutBracket.recommendedMobileStage) {
    var completedKnockoutIds = Object.keys(knockoutModels).filter(function(matchId) {
      return Boolean(knockoutModels[matchId].liveWinner);
    });
    bracketMobileSection = KnockoutBracket.recommendedMobileStage(completedKnockoutIds);
  }

  function compactDateTime(matchId) {
    var match = KnockoutBracket.byId[matchId];
    var info = formatDatePill(match.d);
    return info.date + ' · ' + etToLocal(match.t, match.d);
  }

  function compactVenueCity(matchId) {
    var venue = KnockoutBracket.byId[matchId].v;
    var parsed = venue.match(/^(.*?) \((.*?)\)$/);
    return parsed ? parsed[1] : venue;
  }

  function compactMatchNode(matchId) {
    var model = knockoutModels[matchId];
    var original = bracketOriginalState['ko_' + matchId];
    var originalLabel = original ? 'Original pick: ' + original : '';
    var originalBadge = original && original !== model.winner
      ? '<span class="bracket-original" role="img" aria-label="' + esc(originalLabel) + '" title="' + esc(originalLabel) + '">' + icon('history',{size:9}) + '<span>' + esc(bracketTeamCode(original)) + '</span></span>'
      : '';
    var confirmed = bracketViewMode === 'live' && wcData.teams[model.home] && wcData.teams[model.away];
    var badge = model.liveWinner
      ? '<span class="bracket-live-badge">FT</span>'
      : model.needsPick
        ? '<span class="bracket-tap-hint">pick</span>'
        : confirmed
          ? '<span class="bracket-live-badge">set</span>'
          : originalBadge;
    var score = model.score;
    var homeScore = score ? score.h + (typeof score.hp === 'number' ? ' (' + score.hp + ')' : '') : (model.userPick === model.home && !model.liveWinner ? '&#10003;' : '');
    var awayScore = score ? score.a + (typeof score.ap === 'number' ? ' (' + score.ap + ')' : '') : (model.userPick === model.away && !model.liveWinner ? '&#10003;' : '');
    var lockedHome = bracketViewMode === 'live' && wcData.teams[model.home] ? ' locked' : '';
    var lockedAway = bracketViewMode === 'live' && wcData.teams[model.away] ? ' locked' : '';
    var venueCity = compactVenueCity(matchId);
    var title = compactDateTime(matchId) + ' ' + localTz + ' · ' + venueCity;
    function bracketTeamIdentity(teamName) {
      var openAttrs = wcData.teams[teamName]
        ? ' data-team-open="' + esc(teamName) + '" role="button" tabindex="0" aria-label="Open ' + esc(teamName) + ' team details"'
        : '';
      return '<span class="bt-name"' + openAttrs + '><span class="bt-flag">' + getFlag(teamName) + '</span><span class="bt-label bt-label-full">' + esc(compactTeamLabel(teamName)) + '</span><span class="bt-label bt-label-code">' + esc(bracketTeamCode(teamName)) + '</span></span>';
    }
    return '<div class="bracket-node bracket-match' + (model.needsPick ? ' needs-pick' : '') + '" data-match-id="' + matchId + '" title="' + esc(title) + '">' +
      '<div class="bracket-node-meta"><span>' + matchId + '</span>' + badge + '</div>' +
      '<div class="bracket-team' + (model.winner === model.home ? ' winner' : '') + lockedHome + '" data-ko="' + matchId + '" data-pick="home" data-team="' + esc(model.home) + '" aria-label="' + esc(model.home) + '">' +
        bracketTeamIdentity(model.home) + '<span class="bt-score">' + homeScore + '</span></div>' +
      '<div class="bracket-team' + (model.winner === model.away ? ' winner' : '') + lockedAway + '" data-ko="' + matchId + '" data-pick="away" data-team="' + esc(model.away) + '" aria-label="' + esc(model.away) + '">' +
        bracketTeamIdentity(model.away) + '<span class="bt-score">' + awayScore + '</span></div>' +
      '<div class="bracket-node-footer"><div class="bracket-node-time bracket-date-time">' + compactDateTime(matchId) + '</div>' +
        '<div class="bracket-node-city">' + esc(venueCity) + '</div></div>' +
      '</div>';
  }

  function visualSlot(matchId, col, row, classes, joinSpan) {
    return '<div class="bracket-visual-slot ' + (classes || '') + '" style="--bracket-col:' + col + ';--bracket-row:' + row + ';--join-span:' + (joinSpan || 0) + '">' +
      (joinSpan ? '<span class="bracket-join" aria-hidden="true"></span>' : '') + compactMatchNode(matchId) + '</div>';
  }

  function desktopBracketMap() {
    var out = '<div class="bracket-desktop-shell"><div class="bracket-map-rounds" aria-hidden="true">' +
      '<span>R32</span><span>R16</span><span>QF</span><span>SF</span><span>Final</span><span>SF</span><span>QF</span><span>R16</span><span>R32</span>' +
      '</div><div class="bracket-desktop-map" aria-label="World Cup knockout bracket">';
    var leftR32 = ['M74','M77','M73','M75','M83','M84','M81','M82'];
    var rightR32 = ['M76','M78','M79','M80','M86','M88','M85','M87'];
    var rows8 = [1,3,5,7,9,11,13,15];
    var rows4 = [2,6,10,14];
    leftR32.forEach(function(id, i) { out += visualSlot(id, 1, rows8[i], 'connect-right', 0); });
    ['M89','M90','M93','M94'].forEach(function(id, i) { out += visualSlot(id, 2, rows4[i], 'connect-left connect-right join-left', 2); });
    ['M97','M98'].forEach(function(id, i) { out += visualSlot(id, 3, [4,12][i], 'connect-left connect-right join-left', 4); });
    out += visualSlot('M101', 4, 8, 'connect-left connect-right join-left', 8);
    out += visualSlot('M104', 5, 8, 'connect-left connect-right bracket-final-node', 0);
    out += visualSlot('M103', 5, 12, 'bracket-bronze-node', 0);
    out += '<div class="bracket-champion" style="--bracket-col:5;--bracket-row:4">' +
      icon('trophy',{size:24,cls:'champion-trophy'}) +
      (resolvedWinners.M104 && wcData.teams[resolvedWinners.M104]
        ? '<strong>' + wcData.teams[resolvedWinners.M104].flag + ' ' + esc(resolvedWinners.M104) + '</strong><span>Champion</span>'
        : '<strong>Champion</strong>') + '</div>';
    out += visualSlot('M102', 6, 8, 'connect-left connect-right join-right', 8);
    ['M99','M100'].forEach(function(id, i) { out += visualSlot(id, 7, [4,12][i], 'connect-left connect-right join-right', 4); });
    ['M91','M92','M95','M96'].forEach(function(id, i) { out += visualSlot(id, 8, rows4[i], 'connect-left connect-right join-right', 2); });
    rightR32.forEach(function(id, i) { out += visualSlot(id, 9, rows8[i], 'connect-left', 0); });
    return out + '</div></div>';
  }

  var mobileRounds = [
    {id:'r32', label:'R32', title:'Round of 32', nextTitle:'Round of 16', paths:[
      [['M74','M77'],'M89'], [['M73','M75'],'M90'], [['M83','M84'],'M93'], [['M81','M82'],'M94'],
      [['M76','M78'],'M91'], [['M79','M80'],'M92'], [['M86','M88'],'M95'], [['M85','M87'],'M96']
    ]},
    {id:'r16', label:'R16', title:'Round of 16', nextTitle:'Quarter-finals', paths:[
      [['M89','M90'],'M97'], [['M93','M94'],'M98'], [['M91','M92'],'M99'], [['M95','M96'],'M100']
    ]},
    {id:'qf', label:'QF', title:'Quarter-finals', nextTitle:'Semi-finals', paths:[
      [['M97','M98'],'M101'], [['M99','M100'],'M102']
    ]},
    {id:'sf', label:'SF', title:'Semi-finals', nextTitle:'Final', paths:[
      [['M101','M102'],'M104']
    ]}
  ];

  function mobileChampionCard() {
    var champion = resolvedWinners.M104;
    var finalIsComplete = knockoutModels.M104 && knockoutModels.M104.liveWinner;
    var championLabel = finalIsComplete
      ? 'Confirmed champion'
      : champion && bracketViewMode === 'picks'
        ? 'Your champion pick'
        : 'Champion';
    return '<div class="bracket-mobile-champion-card">' + icon('trophy',{size:22,cls:'champion-trophy'}) +
      (champion && wcData.teams[champion]
        ? '<span>' + championLabel + '</span><strong>' + wcData.teams[champion].flag + ' ' + esc(bracketTeamCode(champion)) + '</strong>'
        : '<strong>' + championLabel + '</strong>') + '</div>';
  }

  function mobileSideDivider() {
    return '<div class="bracket-mobile-side-divider" aria-label="Bracket side boundary"><span>&uarr; Side A · SF1 path</span><span>Side B · SF2 path &darr;</span></div>';
  }

  function mobileStagePath(sourceIds, targetId) {
    var out = '<div class="bracket-mobile-path"><div class="bracket-mobile-source-stack">';
    sourceIds.forEach(function(id) { out += visualSlot(id, 1, 1, 'bracket-mobile-source', 0); });
    return out + '</div><div class="bracket-mobile-path-junction" aria-hidden="true">' +
      '<svg viewBox="0 0 18 100" preserveAspectRatio="none" focusable="false"><path d="M0 24H9V76H0M9 50H18"></path></svg></div>' +
      '<div class="bracket-mobile-target">' + visualSlot(targetId, 1, 1, '', 0) + '</div></div>';
  }

  function mobileFinishPath() {
    return '<div class="bracket-mobile-path bracket-mobile-finish-path">' +
      '<div class="bracket-mobile-source-stack bracket-mobile-finish-sources">' +
        '<div class="bracket-mobile-side-source"><span>Side A · SF1</span>' + visualSlot('M101', 1, 1, 'bracket-mobile-source', 0) + '</div>' +
        '<div class="bracket-mobile-side-source"><span>Side B · SF2</span>' + visualSlot('M102', 1, 1, 'bracket-mobile-source', 0) + '</div>' +
      '</div><div class="bracket-mobile-path-junction bracket-mobile-finish-junction" aria-hidden="true">' +
        '<svg viewBox="0 0 18 100" preserveAspectRatio="none" focusable="false"><path d="M0 28H9V79H0M9 53.5H18"></path></svg></div>' +
      '<div class="bracket-mobile-target bracket-mobile-finish-target">' + visualSlot('M104', 1, 1, 'bracket-final-node', 0) + mobileChampionCard() + '</div></div>';
  }

  function mobileVisualBracket(round) {
    var out = '<div class="bracket-mobile-scroll" data-mobile-bracket-scroll data-mobile-stage-shell="' + round.id + '"><div class="bracket-mobile-visual" data-mobile-stage="' + round.id + '" aria-label="' + round.title + ' to ' + round.nextTitle + '">' +
      '<div class="bracket-mobile-column-titles"><span>' + round.title + '</span><span>' + round.nextTitle + '</span></div>';

    if (round.id === 'sf') {
      out += mobileFinishPath() +
        '<div class="bracket-mobile-aux"><span>Third place</span>' + visualSlot('M103', 1, 1, 'bracket-bronze-node', 0) + '</div>';
    } else {
      var sideBoundary = round.paths.length / 2;
      round.paths.forEach(function(path, index) {
        out += mobileStagePath(path[0], path[1]);
        if (index === sideBoundary - 1) out += mobileSideDivider();
      });
    }
    return out + '</div></div>';
  }

  function mobileBracketMap() {
    if (bracketMobileSection === 'final') bracketMobileSection = 'sf';
    var activeRound = mobileRounds.find(function(round) { return round.id === bracketMobileSection; }) || mobileRounds[0];
    var out = '<div class="bracket-mobile-map"><div class="bracket-section-tabs" role="tablist" aria-label="Bracket section">';
    mobileRounds.forEach(function(round) {
      out += '<button type="button" role="tab" data-bracket-section="' + round.id + '" aria-selected="' + (bracketMobileSection === round.id) + '" class="' + (bracketMobileSection === round.id ? 'active' : '') + '">' + round.label + '</button>';
    });
    return out + '</div>' + mobileVisualBracket(activeRound) + '</div>';
  }

  // === GROUP PICKS ===
  var groupTitle = bracketViewMode === 'live' ? 'Group Seeds' : 'Group Stage Picks';
  var seedsHtml = '<div class="bracket-seeds-embedded"><div class="bracket-seeds-heading"><strong>' + groupTitle + '</strong><small>12 groups</small></div>' +
    '<div id="bracketSeedsContent" class="bracket-seeds-content"><div class="bracket-grid" id="bracketGrid">';
  var idx = 0;
  Object.keys(wcData.groups).forEach(function(letter) {
    var group = wcData.groups[letter];
    var k1 = 'g_' + letter + '_1', k2 = 'g_' + letter + '_2';
    var directLive3 = liveGroupSeed(letter, '3');
    var autoLive3 = directLive3 ? null : autoThirdSeed(letter);
    var live1 = liveGroupSeed(letter, '1'), live2 = liveGroupSeed(letter, '2'), live3 = directLive3 || autoLive3;
    seedsHtml += '<div class="bracket-match"><div class="bracket-match-lbl" style="color:' + groupColors[letter] + '">Group ' + letter + '</div>';
    var k3 = 'g_' + letter + '_3';
    group.teams.forEach(function(team) {
      var liveRank = live1 === team ? '1st' : live2 === team ? '2nd' : live3 === team ? '3rd' : '';
      var eliminated = isTeamEliminatedFromGroup(letter, team);
      var pickedInLiveFilledSlot = !liveRank && !eliminated && (bracketState[k1] === team || bracketState[k2] === team) && (live1 || live2);
      var is1 = !liveRank && !eliminated && !live1 && bracketState[k1] === team;
      var is2 = !liveRank && !eliminated && !live2 && bracketState[k2] === team;
      var is3 = !liveRank && !eliminated && !live3 && (bracketState[k3] === team || pickedInLiveFilledSlot);
      var cls = liveRank === '1st' ? ' winner locked' : liveRank === '2nd' ? ' runner locked' : liveRank === '3rd' ? ' third locked' : eliminated ? ' eliminated locked' : is1 ? ' winner' : is2 ? ' runner' : is3 ? ' third' : '';
      var liveSuffix = autoLive3 === team ? ' auto' : ' confirmed';
      var rank = liveRank ? liveRank + liveSuffix : eliminated ? 'out' : is1 ? '1st pick' : is2 ? '2nd pick' : is3 ? '3rd pick' : '';
      seedsHtml += '<div class="bracket-team' + cls + '" data-idx="' + idx + '"' + ((liveRank || eliminated) ? ' data-locked="true"' : '') + '>' +
        '<span class="bt-name">' + getFlag(team) + team + '</span>' +
        '<span class="bt-rank">' + rank + '</span></div>';
      window._bracketMap = window._bracketMap || [];
      window._bracketMap[idx] = {g: letter, t: team};
      idx++;
    });
    seedsHtml += '</div>';
  });
  seedsHtml += '</div></div></div>';

  // Build HTML. Keep the primary mode switch visible; progressively disclose
  // explanatory copy and group seed controls in the same panel.
  var resetButton = bracketViewMode === 'picks' ? '<button id="resetBtn">' + icon('reset',{size:14}) + '<span>Reset Picks</span></button>' : '';
  var bracketDescription =
    (bracketViewMode === 'live'
      ? 'Confirmed teams and FT winners lead the bracket. Your saved picks remain as comparison data.'
      : 'Manual predictions lead the bracket. Confirmed teams fill empty slots, and original picks are preserved.');
  var html = '<section class="bracket-info' + (bracketInfoExpanded ? ' expanded' : '') + '"><div class="bracket-info-summary"><div class="bracket-info-copy"><button type="button" class="bracket-info-heading" data-bracket-info-toggle aria-expanded="' + bracketInfoExpanded + '" aria-controls="bracketControlsContent" aria-label="' + (bracketInfoExpanded ? 'Hide bracket controls' : 'Show bracket controls') + '"><h3><span class="bracket-title-wide">Elimination Bracket</span><span class="bracket-title-narrow">Bracket</span></h3>' +
    icon(bracketInfoExpanded ? 'chevronUp' : 'chevronDown',{size:16}) + '</button></div>' +
    '<div class="bracket-actions"><div class="bracket-mode-toggle" role="tablist" aria-label="Bracket view">' +
    '<button class="' + (bracketViewMode === 'picks' ? 'active' : '') + '" data-bracket-mode="picks" role="tab" aria-selected="' + (bracketViewMode === 'picks') + '">My Picks</button>' +
    '<button class="' + (bracketViewMode === 'live' ? 'active' : '') + '" data-bracket-mode="live" role="tab" aria-selected="' + (bracketViewMode === 'live') + '">Live Bracket</button>' +
    '</div>' + resetButton + '</div></div>' +
    '<div id="bracketControlsContent" class="bracket-info-content"' + (bracketInfoExpanded ? '' : ' hidden') + '><p>' + bracketDescription + '</p>' + seedsHtml + '</div></section>';

  html += '<div class="bracket-visual">' + desktopBracketMap() + mobileBracketMap() + '</div>';

  // Insert progress before the bracket map.
  var progressHtml = '';
  if (bracketViewMode === 'picks') {
    var progressPct = totalKoPicks > 0 ? Math.round((madeKoPicks / totalKoPicks) * 100) : 0;
    progressHtml = '<div class="bracket-progress"><div class="bracket-progress-bar"><div class="bracket-progress-fill" style="width:' + progressPct + '%"></div></div><span class="bracket-progress-label">' + madeKoPicks + '/' + totalKoPicks + ' knockout picks made</span></div>';
  } else {
    progressHtml = '';
  }
  html = html.replace('<div class="bracket-visual">', progressHtml + '<div class="bracket-visual">');

  el.innerHTML = html;

  // Event delegation (set once)
  if (!el._hasListener) {
    el._hasListener = true;
    el.addEventListener('click', function(e) {
      var teamOpen = e.target.closest('[data-team-open]');
      if (teamOpen) {
        var openName = teamOpen.getAttribute('data-team-open');
        if (openName && wcData.teams[openName]) openTeamModal(openName);
        return;
      }
      var sectionBtn = e.target.closest('[data-bracket-section]');
      if (sectionBtn) {
        bracketMobileSection = sectionBtn.getAttribute('data-bracket-section');
        bracketMobileSectionChosen = true;
        renderBracket();
        return;
      }
      var infoToggle = e.target.closest('[data-bracket-info-toggle]');
      if (infoToggle) {
        bracketInfoExpanded = !bracketInfoExpanded;
        renderBracket();
        return;
      }
      var modeBtn = e.target.closest('[data-bracket-mode]');
      if (modeBtn) {
        switchBracketMode(modeBtn.getAttribute('data-bracket-mode'));
        return;
      }
      // Group pick
      var teamDiv = e.target.closest('.bracket-team[data-idx]');
      if (teamDiv) {
        if (teamDiv.getAttribute('data-locked') === 'true') return;
        var i = parseInt(teamDiv.getAttribute('data-idx'));
        if (!isNaN(i) && window._bracketMap && window._bracketMap[i]) {
          pickGroup(window._bracketMap[i].g, window._bracketMap[i].t);
        }
        return;
      }
      // Knockout pick
      var koDiv = e.target.closest('.bracket-team[data-ko]');
      if (koDiv) {
        if (koDiv.classList.contains('locked') && bracketViewMode === 'live') return;
        var matchId = koDiv.getAttribute('data-ko');
        var teamName = koDiv.getAttribute('data-team');
        if (teamName && wcData.teams[teamName] && !isTeamEliminated(teamName)) {
          pickKnockout(matchId, teamName);
        }
        return;
      }
      // Reset button
      if (e.target.id === 'resetBtn' || e.target.closest('#resetBtn')) {
        resetBracket();
      }
    });
    el.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var teamOpen = e.target.closest('[data-team-open]');
      if (!teamOpen) return;
      e.preventDefault();
      var openName = teamOpen.getAttribute('data-team-open');
      if (openName && wcData.teams[openName]) openTeamModal(openName);
    });
  }
}

function pickGroup(letter, team) {
  var rows = (standingsData && standingsData[letter]) || [];
  var row = rows.find(function(candidate) { return candidate.t === team; });
  if (row && row.status && row.status.code === 'eliminated') return;
  var k1 = 'g_' + letter + '_1', k2 = 'g_' + letter + '_2', k3 = 'g_' + letter + '_3';
  var live1 = (function() {
    var winner = rows.find(function(candidate) { return candidate.status && candidate.status.code === 'won-group'; });
    return winner ? winner.t : (rows.length === 4 && rows.every(function(candidate) { return candidate.p === 3; }) ? rows[0].t : null);
  })();
  var live2 = rows.length === 4 && rows.every(function(candidate) { return candidate.p === 3; }) ? rows[1].t : null;
  var directLive3 = rows[2] && rows[2].status && rows[2].status.code === 'qualified-third' ? rows[2].t : null;
  var autoLive3 = null;
  if (!directLive3 && live1 && live2) {
    var remaining = rows.filter(function(candidate) {
      var code = candidate.status && candidate.status.code;
      return candidate.t !== live1 && candidate.t !== live2 && code !== 'eliminated';
    });
    autoLive3 = remaining.length === 1 ? remaining[0].t : null;
  }
  if (team === live1 || team === live2 || team === directLive3 || team === autoLive3) return;
  var available = [];
  if (!live1) available.push(k1);
  if (!live2) available.push(k2);
  if (!directLive3 && !autoLive3) available.push(k3);
  // Toggle: if already selected at a position, remove it
  if (bracketState[k1] === team) { delete bracketState[k1]; }
  else if (bracketState[k2] === team) { delete bracketState[k2]; }
  else if (bracketState[k3] === team) { delete bracketState[k3]; }
  else {
    var target = null;
    for (var i = 0; i < available.length; i++) {
      if (!bracketState[available[i]]) { target = available[i]; break; }
    }
    if (!target && available.length) target = available[available.length - 1];
    if (target) {
      rememberOriginalPick(target, team);
      bracketState[target] = team;
    }
  }
  saveBracketState();
  renderBracket();
}

function pickKnockout(matchId, team) {
  var eliminated = Object.keys((wcData && wcData.groups) || {}).some(function(letter) {
    var rows = (standingsData && standingsData[letter]) || [];
    var row = rows.find(function(candidate) { return candidate.t === team; });
    return row && row.status && row.status.code === 'eliminated';
  });
  if (eliminated) return;
  var key = 'ko_' + matchId;
  if (bracketState[key] === team) {
    delete bracketState[key];
  } else {
    rememberOriginalPick(key, team);
    bracketState[key] = team;
  }
  saveBracketState();
  renderBracket();
}

function resetBracket() {
  bracketState = {};
  bracketOriginalState = {};
  window._bracketMap = [];
  try { localStorage.removeItem('wc2026bracket'); } catch(e) {}
  try { localStorage.removeItem('wc2026bracketOriginal'); } catch(e) {}
  renderBracket();
}

function setStatsView(view) {
  statsView = view;
  document.querySelectorAll('.stats-view').forEach(function(panel) {
    panel.hidden = panel.getAttribute('data-stats-view') !== view;
  });
  document.querySelectorAll('.stats-tab').forEach(function(button) {
    var active = button.getAttribute('data-stats-tab') === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function setTeamStatsView(view) {
  teamStatsView = view;
  document.querySelectorAll('.team-stats-view').forEach(function(panel) {
    panel.hidden = panel.getAttribute('data-team-stats-view') !== view;
  });
  document.querySelectorAll('.team-stats-tab').forEach(function(button) {
    var active = button.getAttribute('data-team-stats-tab') === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function renderStats() {
  var el = document.getElementById('tab-stats');
  var live = (typeof statsData !== 'undefined' && statsData) ? statsData : {};
  var teamsIndex = getTeamsIndex();
  var overview = live.overview || { matchesPlayed: 0, goalsScored: 0, goalsPerMatch: 0, teams: 48, uniqueScorers: 0 };
  var scorers = live.topScorers || [];
  var timing = live.goalTiming || { buckets: [], timedGoals: 0, totalGoals: overview.goalsScored || 0, stoppageGoals: 0 };
  var teamLeaders = live.teamLeaders || { attack: [], defense: [], cleanSheets: [], form: [] };
  var patterns = live.matchPatterns || [];
  var groupGoals = live.groupGoals || [];
  var confStats = live.confStats || [];
  var records = live.records || [];
  var html = '<div class="stats-heading"><div><h2>Tournament Statistics</h2><p>Updated from completed matches</p></div></div>';

  html += '<div class="stats-tabs" role="tablist" aria-label="Statistics categories">';
  ['overview', 'players', 'teams', 'trends'].forEach(function(view) {
    var label = view.charAt(0).toUpperCase() + view.slice(1);
    html += '<button class="stats-tab' + (statsView === view ? ' active' : '') + '" type="button" role="tab" data-stats-tab="' + view + '" aria-selected="' + (statsView === view ? 'true' : 'false') + '" onclick="setStatsView(\'' + view + '\')">' + label + '</button>';
  });
  html += '</div>';

  html += '<section class="stats-view" data-stats-view="overview"' + (statsView === 'overview' ? '' : ' hidden') + '>';
  html += '<div class="stats-grid">';
  html += '<div class="stat-card"><div class="stat-val stat-val-accent">' + overview.matchesPlayed + '</div><div class="stat-lbl">Matches</div></div>';
  html += '<div class="stat-card"><div class="stat-val stat-val-green">' + overview.goalsScored + '</div><div class="stat-lbl">Goals</div></div>';
  html += '<div class="stat-card"><div class="stat-val stat-val-amber">' + Number(overview.goalsPerMatch || 0).toFixed(1) + '</div><div class="stat-lbl">Goals / match</div></div>';
  html += '<div class="stat-card"><div class="stat-val stat-val-pink">' + (overview.uniqueScorers || 0) + '</div><div class="stat-lbl">Scorers</div></div>';
  html += '</div>';

  html += '<div class="stats-section"><div class="stats-section-head"><h3>' + icon('barChart') + ' Tournament pulse</h3>';
  if (timing.totalGoals && timing.timedGoals < timing.totalGoals) html += '<span>' + timing.timedGoals + '/' + timing.totalGoals + ' timed goals</span>';
  html += '</div><div class="goal-timing" aria-label="Goals by match minute">';
  var maxTiming = Math.max.apply(null, timing.buckets.map(function(row) { return row.goals; }).concat([1]));
  timing.buckets.forEach(function(row) {
    var height = Math.max(4, Math.round((row.goals / maxTiming) * 100));
    html += '<div class="goal-time-col"><div class="goal-time-value">' + row.goals + '</div><div class="goal-time-track"><div class="goal-time-fill" style="height:' + height + '%"></div></div><div class="goal-time-label">' + esc(row.label) + '</div></div>';
  });
  html += '</div>';
  if (timing.buckets.length) html += '<p class="stats-insight">' + timing.stoppageGoals + ' goals have arrived in stoppage time.</p>';
  html += '</div>';

  html += '<div class="stats-section"><h3>' + icon('target') + ' Match patterns</h3><div class="pattern-grid">';
  patterns.forEach(function(row) {
    html += '<div class="pattern-item"><strong>' + row.value + '</strong><span>' + esc(row.label) + '</span></div>';
  });
  html += '</div></div>';

  if (records.length) {
    html += '<div class="stats-section"><h3>' + icon('award') + ' Records</h3><div class="record-list">';
    records.forEach(function(record) {
      html += '<div class="record-row"><strong>' + esc(record.label) + '</strong><span>' + esc(record.detail) + '</span></div>';
    });
    html += '</div></div>';
  }
  html += '</section>';

  html += '<section class="stats-view" data-stats-view="players"' + (statsView === 'players' ? '' : ' hidden') + '>';
  if (scorers.length) {
    var leader = scorers[0];
    var leaderFlag = teamsIndex[leader.t] && teamsIndex[leader.t].flag ? teamsIndex[leader.t].flag : '';
    html += '<div class="stats-section"><h3>' + icon('target') + ' Golden Boot race</h3>';
    html += '<div class="scorer-leader"><div class="scorer-rank">' + icon('trophy',{size:22}) + '</div><div><div class="scorer-name">' + esc(leader.n) + '</div><div class="scorer-team">' + leaderFlag + ' ' + esc(leader.t) + '</div><div class="scorer-leader-meta">Scored in ' + (leader.ms || 0) + ' matches</div></div><div class="scorer-goals-badge">' + leader.g + '</div></div>';
    html += '<table class="scorers-table"><thead><tr><th>#</th><th>Player</th><th>Matches</th><th>Goals</th></tr></thead><tbody>';
    scorers.slice(1).forEach(function(s, index) {
      var flag = teamsIndex[s.t] && teamsIndex[s.t].flag ? teamsIndex[s.t].flag : '';
      var detail = (s.multi || 0) ? s.multi + ' multi-goal' : (s.share || 0) + '% team goals';
      html += '<tr><td class="st-rank">' + (index + 2) + '</td><td><span class="st-name">' + esc(s.n) + '</span><br><span class="st-team">' + flag + ' ' + esc(s.t) + '<span class="st-insight"> · ' + detail + '</span></span></td><td class="st-matches">' + (s.ms || 0) + '</td><td class="st-goals">' + s.g + '</td></tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<p class="stats-empty">Player statistics will appear after completed matches.</p>';
  }
  html += '</section>';

  html += '<section class="stats-view" data-stats-view="teams"' + (statsView === 'teams' ? '' : ' hidden') + '>';
  html += '<div class="stats-section"><div class="subtabs" role="tablist" aria-label="Team statistics">';
  [['attack','Attack'],['defense','Defense'],['cleanSheets','Clean'],['form','Form']].forEach(function(item) {
    var teamTabLabel = item[0] === 'cleanSheets' ? 'Clean sheets' : item[1];
    html += '<button type="button" class="team-stats-tab' + (teamStatsView === item[0] ? ' active' : '') + '" data-team-stats-tab="' + item[0] + '" aria-label="' + teamTabLabel + '" aria-selected="' + (teamStatsView === item[0] ? 'true' : 'false') + '" onclick="setTeamStatsView(\'' + item[0] + '\')">' + item[1] + '</button>';
  });
  html += '</div>';
  [['attack','Goals'],['defense','Conceded'],['cleanSheets','Clean sheets'],['form','Record']].forEach(function(item) {
    var rows = teamLeaders[item[0]] || [];
    var maxValue = Math.max.apply(null, rows.map(function(row) { return item[0] === 'attack' ? row.gf : item[0] === 'defense' ? row.ga : item[0] === 'cleanSheets' ? row.cs : row.w * 3 + row.d; }).concat([1]));
    html += '<div class="team-stats-view" data-team-stats-view="' + item[0] + '"' + (teamStatsView === item[0] ? '' : ' hidden') + '><div class="leader-list">';
    rows.forEach(function(row, index) {
      var flag = teamsIndex[row.t] && teamsIndex[row.t].flag ? teamsIndex[row.t].flag : '';
      var value = item[0] === 'attack' ? row.gf : item[0] === 'defense' ? row.ga : item[0] === 'cleanSheets' ? row.cs : row.w * 3 + row.d;
      var display = item[0] === 'form' ? row.w + '-' + row.d + '-' + row.l : value;
      var width = item[0] === 'defense' ? Math.max(10, 100 - Math.round((value / maxValue) * 80)) : Math.round((value / maxValue) * 100);
      html += '<button class="leader-row" type="button" data-team="' + esc(row.t) + '" onclick="openTeamModal(this.getAttribute(\'data-team\'))"><span class="leader-rank">' + (index + 1) + '</span><span class="leader-team">' + flag + ' ' + esc(row.t) + '<small>' + row.p + ' played · ' + row.gf + ':' + row.ga + '</small></span><span class="leader-bar"><i style="width:' + width + '%"></i></span><strong>' + display + '</strong></button>';
    });
    html += '</div></div>';
  });
  html += '</div></section>';

  html += '<section class="stats-view" data-stats-view="trends"' + (statsView === 'trends' ? '' : ' hidden') + '>';
  if (groupGoals.length) {
    html += '<div class="stats-section"><h3>' + icon('barChart') + ' Group scoring rate</h3><div class="stat-bars">';
    var maxGroupRate = Math.max.apply(null, groupGoals.map(function(row) { return row.rate || (row.m ? row.goals / row.m : 0); })) || 1;
    groupGoals.forEach(function(row) {
      var rate = row.rate || (row.m ? row.goals / row.m : 0);
      var color = groupColors[row.g] || 'var(--accent)';
      html += '<div class="stat-bar-row"><span class="stat-bar-label" style="color:' + color + '">Grp ' + row.g + '</span><div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + Math.round((rate / maxGroupRate) * 100) + '%;background:' + color + '"></div></div><span class="stat-bar-val">' + rate.toFixed(1) + '</span></div>';
    });
    html += '</div><p class="stats-footnote">Goals per completed match</p></div>';
  }
  if (confStats.length) {
    html += '<div class="stats-section"><h3>' + icon('globe') + ' Confederation performance</h3><div class="conf-table-wrap"><table class="conf-table"><thead><tr><th>Confed.</th><th>W-D-L</th><th>GF</th><th>GA</th><th>GF / match</th></tr></thead><tbody>';
    confStats.forEach(function(row) {
      html += '<tr><td>' + esc(row.c) + '</td><td>' + (row.w || 0) + '-' + (row.d || 0) + '-' + (row.l || 0) + '</td><td>' + row.s + '</td><td>' + row.con + '</td><td>' + Number(row.rate || 0).toFixed(2) + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
  }
  html += '</section>';

  el.innerHTML = html;
}

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });


// === MATCHES DATA ===
// All times stored as ET, converted to PDT (ET - 3h) for display


function etToLocal(timeStr, matchDate) {
  // Convert ET time to user's local time using proper JS Date localization.
  // matchDate is optional (YYYY-MM-DD) for correct DST; defaults to a June date.
  var parts = timeStr.split(':');
  var etHour = parseInt(parts[0]);
  var etMin = parseInt(parts[1]);
  // EDT (June/July) = UTC-4. Convert to UTC.
  var utcHour = etHour + 4;
  var utcDay = 19; // Default June 19 (tournament date, ensures PDT)
  var utcMonth = 5; // June (0-indexed)
  var utcYear = 2026;
  if (matchDate) {
    var dp = matchDate.split('-');
    utcYear = parseInt(dp[0]);
    utcMonth = parseInt(dp[1]) - 1;
    utcDay = parseInt(dp[2]);
  }
  // Handle hour overflow (utcHour >= 24 means next day in UTC)
  if (utcHour >= 24) { utcHour -= 24; utcDay += 1; }
  var dt = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHour, etMin));
  // Use toLocaleTimeString for correct local conversion
  var localHour = dt.getHours();
  var localMin = dt.getMinutes();
  var ampm = localHour >= 12 ? 'PM' : 'AM';
  var h12 = localHour % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + String(localMin).padStart(2, '0') + ' ' + ampm;
}

function getLocalTzAbbrev() {
  try {
    return new Intl.DateTimeFormat('en-US', {timeZoneName:'short'}).formatToParts(new Date()).find(function(p){return p.type==='timeZoneName';}).value;
  } catch(e) { return 'Local'; }
}
var localTz = getLocalTzAbbrev();

function getNetworkInfo(net) {
  // Every match airs on multiple platforms simultaneously
  if (net === 'FOX') {
    return {
      primary: {cls:'net-fox', label:'FOX 📡', sub:'Free OTA'},
      all: [
        {cls:'net-fox', label:'FOX', icon:'📡', free:true},
        {cls:'net-tele', label:'Telemundo', icon:'🇪🇸📡', free:true},
        {cls:'net-stream', label:'FOX One', icon:'📱', free:false},
        {cls:'net-peacock', label:'Peacock', icon:'🇪🇸', free:false}
      ]
    };
  } else {
    return {
      primary: {cls:'net-fs1', label:'FS1 💰', sub:'Cable/Streaming'},
      all: [
        {cls:'net-fs1', label:'FS1', icon:'📺', free:false},
        {cls:'net-tele', label:'Telemundo', icon:'🇪🇸📡', free:true},
        {cls:'net-stream', label:'FOX One', icon:'📱', free:false},
        {cls:'net-peacock', label:'Peacock', icon:'🇪🇸', free:false}
      ]
    };
  }
}

function getLocalDateForMatch(m) {
  // Convert ET time to user's local calendar date using proper Date object.
  var parts = m.t.split(':');
  var etHour = parseInt(parts[0]);
  var etMin = parseInt(parts[1]);
  var utcHour = etHour + 4; // EDT (June/July) → UTC
  var dateParts = m.d.split('-');
  var utcDay = parseInt(dateParts[2]);
  var utcMonth = parseInt(dateParts[1]) - 1;
  var utcYear = parseInt(dateParts[0]);
  if (utcHour >= 24) { utcHour -= 24; utcDay += 1; }
  var dt = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHour, etMin));
  var y = dt.getFullYear();
  var mo = String(dt.getMonth() + 1).padStart(2, '0');
  var da = String(dt.getDate()).padStart(2, '0');
  return y + '-' + mo + '-' + da;
}

function getMatchDates() {
  var dates = [];
  matchesData.forEach(function(m) {
    var localDate = getLocalDateForMatch(m);
    if (dates.indexOf(localDate) < 0) dates.push(localDate);
  });
  return dates.sort();
}

function formatDatePill(dateStr) {
  var d = new Date(dateStr + 'T12:00:00');
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return { day: days[d.getDay()], date: months[d.getMonth()] + ' ' + d.getDate() };
}

function knockoutScheduleKey(m) {
  return [m.d, m.t, m.v].join('|');
}

function completedGroup(letter) {
  var rows = (standingsData && standingsData[letter]) || [];
  return rows.length === 4 && rows.every(function(row) { return row.p === 3; });
}

function liveGroupSeedForSlot(slot) {
  var pos = slot.charAt(0);
  var letter = slot.substring(1);
  var rows = (standingsData && standingsData[letter]) || [];
  if (!rows.length) return null;
  if (pos === '1') {
    var winner = rows.find(function(row) { return row.status && row.status.code === 'won-group'; });
    if (winner) return winner.t;
    return completedGroup(letter) ? rows[0].t : null;
  }
  if (pos === '2') return completedGroup(letter) ? rows[1].t : null;
  return null;
}

function liveThirdPlaceForMatch(matchId) {
  var row = Array.isArray(thirdPlaceData) ? thirdPlaceData.find(function(candidate) {
    return candidate.path && candidate.path.match === matchId;
  }) : null;
  return row && row.t ? row.t : null;
}

function resolveLiveKnockoutSlot(slot, matchId, outcomes) {
  if (slot.indexOf('W ') === 0) return outcomes.winners[slot.substring(2)] || slot;
  if (slot.indexOf('L ') === 0) return outcomes.losers[slot.substring(2)] || slot;
  if (slot.charAt(0) === '3') return liveThirdPlaceForMatch(matchId) || slot;
  if (/^[12][A-L]$/.test(slot)) return liveGroupSeedForSlot(slot) || slot;
  return slot;
}

function liveKnockoutOutcomes() {
  var outcomes = {winners:{}, losers:{}};
  KnockoutBracket.matches.forEach(function(match) {
    var home = resolveLiveKnockoutSlot(match.h, match.id, outcomes);
    var away = resolveLiveKnockoutSlot(match.a, match.id, outcomes);
    var result = knockoutScoreOutcome(home, away);
    if (result.winner) outcomes.winners[match.id] = result.winner;
    if (result.loser) outcomes.losers[match.id] = result.loser;
  });
  return outcomes;
}

function liveKnockoutWinners() {
  return liveKnockoutOutcomes().winners;
}

function liveKnockoutTeamsForMatch(m) {
  if (!m.stage) return {h: m.h, a: m.a};
  var match = KnockoutBracket.bySchedule[knockoutScheduleKey(m)];
  if (!match) return {h: m.h, a: m.a};
  var outcomes = liveKnockoutOutcomes();
  var home = resolveLiveKnockoutSlot(match.h, match.id, outcomes);
  var away = resolveLiveKnockoutSlot(match.a, match.id, outcomes);
  return {
    h: wcData.teams[home] ? home : m.h,
    a: wcData.teams[away] ? away : m.a,
  };
}


function renderMatches() {
  var el = document.getElementById('tab-matches');
  var existingDateNav = document.getElementById('dateNav');
  var previousDateScroll = existingDateNav ? existingDateNav.scrollLeft : null;
  var dates = getMatchDates();
  var now = new Date();
  var today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  // Auto-select today or nearest upcoming match day
  if (selectedMatchDate === '2026-06-11' || dates.indexOf(selectedMatchDate) < 0) {
    if (dates.indexOf(today) >= 0) {
      selectedMatchDate = today;
    } else {
      var future = dates.filter(function(d) { return d >= today; });
      if (future.length > 0) selectedMatchDate = future[0];
      else selectedMatchDate = dates[0];
    }
  }

  // Download calendar button + Date nav pills
  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><button class="today-btn" onclick="jumpToToday()">Today</button><a href="world-cup-2026-schedule.ics" download class="cal-download-btn">' + icon('calendar',{size:15}) + ' Add All Matches to Calendar</a></div>';
  html += '<div class="date-nav" id="dateNav" role="group" aria-label="Match dates">';
  dates.forEach(function(dateStr) {
    var info = formatDatePill(dateStr);
    var matchCount = matchesData.filter(function(m){return getLocalDateForMatch(m)===dateStr;}).length;
    var isToday = dateStr === today;
    var isActive = dateStr === selectedMatchDate;
    var dateLabel = info.day + ', ' + info.date + ', ' + matchCount + ' game' + (matchCount>1?'s':'');
    html += '<button type="button" class="date-pill' + (isActive?' active':'') + (isToday?' today':'') + '" data-date="' + dateStr + '" aria-pressed="' + isActive + '" aria-label="' + dateLabel + '" onclick="selectMatchDate(\'' + dateStr + '\')">';
    html += '<div class="dp-day">' + info.day + '</div>';
    html += '<div class="dp-date">' + info.date.split(' ')[1] + '</div>';
    html += '<div class="dp-count">' + matchCount + ' game' + (matchCount>1?'s':'') + '</div>';
    html += '</button>';
  });
  html += '</div>';

  // Match cards for selected date
  var dayMatches = matchesData.filter(function(m){return getLocalDateForMatch(m)===selectedMatchDate;});
    // Sort by kickoff time (treat midnight 00:00 as end-of-day, not start)
    dayMatches.sort(function(a, b) {
      var tA = parseInt(a.t.split(':')[0]);
      var tB = parseInt(b.t.split(':')[0]);
      // Midnight (0) and very early hours (before 6 AM) are late-night games, sort last
      if (tA < 6) tA += 24;
      if (tB < 6) tB += 24;
      return tA - tB;
    });
  var dateInfo = formatDatePill(selectedMatchDate);

  var dateTransitionClass = matchDateTransitionDirection ? ' match-day-enter-' + matchDateTransitionDirection : '';
  html += '<div class="match-day-content' + dateTransitionClass + '">';
  html += '<h2 style="font-size:1.1rem;margin-bottom:14px;color:var(--text-sec)">' + dateInfo.day + ', ' + dateInfo.date.split(' ')[0] + ' ' + dateInfo.date.split(' ')[1] + '</h2>';

  if (dayMatches.length === 0) {
    html += '<div class="no-matches">No matches scheduled for this date</div>';
  } else {
    html += '<div class="match-list">';
    dayMatches.forEach(function(m) {
      var displayTeams = liveKnockoutTeamsForMatch(m);
      var homeName = displayTeams.h;
      var awayName = displayTeams.a;
      var pdt = etToLocal(m.t, m.d);
      var gc = groupColors[m.g] || '#a78bfa';
      var hFlag = wcData.teams[homeName] ? wcData.teams[homeName].flag : '';
      var aFlag = wcData.teams[awayName] ? wcData.teams[awayName].flag : '';
      var isKnockout = m.stage;
      var hClick = wcData.teams[homeName] ? ' data-team="' + homeName + '" style="cursor:pointer"' : '';
      var aClick = wcData.teams[awayName] ? ' data-team="' + awayName + '" style="cursor:pointer"' : '';

      html += '<div class="match-card">';
      // Header: meta info + venue inline (FotMob/Apple Sports pattern)
      html += '<div class="mc-header">';
      if (isKnockout) {
        html += '<span class="mc-stage-label">' + m.stage + '</span>';
      } else {
        var mdLabel = m.matchday ? ' · <span class="mc-matchday">MD' + m.matchday + '</span>' : '';
        html += '<span class="mc-meta"><span class="mc-group-tag" style="color:' + gc + '">Group ' + m.g + '</span>' + mdLabel + '</span>';
      }
      html += '<span class="mc-countdown">' + pdt + ' ' + localTz + '</span>';
      html += '</div>';
      // Venue line — always visible, compact
      if (m.v) {
        html += '<div class="mc-venue-line">' + m.v + '</div>';
      }
      // Body: teams centered
      html += '<div class="mc-body">';
      html += '<div class="mc-team mc-team-home"' + hClick + '><span class="mc-name">' + homeName + '</span><span class="mc-flag">' + hFlag + '</span></div>';
      var predKey = homeName + '_' + awayName;
      var scorePred = (typeof scorePredictions !== 'undefined' && scorePredictions[predKey]) ? scorePredictions[predKey] : null;
      var actual = (typeof actualScores !== 'undefined' && actualScores[predKey]) ? actualScores[predKey] : null;
      if (actual) {
        // Completed match: show actual score prominently, prediction below
        var hasPenaltyScore = Number.isInteger(actual.hp) && actual.hp >= 0 &&
          Number.isInteger(actual.ap) && actual.ap >= 0 && actual.hp !== actual.ap;
        html += '<div class="mc-score"><div>';
        html += '<div class="mc-actual-score">' + actual.h + ' - ' + actual.a + '</div>';
        html += '<div class="mc-score-status">FT</div>';
        if (hasPenaltyScore) {
          html += '<div class="mc-pen-score" aria-label="Penalty shootout: ' + actual.hp + ' to ' + actual.ap + '">Pens ' + actual.hp + ' - ' + actual.ap + '</div>';
        }
        if (scorePred) html += '<div class="mc-pred-small">Pred: ' + scorePred.h + '-' + scorePred.a + '</div>';
        html += '</div></div>';
      } else if (scorePred && !isKnockout) {
        html += '<div class="mc-score"><div>';
        html += '<div class="mc-pred-label">PRED</div>';
        html += '<div class="mc-pred-score">' + scorePred.h + ' - ' + scorePred.a + '</div>';
        html += '<div class="mc-xg">xG ' + scorePred.xgH + ' - ' + scorePred.xgA + '</div>';
        html += '</div></div>';
      } else {
        html += '<div class="mc-score"><div><div class="mc-time-center">—  :  —</div></div></div>';
      }
      html += '<div class="mc-team mc-team-away"' + aClick + '><span class="mc-flag">' + aFlag + '</span><span class="mc-name">' + awayName + '</span></div>';
      html += '</div>';
      // Scorers row for finished matches
      if (actual && (actual.hs || actual.as)) {
        html += '<div class="mc-scorers">';
        html += '<div class="mc-scorers-home">' + (actual.hs ? actual.hs.map(function(s) { return esc(s); }).join('<br>') : '') + '</div>';
        html += '<div class="mc-scorers-away">' + (actual.as ? actual.as.map(function(s) { return esc(s); }).join('<br>') : '') + '</div>';
        html += '</div>';
      }
      // Collapsible details: prediction + broadcast
      var hasDetails = (!isKnockout && teamStrength[m.h] && teamStrength[m.a]) || m.net;
      if (hasDetails) {
        html += '<div class="mc-details">';
        // Prediction bar (only for group stage matches)
        if (!isKnockout && teamStrength[m.h] && teamStrength[m.a]) {
          var pred = getMatchPrediction(m.h, m.a);
          html += '<div class="mc-pred">';
          html += '<div class="pred-bar">';
          html += '<div class="pred-seg pred-home" style="width:' + pred.h + '%"><span>' + pred.h + '%</span></div>';
          html += '<div class="pred-seg pred-draw" style="width:' + pred.d + '%"><span>' + pred.d + '%</span></div>';
          html += '<div class="pred-seg pred-away" style="width:' + pred.a + '%"><span>' + pred.a + '%</span></div>';
          html += '</div>';
          html += '<div class="pred-label">Win probability · Elo-Poisson model</div>';
          html += '</div>';
        }
        // Broadcast + capacity
        html += '<div class="mc-footer">';
        if (m.capacity) html += '<span class="mc-capacity">' + icon('stadium',{size:13}) + ' ' + m.capacity.toLocaleString() + '</span>';
        html += '<div class="mc-broadcast">';
        if (m.net === 'FOX') {
          html += '<span class="bc-tag bc-free">FOX</span><span class="bc-tag bc-free">TMD</span>';
        } else {
          html += '<span class="bc-tag bc-paid">FS1</span><span class="bc-tag bc-free">TMD</span>';
        }
        html += '</div></div>';
        html += '</div>';
        html += '<button class="mc-expand-btn" onclick="toggleMatchDetails(this)" aria-label="Show details"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;
  matchDateTransitionDirection = '';

  // Preserve the user's strip position during adjacent browsing. Only explicit
  // jumps center the selected date; initial deep links center without animation.
  requestAnimationFrame(function() {
    var nav = document.getElementById('dateNav');
    var active = nav && nav.querySelector('.date-pill.active');
    if (!nav || !active) return;
    if (previousDateScroll !== null && !centerDateNavAfterRender) {
      nav.scrollLeft = previousDateScroll;
    } else {
      var target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
      target = Math.max(0, Math.min(target, nav.scrollWidth - nav.clientWidth));
      if (centerDateNavAfterRender && previousDateScroll !== null) {
        nav.scrollLeft = previousDateScroll;
        animateDateNavTo(nav, target);
      } else {
        nav.scrollLeft = target;
      }
    }
    centerDateNavAfterRender = false;
  });

  // Event delegation for match team clicks
  if (!el._hasMatchListener) {
    el._hasMatchListener = true;
    el.addEventListener('click', function(e) {
      var teamEl = e.target.closest('.mc-team[data-team]');
      if (teamEl) {
        openTeamModal(teamEl.dataset.team);
      }
    });
  }
}

function selectMatchDate(dateStr) {
  selectedMatchDate = dateStr;
  renderMatches();
  history.replaceState(null, '', '#matches/' + dateStr);
}

function animateDateNavTo(nav, target) {
  var start = nav.scrollLeft;
  var distance = target - start;
  if (Math.abs(distance) < 1 || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    nav.scrollLeft = target;
    return;
  }
  var startedAt = performance.now();
  var duration = Math.min(480, Math.max(280, Math.abs(distance) * 0.7));
  function frame(now) {
    var progress = Math.min(1, (now - startedAt) / duration);
    var eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    nav.scrollLeft = start + distance * eased;
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function jumpToToday() {
  var now = new Date();
  var y = now.getFullYear();
  var mo = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  var today = y + '-' + mo + '-' + d;
  var dates = getMatchDates();
  var target = today;
  if (dates.indexOf(target) < 0) {
    var upcoming = dates.filter(function(date) { return date > today; });
    target = upcoming.length ? upcoming[0] : dates[dates.length - 1];
  }
  if (target > selectedMatchDate) matchDateTransitionDirection = 'forward';
  else if (target < selectedMatchDate) matchDateTransitionDirection = 'backward';
  else matchDateTransitionDirection = '';
  centerDateNavAfterRender = true;
  selectMatchDate(target);
}



// Theme management
// Theme: 3-way cycle (system / light / dark)
var themePreference = 'system';
try { var _tp = localStorage.getItem('wc2026-theme'); if (_tp) themePreference = _tp; } catch(e) {}

function getSystemTheme() {
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
}

function getEffectiveTheme() {
  return themePreference === 'system' ? getSystemTheme() : themePreference;
}

function applyTheme() {
  var effective = getEffectiveTheme();
  document.documentElement.setAttribute('data-theme', effective);
  document.documentElement.setAttribute('data-theme-pref', themePreference);
  var btn = document.getElementById('themeBtn');
  if (btn) {
    var order = ['system', 'light', 'dark'];
    var next = order[(order.indexOf(themePreference) + 1) % order.length];
    var label = 'Appearance: ' + themePreference + '. Switch to ' + next;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function cycleTheme() {
  var order = ['system', 'light', 'dark'];
  var idx = order.indexOf(themePreference);
  themePreference = order[(idx + 1) % 3];
  try { localStorage.setItem('wc2026-theme', themePreference); } catch(e) {}
  applyTheme();
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function() {
    if (themePreference === 'system') applyTheme();
  });
}

applyTheme();

function migrateLegacyBracketMatchIds(state) {
  var aliases = {
    R16_0:'M90', R16_1:'M89', R16_2:'M91', R16_3:'M92',
    R16_4:'M93', R16_5:'M94', R16_6:'M95', R16_7:'M96',
    QF_0:'M97', QF_1:'M98', QF_2:'M99', QF_3:'M100',
    SF_0:'M101', SF_1:'M102', FINAL:'M104'
  };
  var changed = false;
  Object.keys(aliases).forEach(function(oldId) {
    var oldKey = 'ko_' + oldId;
    var newKey = 'ko_' + aliases[oldId];
    if (state[oldKey] && !state[newKey]) state[newKey] = state[oldKey];
    if (state[oldKey]) {
      delete state[oldKey];
      changed = true;
    }
  });
  return changed;
}

// Load bracket state once from localStorage (if available)
try { var saved = localStorage.getItem('wc2026bracket'); if (saved) bracketState = JSON.parse(saved); } catch(e) {}
try { var savedOriginal = localStorage.getItem('wc2026bracketOriginal'); if (savedOriginal) bracketOriginalState = JSON.parse(savedOriginal); } catch(e) {}
try { var savedMode = localStorage.getItem('wc2026bracketMode'); if (savedMode === 'picks' || savedMode === 'live') bracketViewMode = savedMode; } catch(e) {}
if (migrateLegacyBracketMatchIds(bracketState)) saveBracketState();
if (migrateLegacyBracketMatchIds(bracketOriginalState)) saveBracketOriginalState();
if (Object.keys(bracketState || {}).length && !Object.keys(bracketOriginalState || {}).length) {
  bracketOriginalState = Object.assign({}, bracketState);
  saveBracketOriginalState();
}


// === ASYNC INITIALIZATION ===
var DATA_CACHE_KEY = 'wc26-data-cache';
var currentDataVersion = null;
var currentDataMeta = null;
var lastFreshCheckAt = 0;
var foregroundRefreshTimer = null;
var refreshInFlight = null;
var freshDataAbortController = null;
var lifecycleReady = false;

function dynamicMatchCount(data) {
  if (!data) return 0;
  if (data.statsData && data.statsData.overview && typeof data.statsData.overview.matchesPlayed === 'number') {
    return data.statsData.overview.matchesPlayed;
  }
  return data.actualScores ? Object.keys(data.actualScores).length : 0;
}

function applyDynamicData(data, meta) {
  if (!data || !isValidBootstrapData(data)) return false;
  var incomingVersion = meta && meta.dataVersion;
  var repairsThirdPlacePath = !isValidThirdPlaceData(thirdPlaceData) && isValidThirdPlaceData(data.thirdPlaceData);
  if (incomingVersion && currentDataVersion && incomingVersion === currentDataVersion && !repairsThirdPlacePath) {
    currentDataMeta = meta;
    return false;
  }
  var incomingCount = dynamicMatchCount(data);
  var currentCount = Math.max(
    actualScores ? Object.keys(actualScores).length : 0,
    statsData && statsData.overview && typeof statsData.overview.matchesPlayed === 'number' ? statsData.overview.matchesPlayed : 0
  );

  // Never let the bundled/static fallback or an older SW cache roll the PWA
  // backward after it has seen newer live data.
  if (incomingCount < currentCount) return false;

  actualScores = data.actualScores || actualScores;
  standingsData = data.standingsData || standingsData;
  if (data.thirdPlaceData && isValidThirdPlaceData(data.thirdPlaceData)) thirdPlaceData = data.thirdPlaceData;
  statsData = data.statsData || statsData;
  if (incomingVersion) currentDataVersion = incomingVersion;
  if (meta) currentDataMeta = meta;
  return true;
}

function cacheDynamicData() {
  try {
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
      actualScores: actualScores,
      standingsData: standingsData,
      thirdPlaceData: thirdPlaceData,
      statsData: statsData,
      dataVersion: currentDataVersion,
      dataMeta: currentDataMeta,
      savedAt: new Date().toISOString()
    }));
  } catch(e) {}
}

function assignDataGlobals(data) {
  wcData = { groups: data.groups, teams: data.teams };
  jerseyNumbers = data.jerseyNumbers;
  matchesData = data.matchesData;
  scorePredictions = data.scorePredictions;
  teamStrength = data.teamStrength;
  eloRatings = data.eloRatings;
  injuryIntel = data.injuryIntel;
  actualScores = data.actualScores || {};
  standingsData = data.standingsData || {};
  thirdPlaceData = data.thirdPlaceData || [];
  statsData = data.statsData || null;
  currentDataVersion = data.dataVersion || currentDataVersion;
  currentDataMeta = data.dataMeta || currentDataMeta;
  bracketVenues = data.bracketVenues;
  groupColors = data.groupColors;
  modelPredictions = data.modelPredictions;
}

function showReadyUI() {
  var skeleton = document.getElementById('loading-skeleton');
  if (skeleton) skeleton.remove();
  var container = document.querySelector('.container');
  if (container) container.classList.remove('loading');
  var groupsEl = document.getElementById('tab-groups');
  if (groupsEl) groupsEl.classList.remove('shell-loading');
}

function showUpdatingIndicator() {
  // Show "Updating…" and keep it visible until the fetch completes (cancel any
  // pending auto-hide so it doesn't disappear mid-refresh).
  if (updatedAgoHideTimer) clearTimeout(updatedAgoHideTimer);
  var el = document.getElementById('updatedAgo');
  if (el) { el.textContent = 'Updating\u2026'; el.classList.add('visible'); }
}

function hideUpdatingIndicator(changed) {
  if (changed) {
    showUpdatedAgo();
  } else {
    var el = document.getElementById('updatedAgo');
    if (el) el.classList.remove('visible');
  }
}

function renderActiveTab() {
  var hash = window.location.hash.replace('#', '');
  if (hash) {
    var parts = hash.split('/');
    var tab = parts[0];
    var validTabs = ['matches', 'bracket', 'groups', 'stats'];
    if (validTabs.indexOf(tab) >= 0) {
      var btns = document.querySelectorAll('.nav-tab');
      btns.forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
      document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
      document.getElementById('tab-' + tab).classList.add('active');
      document.body.setAttribute('data-active-tab', tab);
      if (tab === 'matches' && parts[1]) selectedMatchDate = parts[1];
      renderedTabs[tab] = true;
      try {
        if (tab === 'groups') renderGroups();
        else if (tab === 'matches') renderMatches();
        else if (tab === 'bracket') renderBracket();
        else if (tab === 'stats') renderStats();
      } catch(e) { console.error('Error rendering ' + tab + ':', e); }
      renderMatchStrip();
      return;
    }
  }
  switchTab('matches');
  renderMatchStrip();
}

function refreshActiveTab() {
  var activeTab = document.body.getAttribute('data-active-tab');
  if (!activeTab) {
    var activeEl = document.querySelector('.tab-content.active');
    if (activeEl) activeTab = activeEl.id.replace('tab-', '');
  }
  if (activeTab) {
    renderedTabs[activeTab] = false;
    ensureTabRendered(activeTab);
  }
  renderMatchStrip();
}

async function fetchFreshData(options) {
  options = options || {};
  if (document.hidden && !options.allowHidden) return { skipped: true };
  var data = null, meta = null, notModified = false;
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  freshDataAbortController = controller;
  try {
    var headers = {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    if (currentDataVersion) headers['If-None-Match'] = '"' + currentDataVersion + '"';
    var resp = await fetch('/api/data', {
      cache: 'reload',
      headers: headers,
      signal: controller ? controller.signal : undefined
    });
    if (resp.status === 304) {
      lastFreshCheckAt = Date.now();
      return { data: null, meta: currentDataMeta, notModified: true };
    }
    if (resp.ok) {
      var livePayload = await resp.json();
      meta = livePayload && livePayload.meta ? livePayload.meta : null;
      data = livePayload && livePayload.data ? livePayload.data : livePayload;
      if (!isValidBootstrapData(data)) data = null;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return { aborted: true };
  } finally {
    if (freshDataAbortController === controller) freshDataAbortController = null;
  }
  if (document.hidden && !options.allowHidden) return { skipped: true };
  if (!data) {
    var fallbackResp = await fetch('data.json');
    if (fallbackResp.ok) {
      data = await fallbackResp.json();
    }
  }
  lastFreshCheckAt = Date.now();
  return { data: data, meta: meta, notModified: notModified };
}

function foregroundRefreshIntervalMs() {
  var seconds = currentDataMeta && Number(currentDataMeta.nextRefreshSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 900;
  return Math.max(120000, Math.min(seconds * 1000, 1800000));
}

function shouldCheckFreshData(force) {
  if (force) return true;
  return Date.now() - lastFreshCheckAt >= foregroundRefreshIntervalMs();
}

async function refreshFreshData(reason, options) {
  options = options || {};
  if (!shouldCheckFreshData(options.force)) return false;
  if (refreshInFlight) return refreshInFlight;
  if (options.showIndicator) showUpdatingIndicator();
  refreshInFlight = fetchFreshData(options).then(function(payload) {
    if (!payload || payload.notModified || !payload.data || !isValidBootstrapData(payload.data)) return false;
    if (applyDynamicData(payload.data, payload.meta)) {
      refreshActiveTab();
      cacheDynamicData();
      if (options.toast !== false) showUpdatedAgo();
      return true;
    }
    return false;
  }).catch(function() {
    return false;
  }).then(function(changed) {
    if (options.showIndicator) hideUpdatingIndicator(changed);
    refreshInFlight = null;
    scheduleForegroundRefresh();
    return changed;
  });
  return refreshInFlight;
}

function scheduleForegroundRefresh() {
  if (foregroundRefreshTimer) {
    clearTimeout(foregroundRefreshTimer);
    foregroundRefreshTimer = null;
  }
  if (document.hidden) return;
  foregroundRefreshTimer = setTimeout(function() {
    refreshFreshData('timer', { showIndicator: false, toast: true });
  }, foregroundRefreshIntervalMs());
}

function resumeForegroundWork(reason) {
  if (!lifecycleReady || document.hidden) return;
  if (shouldCheckFreshData(false)) {
    refreshFreshData(reason, { showIndicator: false, toast: true });
  } else {
    scheduleForegroundRefresh();
  }
}

function suspendBackgroundWork() {
  if (foregroundRefreshTimer) {
    clearTimeout(foregroundRefreshTimer);
    foregroundRefreshTimer = null;
  }
  if (freshDataAbortController) {
    freshDataAbortController.abort();
    freshDataAbortController = null;
  }
}

async function init() {
  // Step 1: Load static data synchronously from inline <script> tag
  // This is available instantly — no network needed
  var staticEl = document.getElementById('static-data');
  var staticData = null;
  if (staticEl) {
    try { staticData = JSON.parse(staticEl.textContent); } catch(e) {}
  }

  // Step 2: If we have static data, render immediately with it
  if (staticData && isValidBootstrapData(staticData)) {
    // Merge any cached dynamic data from localStorage
    var cachedDynamic = null;
    try {
      var raw = localStorage.getItem(DATA_CACHE_KEY);
      if (raw) cachedDynamic = JSON.parse(raw);
    } catch(e) {}
    if (cachedDynamic && !isUsableDynamicCache(cachedDynamic)) {
      cachedDynamic = null;
      try { localStorage.removeItem(DATA_CACHE_KEY); } catch(e) {}
    }

    // Apply static data as the base
    assignDataGlobals(staticData);

    // Overlay cached dynamic data if available
    if (cachedDynamic) {
      if (cachedDynamic.actualScores) actualScores = cachedDynamic.actualScores;
      if (cachedDynamic.standingsData) standingsData = cachedDynamic.standingsData;
      if (cachedDynamic.thirdPlaceData && isValidThirdPlaceData(cachedDynamic.thirdPlaceData)) thirdPlaceData = cachedDynamic.thirdPlaceData;
      if (cachedDynamic.statsData) statsData = cachedDynamic.statsData;
      if (cachedDynamic.dataVersion) currentDataVersion = cachedDynamic.dataVersion;
      if (cachedDynamic.dataMeta) currentDataMeta = cachedDynamic.dataMeta;
    }

    showReadyUI();
    renderActiveTab();
    showUpdatingIndicator();

    // Step 3: Fetch fresh dynamic data in background
    var changedOnInit = false;
    try {
      var freshPayload = await fetchFreshData({ force: true });
      var freshData = freshPayload && freshPayload.data;
      if (freshData && isValidBootstrapData(freshData)) {
        if (applyDynamicData(freshData, freshPayload.meta)) {
          refreshActiveTab();
          cacheDynamicData();
          changedOnInit = true;
        }
      }
    } catch(e) {}
    hideUpdatingIndicator(changedOnInit);
    scheduleForegroundRefresh();
  } else {
    // Fallback: no inline static data (shouldn't happen in production)
    // Try localStorage full cache, then network
    var cachedData = null;
    try {
      var raw2 = localStorage.getItem(DATA_CACHE_KEY);
      if (raw2) cachedData = JSON.parse(raw2);
    } catch(e) {}
    if (cachedData && !isUsableDynamicCache(cachedData)) {
      cachedData = null;
      try { localStorage.removeItem(DATA_CACHE_KEY); } catch(e) {}
    }

    if (cachedData && isValidBootstrapData(cachedData)) {
      assignDataGlobals(cachedData);
      showReadyUI();
      renderActiveTab();
    } else {
      try {
        var payload = await fetchFreshData({ force: true });
        var data = payload && payload.data;
        if (!data) throw new Error('No data available');
        assignDataGlobals(data);
        if (payload.meta) currentDataMeta = payload.meta;
        if (payload.meta && payload.meta.dataVersion) currentDataVersion = payload.meta.dataVersion;
        try { localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(data)); } catch(e) {}
      } catch(e) {
        console.error('Failed to load data:', e);
        document.body.innerHTML = '<div style="text-align:center;padding:4rem 1rem;color:var(--text)"><h2>Failed to load data</h2><p>Please refresh the page.</p></div>';
        return;
      }
      showReadyUI();
      renderActiveTab();
      scheduleForegroundRefresh();
    }
  }
}

// Attach click listener to group shell immediately (before data loads)
// so team modals work while standings are still loading
(function() {
  var el = document.getElementById('tab-groups');
  if (el && !el._hasTeamListener) {
    el._hasTeamListener = true;
    el.addEventListener('click', function(e) {
      var row = e.target.closest('.standings-row[data-team], .third-place-row[data-team]');
      if (row && row.dataset.team) {
        if (typeof wcData !== 'undefined' && wcData && wcData.teams && wcData.teams[row.dataset.team]) {
          openTeamModal(row.dataset.team);
        } else {
          // Data not loaded yet — show brief loading state in modal
          var modalEl = document.getElementById('modalContent');
          if (modalEl) {
            modalEl.innerHTML = '<div class="modal-hero" style="--gc:#6366f1"><button class="modal-close" onclick="closeModal()" aria-label="Back">' + icon('arrowLeft',{size:18}) + '</button></div>' +
              '<div style="text-align:center;padding:3rem 1rem;color:var(--text-muted)">' +
              '<div class="modal-spinner"></div>' +
              '<p>Loading ' + row.dataset.team + ' details…</p></div>';
            document.getElementById('modal').classList.add('visible');
            document.body.style.overflow = 'hidden';
            // Re-open once data arrives
            var checkInterval = setInterval(function() {
              if (typeof wcData !== 'undefined' && wcData && wcData.teams && wcData.teams[row.dataset.team]) {
                clearInterval(checkInterval);
                openTeamModal(row.dataset.team);
              }
            }, 200);
            // Give up after 10s
            setTimeout(function() { clearInterval(checkInterval); }, 10000);
          }
        }
      }
    });
  }
})();

init().then(function() { lifecycleReady = true; }).catch(function() { lifecycleReady = true; });

document.addEventListener('visibilitychange', function() {
  if (document.hidden) suspendBackgroundWork();
  else resumeForegroundWork('visible');
});
window.addEventListener('pageshow', function() { resumeForegroundWork('pageshow'); });

// === STALE-WHILE-REVALIDATE: Listen for fresh data from service worker ===
if ('serviceWorker' in navigator && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'DATA_UPDATED') {
      refreshFreshData('service-worker', { force: true, showIndicator: false, toast: true }).catch(function() {});
    }
  });
}
