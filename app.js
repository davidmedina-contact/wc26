// FIFA World Cup 2026 Guide - Application Logic
// Data is loaded asynchronously from the serverless bootstrap endpoint

var wcData, jerseyNumbers, matchesData, scorePredictions, teamStrength,
    eloRatings, injuryIntel, actualScores, standingsData, bracketVenues,
    groupColors, modelPredictions;
var statsData, thirdPlaceData;

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
var selectedMatchDate = '2026-06-11';

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

function toggleBracketInfo() {
  var grid = document.getElementById('bracketGrid');
  var toggleBtn = document.querySelector('.bracket-info-toggle');
  if (!grid || !toggleBtn) return;
  var isCollapsed = grid.classList.toggle('collapsed');
  toggleBtn.setAttribute('aria-pressed', String(!isCollapsed));
  toggleBtn.innerHTML = (isCollapsed
    ? icon('arrowDown',{size:12}) + ' Show controls<span class="icon">▼</span>'
    : icon('arrowUp',{size:12}) + ' Hide controls<span class="icon">▼</span>');
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
  if (btn) btn.classList.add('active');
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

  // Team matches section — FotMob-style fixtures list
  var teamMatches = matchesData.filter(function(m) { return m.h === teamName || m.a === teamName; });
  if (teamMatches.length > 0) {
    // Sort by date
    teamMatches.sort(function(a, b) { return a.d.localeCompare(b.d) || a.t.localeCompare(b.t); });
    var completedMatches = [];
    var upcomingMatches = [];
    teamMatches.forEach(function(m) {
      var key = m.h + '_' + m.a;
      var score = (typeof actualScores !== 'undefined' && actualScores[key]) ? actualScores[key] : null;
      if (score && score.status === 'FT') completedMatches.push(m);
      else upcomingMatches.push(m);
    });

    el.innerHTML += '<div class="modal-section"><h3 style="color:' + gc + ';border-color:' + gc + '">' + icon('calendar') + ' Fixtures</h3><div class="modal-matches">';

    // Completed matches
    if (completedMatches.length > 0) {
      el.innerHTML += '<div class="mmr-section-label">Results</div>';
      completedMatches.forEach(function(m) {
        var key = m.h + '_' + m.a;
        var score = actualScores[key];
        var dateInfo = formatDatePill(m.d);
        var hFlag = wcData.teams[m.h] ? wcData.teams[m.h].flag : '';
        var aFlag = wcData.teams[m.a] ? wcData.teams[m.a].flag : '';
        var hGoals = parseInt(score.h), aGoals = parseInt(score.a);
        var result = '';
        if (m.h === teamName) result = hGoals > aGoals ? 'w' : hGoals < aGoals ? 'l' : 'd';
        else result = aGoals > hGoals ? 'w' : aGoals < hGoals ? 'l' : 'd';

        el.innerHTML += '<div class="mmr-row mmr-result-' + result + '" onclick="goToMatch(\'' + m.d + '\')">' +
          '<div class="mmr-dot"></div>' +
          '<div class="mmr-date">' + dateInfo.day + ' ' + dateInfo.date + '</div>' +
          '<div class="mmr-home">' + m.h + ' ' + hFlag + '</div>' +
          '<div class="mmr-center">' + score.h + ' - ' + score.a + '</div>' +
          '<div class="mmr-away">' + aFlag + ' ' + m.a + '</div>' +
        '</div>';
      });
    }

    // Upcoming matches
    if (upcomingMatches.length > 0) {
      el.innerHTML += '<div class="mmr-section-label">Upcoming</div>';
      upcomingMatches.forEach(function(m) {
        var pdt = etToLocal(m.t, m.d);
        var dateInfo = formatDatePill(m.d);
        var hFlag = wcData.teams[m.h] ? wcData.teams[m.h].flag : '';
        var aFlag = wcData.teams[m.a] ? wcData.teams[m.a].flag : '';
        var venue = m.v ? '<div class="mmr-venue">' + m.v + '</div>' : '';

        el.innerHTML += '<div class="mmr-row mmr-upcoming" onclick="goToMatch(\'' + m.d + '\')">' +
          '<div class="mmr-date">' + dateInfo.day + ' ' + dateInfo.date + '</div>' +
          '<div class="mmr-home">' + m.h + ' ' + hFlag + '</div>' +
          '<div class="mmr-center mmr-time">' + pdt + '</div>' +
          '<div class="mmr-away">' + aFlag + ' ' + m.a + '</div>' +
          venue +
        '</div>';
      });
    }

    el.innerHTML += '</div></div>';
  }

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
    var matchTab = document.querySelectorAll('.nav-tab')[1];
    switchTab('matches', matchTab);
    renderMatches();
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
  arrowUp: '<polyline points="18 15 12 9 6 15"/>',
  arrowDown: '<polyline points="6 9 12 15 18 9"/>'
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
    return '<div class="bracket-node bracket-match' + (model.needsPick ? ' needs-pick' : '') + '" data-match-id="' + matchId + '" title="' + esc(title) + '">' +
      '<div class="bracket-node-meta"><span>' + matchId + '</span>' + badge + '</div>' +
      '<div class="bracket-team' + (model.winner === model.home ? ' winner' : '') + lockedHome + '" data-ko="' + matchId + '" data-pick="home" data-team="' + esc(model.home) + '" aria-label="' + esc(model.home) + '">' +
        '<span class="bt-name"><span class="bt-flag">' + getFlag(model.home) + '</span><span class="bt-label bt-label-full">' + esc(compactTeamLabel(model.home)) + '</span><span class="bt-label bt-label-code">' + esc(bracketTeamCode(model.home)) + '</span></span><span class="bt-score">' + homeScore + '</span></div>' +
      '<div class="bracket-team' + (model.winner === model.away ? ' winner' : '') + lockedAway + '" data-ko="' + matchId + '" data-pick="away" data-team="' + esc(model.away) + '" aria-label="' + esc(model.away) + '">' +
        '<span class="bt-name"><span class="bt-flag">' + getFlag(model.away) + '</span><span class="bt-label bt-label-full">' + esc(compactTeamLabel(model.away)) + '</span><span class="bt-label bt-label-code">' + esc(bracketTeamCode(model.away)) + '</span></span><span class="bt-score">' + awayScore + '</span></div>' +
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
    {id:'r32', label:'R32', title:'Round of 32', col:1, focus:'M74'},
    {id:'r16', label:'R16', title:'Round of 16', col:2, focus:'M89'},
    {id:'qf', label:'QF', title:'Quarter-finals', col:3, focus:'M97'},
    {id:'sf', label:'SF', title:'Semi-finals', col:4, focus:'M101'},
    {id:'final', label:'Final', title:'Final', col:5, focus:'M104'}
  ];

  function mobileVisualBracket() {
    var out = '<div class="bracket-mobile-scroll" data-mobile-bracket-scroll><div class="bracket-mobile-visual" aria-label="World Cup knockout bracket">';
    mobileRounds.forEach(function(round) {
      out += '<div class="bracket-mobile-column-title" style="--bracket-col:' + round.col + '">' + round.title + '</div>' +
        '<span class="bracket-mobile-round-anchor" data-mobile-round-anchor="' + round.id + '" style="--bracket-col:' + round.col + '" aria-hidden="true"></span>';
    });

    var r32 = ['M74','M77','M73','M75','M83','M84','M81','M82','M76','M78','M79','M80','M86','M88','M85','M87'];
    var r16 = ['M89','M90','M93','M94','M91','M92','M95','M96'];
    var qf = ['M97','M98','M99','M100'];
    var r32Rows = [2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32];
    var r16Rows = [3,7,11,15,19,23,27,31];
    var qfRows = [5,13,21,29];
    var sfRows = [9,25];

    r32.forEach(function(id, i) { out += visualSlot(id, 1, r32Rows[i], 'connect-right', 0); });
    r16.forEach(function(id, i) { out += visualSlot(id, 2, r16Rows[i], 'connect-left connect-right join-left', 2); });
    qf.forEach(function(id, i) { out += visualSlot(id, 3, qfRows[i], 'connect-left connect-right join-left', 4); });
    ['M101','M102'].forEach(function(id, i) { out += visualSlot(id, 4, sfRows[i], 'connect-left connect-right join-left', 8); });
    out += visualSlot('M104', 5, 17, 'connect-left bracket-final-node', 0);
    out += visualSlot('M103', 5, 25, 'bracket-bronze-node', 0);
    out += '<div class="bracket-mobile-visual-champion">' + icon('trophy',{size:20,cls:'champion-trophy'}) +
      (resolvedWinners.M104 && wcData.teams[resolvedWinners.M104] ? '<strong>' + wcData.teams[resolvedWinners.M104].flag + ' ' + esc(resolvedWinners.M104) + '</strong>' : '<strong>Champion</strong>') + '</div>' +
      '<div class="bracket-mobile-third-label">Third place</div>';
    return out + '</div></div>';
  }

  function mobileBracketMap() {
    var out = '<div class="bracket-mobile-map"><div class="bracket-section-tabs" role="tablist" aria-label="Bracket section">';
    mobileRounds.forEach(function(round) {
      out += '<button type="button" role="tab" data-bracket-section="' + round.id + '" aria-selected="' + (bracketMobileSection === round.id) + '" class="' + (bracketMobileSection === round.id ? 'active' : '') + '">' + round.label + '</button>';
    });
    return out + '</div>' + mobileVisualBracket() + '</div>';
  }

  function scrollMobileBracketTo(roundId, behavior) {
    var scroller = el.querySelector('[data-mobile-bracket-scroll]');
    var anchor = el.querySelector('[data-mobile-round-anchor="' + roundId + '"]');
    var round = mobileRounds.find(function(candidate) { return candidate.id === roundId; });
    var focusNode = round && el.querySelector('.bracket-mobile-visual [data-match-id="' + round.focus + '"]');
    var focus = focusNode && focusNode.closest('.bracket-visual-slot');
    if (!scroller || !anchor || !scroller.clientWidth) return;
    var targetLeft = anchor.offsetLeft - (scroller.clientWidth - anchor.offsetWidth) / 2;
    var targetTop = roundId === 'r32' || !focus
      ? 0
      : focus.offsetTop - (scroller.clientHeight - focus.offsetHeight) / 2;
    scroller.scrollTo({left:Math.max(0, targetLeft), top:Math.max(0, targetTop), behavior:behavior || 'smooth'});
  }

  // Build HTML
  var resetButton = bracketViewMode === 'picks' ? '<button id="resetBtn">' + icon('reset',{size:14}) + ' Reset Picks</button>' : '';
  var html = '<div class="bracket-info"><div><h3>Elimination Bracket</h3><p>' +
    (bracketViewMode === 'live'
      ? 'Confirmed teams and FT winners lead the bracket. Your saved picks remain as comparison data.'
      : 'Manual predictions lead the bracket. Confirmed teams fill empty slots, and original picks are preserved.') +
    '</p></div><div class="bracket-actions"><button class="bracket-info-toggle" type="button" aria-pressed="true">' +
    icon('arrowUp',{size:12}) + ' Hide controls<span class="icon">▼</span></button>' +
    '<div class="bracket-mode-toggle" role="tablist" aria-label="Bracket view">' +
    '<button class="' + (bracketViewMode === 'picks' ? 'active' : '') + '" data-bracket-mode="picks" role="tab" aria-selected="' + (bracketViewMode === 'picks') + '">My Picks</button>' +
    '<button class="' + (bracketViewMode === 'live' ? 'active' : '') + '" data-bracket-mode="live" role="tab" aria-selected="' + (bracketViewMode === 'live') + '">Live Bracket</button>' +
    '</div>' + resetButton + '</div></div>';

  html += '<div class="bracket-visual">' + desktopBracketMap() + mobileBracketMap() + '</div>';

  // === GROUP PICKS ===
  var groupTitle = bracketViewMode === 'live' ? 'Group Seeds' : 'Group Stage Picks';
  html += '<div class="bracket-round-title">' + groupTitle + '</div>';
  html += '<div class="bracket-grid" id="bracketGrid">';
  var idx = 0;
  Object.keys(wcData.groups).forEach(function(letter) {
    var group = wcData.groups[letter];
    var k1 = 'g_' + letter + '_1', k2 = 'g_' + letter + '_2';
    var directLive3 = liveGroupSeed(letter, '3');
    var autoLive3 = directLive3 ? null : autoThirdSeed(letter);
    var live1 = liveGroupSeed(letter, '1'), live2 = liveGroupSeed(letter, '2'), live3 = directLive3 || autoLive3;
    html += '<div class="bracket-match"><div class="bracket-match-lbl" style="color:' + groupColors[letter] + '">Group ' + letter + '</div>';
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
      html += '<div class="bracket-team' + cls + '" data-idx="' + idx + '"' + ((liveRank || eliminated) ? ' data-locked="true"' : '') + '>' +
        '<span class="bt-name">' + getFlag(team) + team + '</span>' +
        '<span class="bt-rank">' + rank + '</span></div>';
      window._bracketMap = window._bracketMap || [];
      window._bracketMap[idx] = {g: letter, t: team};
      idx++;
    });
    html += '</div>';
  });
  html += '</div>';

  // Insert progress before the bracket map.
  var progressHtml = '';
  if (bracketViewMode === 'picks') {
    var progressPct = totalKoPicks > 0 ? Math.round((madeKoPicks / totalKoPicks) * 100) : 0;
    progressHtml = '<div class="bracket-progress"><div class="bracket-progress-bar"><div class="bracket-progress-fill" style="width:' + progressPct + '%"></div></div><span class="bracket-progress-label">' + madeKoPicks + '/' + totalKoPicks + ' knockout picks made</span></div>';
  } else {
    progressHtml = '<div class="bracket-progress bracket-progress-live"><span class="bracket-progress-label">Live bracket uses confirmed seeds and FT winners only</span></div>';
  }
  html = html.replace('<div class="bracket-visual">', progressHtml + '<div class="bracket-visual">');

  el.innerHTML = html;

  // A mode change rerenders the bracket. Restore the selected mobile stage.
  window.requestAnimationFrame(function() {
    scrollMobileBracketTo(bracketMobileSection, 'auto');
  });

  // Event delegation (set once)
  if (!el._hasListener) {
    el._hasListener = true;
    el.addEventListener('click', function(e) {
      var sectionBtn = e.target.closest('[data-bracket-section]');
      if (sectionBtn) {
        bracketMobileSection = sectionBtn.getAttribute('data-bracket-section');
        el.querySelectorAll('[data-bracket-section]').forEach(function(button) {
          var active = button.getAttribute('data-bracket-section') === bracketMobileSection;
          button.classList.toggle('active', active);
          button.setAttribute('aria-selected', active);
        });
        scrollMobileBracketTo(bracketMobileSection, 'smooth');
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
      // Bracket info toggle
      var toggleBtn = e.target.closest('.bracket-info-toggle');
      if (toggleBtn) {
        toggleBracketInfo();
        return;
      }
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

function renderStats() {
  var el = document.getElementById('tab-stats');
  var html = '';
  var live = (typeof statsData !== 'undefined' && statsData) ? statsData : null;
  var teamsIndex = getTeamsIndex();
  var overview = live && live.overview ? live.overview : { matchesPlayed: 28, goalsScored: 84, goalsPerMatch: 3.0, teams: 48 };
  var scorers = live && live.topScorers && live.topScorers.length ? live.topScorers : [
    {n:"Lionel Messi",t:"Argentina",g:3},{n:"Jonathan David",t:"Canada",g:3},
    {n:"Erling Haaland",t:"Norway",g:2},{n:"Kylian Mbappé",t:"France",g:2},
    {n:"Harry Kane",t:"England",g:2},{n:"Folarin Balogun",t:"United States",g:2},
    {n:"Kai Havertz",t:"Germany",g:2},{n:"Yasin Ayari",t:"Sweden",g:2},
    {n:"Elijah Just",t:"New Zealand",g:2},{n:"Cyle Larin",t:"Canada",g:2},
    {n:"Viktor Gyökeres",t:"Sweden",g:1},{n:"Alexander Isak",t:"Sweden",g:1},
    {n:"Jamal Musiala",t:"Germany",g:1},{n:"Denis Undav",t:"Germany",g:1},
    {n:"Amad Diallo",t:"Ivory Coast",g:1},{n:"Vinícius Júnior",t:"Brazil",g:1},
    {n:"Omar Marmoush",t:"Egypt",g:1},{n:"Bradley Barcola",t:"France",g:1},
    {n:"Teboho Mokoena",t:"South Africa",g:1},{n:"Granit Xhaka",t:"Switzerland",g:1}
  ];
  var groupGoals = live && live.groupGoals && live.groupGoals.length ? live.groupGoals : [{g:"A",m:4,goals:8},{g:"B",m:4,goals:15},{g:"C",m:2,goals:3},{g:"D",m:2,goals:8},{g:"E",m:2,goals:9},{g:"F",m:2,goals:10},{g:"G",m:2,goals:8},{g:"H",m:2,goals:2},{g:"I",m:2,goals:9},{g:"J",m:2,goals:7},{g:"K",m:1,goals:2},{g:"L",m:1,goals:6}];
  var confStats = live && live.confStats && live.confStats.length ? live.confStats : [{c:"UEFA",s:36,con:17},{c:"CONMEBOL",s:6,con:7},{c:"AFC",s:13,con:23},{c:"CAF",s:7,con:17},{c:"CONCACAF",s:16,con:12},{c:"OFC",s:2,con:2}];
  var records = live && live.records && live.records.length ? live.records : [
    {label:'Messi hat-trick', detail:'First WC hat-trick of his career (vs Algeria). Now tied with Klose at 16 career WC goals.'},
    {label:'David hat-trick', detail:'Jonathan David scores 3 as Canada crush Qatar 6-0 for their first-ever World Cup win.'},
    {label:'Mbappé milestone', detail:'14 career WC goals. Third on all-time list behind Klose (16) and Messi (16).'},
    {label:'Germany 7-1', detail:'Biggest win of the tournament so far (vs Curaçao). Havertz scored twice.'},
    {label:'Canada 6-0', detail:'Second-biggest win (vs 9-man Qatar). David, Larin, Saliba, and an own goal.'},
    {label:'Spain 0-0', detail:'Favorites held to a goalless draw by debutants Cape Verde.'},
    {label:'Haaland arrives', detail:'Two goals in Norway debut (4-1 vs Iraq). First WC goals of his career.'},
    {label:'Kane joins race', detail:'Two goals in England\'s 4-2 win over Croatia. 67 career international goals.'}
  ];

  // Tournament overview
  html += '<h2 style="margin-bottom:16px;font-size:1.1rem">Tournament Statistics</h2>';
  html += '<div class="stats-grid">';
  html += '<div class="stat-card"><div class="stat-val stat-val-accent">' + overview.matchesPlayed + '</div><div class="stat-lbl">Matches Played</div></div>';
  html += '<div class="stat-card"><div class="stat-val stat-val-green">' + overview.goalsScored + '</div><div class="stat-lbl">Goals Scored</div></div>';
  html += '<div class="stat-card"><div class="stat-val stat-val-amber">' + overview.goalsPerMatch.toFixed(1) + '</div><div class="stat-lbl">Goals/Match</div></div>';
  html += '<div class="stat-card"><div class="stat-val stat-val-pink">' + overview.teams + '</div><div class="stat-lbl">Teams</div></div>';
  html += '</div>';

  // Top Scorers
  html += '<div class="modal-section"><h3 style="color:var(--accent)">' + icon('target') + ' Top Scorers</h3>';
  var maxGoals = scorers[0].g;
  // Golden leader card
  var leader = scorers[0];
  var leaderFlag = (teamsIndex[leader.t] && teamsIndex[leader.t].flag) ? teamsIndex[leader.t].flag : '';
  html += '<div class="scorer-leader">';
  html += '<div class="scorer-rank">' + icon('trophy',{size:22}) + '</div>';
  html += '<div><div class="scorer-name">' + esc(leader.n) + '</div><div class="scorer-team">' + leaderFlag + ' ' + esc(leader.t) + '</div></div>';
  html += '<div class="scorer-goals-badge">' + leader.g + '</div>';
  html += '</div>';
  // Table for the rest
  html += '<table class="scorers-table">';
  for (var si = 1; si < scorers.length; si++) {
    var s = scorers[si];
    var flag = (teamsIndex[s.t] && teamsIndex[s.t].flag) ? teamsIndex[s.t].flag : '';
    var barW = Math.round((s.g / maxGoals) * 100);
    html += '<tr>';
    html += '<td class="st-rank">' + (si + 1) + '</td>';
    html += '<td><span class="st-name">' + esc(s.n) + '</span><br><span class="st-team">' + flag + ' ' + esc(s.t) + '</span></td>';
    html += '<td class="st-bar-cell"><div class="st-bar" style="width:' + barW + '%"></div></td>';
    html += '<td class="st-goals">' + s.g + '</td>';
    html += '</tr>';
  }
  html += '</table></div>';

  // Group Goals — horizontal bar chart
  html += '<div class="modal-section"><h3 style="color:var(--accent)">' + icon('barChart') + ' Goals by Group</h3>';
  var maxGroupGoals = Math.max.apply(null, groupGoals.map(function(gg) { return gg.goals; })) || 1;
  html += '<div class="stat-bars">';
  groupGoals.forEach(function(gg) {
    var pct = Math.round((gg.goals / maxGroupGoals) * 100);
    var gc = groupColors[gg.g] || 'var(--accent)';
    html += '<div class="stat-bar-row">' +
      '<span class="stat-bar-label" style="color:' + gc + '">Grp ' + gg.g + '</span>' +
      '<div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + pct + '%;background:' + gc + '"></div></div>' +
      '<span class="stat-bar-val">' + gg.goals + '</span>' +
    '</div>';
  });
  html += '</div></div>';

  // Confederation stats — dual bar (scored vs conceded)
  html += '<div class="modal-section"><h3 style="color:var(--accent)">' + icon('globe') + ' Goals by Confederation</h3>';
  var maxConfGoals = Math.max.apply(null, confStats.map(function(cs) { return Math.max(cs.s, cs.con); })) || 1;
  html += '<div class="stat-bars">';
  confStats.forEach(function(cs) {
    var diff = cs.s - cs.con;
    var sPct = Math.round((cs.s / maxConfGoals) * 100);
    var cPct = Math.round((cs.con / maxConfGoals) * 100);
    html += '<div class="stat-bar-row stat-bar-dual">' +
      '<span class="stat-bar-label">' + cs.c + '</span>' +
      '<div class="stat-bar-dual-wrap">' +
        '<div class="stat-bar-track"><div class="stat-bar-fill stat-bar-scored" style="width:' + sPct + '%"></div></div>' +
        '<div class="stat-bar-track"><div class="stat-bar-fill stat-bar-conceded" style="width:' + cPct + '%"></div></div>' +
      '</div>' +
      '<span class="stat-bar-val stat-bar-diff ' + (diff >= 0 ? 'positive' : 'negative') + '">' + (diff >= 0 ? '+' : '') + diff + '</span>' +
    '</div>';
  });
  html += '<div class="stat-bar-legend"><span class="stat-bar-legend-dot stat-bar-scored"></span> Scored <span class="stat-bar-legend-dot stat-bar-conceded"></span> Conceded</div>';
  html += '</div></div>';

  // Key records
  html += '<div class="modal-section"><h3 style="color:var(--accent)">' + icon('award') + ' Records &amp; Milestones</h3>';
  html += '<table class="key-dates"><tbody>';
  records.forEach(function(record) {
    html += '<tr><td>' + esc(record.label) + '</td><td>' + esc(record.detail) + '</td></tr>';
  });
  html += '</tbody></table></div>';

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
  html += '<div class="date-nav" id="dateNav">';
  dates.forEach(function(dateStr) {
    var info = formatDatePill(dateStr);
    var matchCount = matchesData.filter(function(m){return getLocalDateForMatch(m)===dateStr;}).length;
    var isToday = dateStr === today;
    var isActive = dateStr === selectedMatchDate;
    html += '<div class="date-pill' + (isActive?' active':'') + (isToday?' today':'') + '" onclick="selectMatchDate(\'' + dateStr + '\')">';
    html += '<div class="dp-day">' + info.day + '</div>';
    html += '<div class="dp-date">' + info.date.split(' ')[1] + '</div>';
    html += '<div class="dp-count">' + matchCount + ' game' + (matchCount>1?'s':'') + '</div>';
    html += '</div>';
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
        html += '<div class="mc-score"><div>';
        html += '<div class="mc-actual-score">' + actual.h + ' - ' + actual.a + '</div>';
        html += '<div class="mc-score-status">FT</div>';
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

  el.innerHTML = html;

  // Scroll active pill into view
  setTimeout(function() {
    var active = document.querySelector('.date-pill.active');
    if (active) active.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  }, 100);

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

function jumpToToday() {
  var now = new Date();
  var y = now.getFullYear();
  var mo = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  var today = y + '-' + mo + '-' + d;
  selectMatchDate(today);
  // Scroll the today pill into view
  var todayPill = document.querySelector('.date-pill.today');
  if (todayPill) todayPill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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
  if (btn) btn.title = 'Theme: ' + themePreference;
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
    var validTabs = ['groups', 'matches', 'bracket', 'stats'];
    if (validTabs.indexOf(tab) >= 0) {
      var btns = document.querySelectorAll('.nav-tab');
      var tabIndex = validTabs.indexOf(tab);
      btns.forEach(function(b, i) { b.classList.toggle('active', i === tabIndex); });
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
  renderedTabs['groups'] = true;
  try { renderGroups(); } catch(e) { console.error('renderGroups error:', e); }
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
  var data = null, meta = null, notModified = false;
  try {
    var headers = {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    if (currentDataVersion) headers['If-None-Match'] = '"' + currentDataVersion + '"';
    var resp = await fetch('/api/data', {
      cache: 'reload',
      headers: headers
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
  } catch (e) {}
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
  if (foregroundRefreshTimer) clearTimeout(foregroundRefreshTimer);
  if (document.hidden) return;
  foregroundRefreshTimer = setTimeout(function() {
    refreshFreshData('timer', { showIndicator: false, toast: true });
  }, foregroundRefreshIntervalMs());
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

init();

window.addEventListener('focus', function() {
  refreshFreshData('focus', { showIndicator: false, toast: true });
});
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) refreshFreshData('visible', { showIndicator: false, toast: true });
  else if (foregroundRefreshTimer) clearTimeout(foregroundRefreshTimer);
});

// === STALE-WHILE-REVALIDATE: Listen for fresh data from service worker ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'DATA_UPDATED') {
      refreshFreshData('service-worker', { force: true, showIndicator: false, toast: true }).catch(function() {});
    }
  });
}
