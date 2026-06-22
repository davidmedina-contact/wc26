// FIFA World Cup 2026 Guide - Application Logic
// Data is loaded asynchronously from the serverless bootstrap endpoint

var wcData, jerseyNumbers, matchesData, scorePredictions, teamStrength,
    eloRatings, injuryIntel, actualScores, standingsData, bracketVenues,
    groupColors, modelPredictions;
var statsData;

function isValidBootstrapData(data) {
  return Boolean(data && data.groups && data.teams && Array.isArray(data.matchesData));
}

let bracketState = {};
var selectedMatchDate = '2026-06-11';

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
  if (analysis.watch) analysisHtml += '<div class="analysis-block" style="border-left-color:#6366f1"><span class="analysis-tag tag-watch">👀 PLAYERS TO WATCH</span><p class="analysis">' + analysis.watch + '</p></div>';
  if (injuryNote) analysisHtml += '<div class="analysis-block" style="border-left-color:var(--color-warning, #f59e0b)"><span class="analysis-tag" style="background:rgba(245,158,11,0.12);color:var(--color-warning, #f59e0b)">🏥 FITNESS & INJURIES</span>' + injuryNote + '</div>';
  if (analysis.callups) analysisHtml += '<div class="analysis-block" style="border-left-color:#22c55e"><span class="analysis-tag tag-callup">📥 CALL-UPS</span><p class="analysis">' + analysis.callups + '</p></div>';
  if (analysis.snubs) analysisHtml += '<div class="analysis-block" style="border-left-color:#ef4444"><span class="analysis-tag tag-snub">❌ SNUBS</span><p class="analysis">' + analysis.snubs + '</p></div>';

  el.innerHTML = '<button class="modal-close" onclick="closeModal()">✕</button>' +
    '<div class="modal-header"><span class="tc-flag">' + team.flag + '</span><div><h2>' + teamName + '</h2><div style="font-size:0.85rem;color:var(--text-muted)">Group ' + g + '</div></div></div>' +
    '<div class="modal-mgr">👔 <strong>' + team.manager.name + '</strong> (' + team.manager.nat + ')</div>' +
    '<div class="modal-section"><h3 style="color:' + gc + '">⭐ Top 5 Players</h3><div class="top5-grid">' +
    team.top5.map(function(name) {
      var pos = getPlayerPos(name);
      return '<a href="' + wikiLink(name) + '" target="_blank" rel="noopener" class="top5-chip-link"><span class="top5-chip"><span class="top5-pos">' + pos + '</span> ' + name + ' <span class="top5-wiki">↗</span></span></a>';
    }).join('') +
    '</div></div>' +
    '<div class="modal-section"><h3 style="color:' + gc + '">📋 Squad Analysis</h3>' + analysisHtml + '</div>' +
    '<div class="modal-section"><h3 style="color:' + gc + '">👥 Full Squad (' + team.squad.length + ' players)</h3><div style="overflow-x:auto"><table class="squad-tbl"><thead><tr><th>Kit</th><th>Player</th><th>Pos</th><th>Age</th><th>Club</th></tr></thead><tbody>' +
    team.squad.map(function(p, i) {
      var isStar = team.top5.indexOf(p.n) >= 0;
      var wiki = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.n.replace(/ /g,'_'));
      var nameHtml = isStar ? '<a href="' + wiki + '" target="_blank" rel="noopener" class="squad-star-link"><span class="star-icon">★</span>' + p.n + ' <span class="top5-wiki">↗</span></a>' : p.n;
      var kitNum = '';
      try { kitNum = (jerseyNumbers && jerseyNumbers[teamName] && jerseyNumbers[teamName][p.n]) ? jerseyNumbers[teamName][p.n] : ''; } catch(e) {}
      return '<tr><td class="kit-num">' + kitNum + '</td><td>' + nameHtml + '</td><td><span class="pos ' + getPC(p.p) + '">' + p.p + '</span></td><td style="font-family:var(--mono)">' + p.a + '</td><td style="color:var(--text-sec)">' + p.c + '</td></tr>';
    }).join('') +
    '</tbody></table></div></div>';

  // Team matches section
  var teamMatches = matchesData.filter(function(m) { return m.h === teamName || m.a === teamName; });
  if (teamMatches.length > 0) {
    el.innerHTML += '<div class="modal-section"><h3 style="color:' + gc + '">📅 Group Stage Matches</h3><div class="modal-matches">';
    teamMatches.forEach(function(m) {
      var pdt = etToLocal(m.t, m.d);
      var dateInfo = formatDatePill(m.d);
      var hFlag = wcData.teams[m.h] ? wcData.teams[m.h].flag : '';
      var aFlag = wcData.teams[m.a] ? wcData.teams[m.a].flag : '';
      var opponent = m.h === teamName ? m.a : m.h;
      var oppFlag = m.h === teamName ? aFlag : hFlag;
      var homeAway = m.h === teamName ? 'vs' : 'at';
      el.innerHTML += '<div class="modal-match-row" onclick="goToMatch(\'' + m.d + '\')">' +
        '<div class="mmr-date">' + dateInfo.day + ' ' + dateInfo.date + '</div>' +
        '<div class="mmr-teams"><span>' + oppFlag + '</span> ' + homeAway + ' <strong>' + opponent + '</strong></div>' +
        '<div class="mmr-time">' + pdt + ' · <span class="bc-tag ' + (m.net==='FOX'?'bc-free':'bc-paid') + '" style="font-size:0.65rem">' + m.net + '</span>' + (teamStrength[m.h]&&teamStrength[m.a]? ' <span class="mmr-pred" style="font-size:0.65rem;color:var(--text-muted)">' + getMatchPrediction(m.h,m.a).h + '-' + getMatchPrediction(m.h,m.a).d + '-' + getMatchPrediction(m.h,m.a).a + '</span>':'') + '</div>' +
        '<div class="mmr-goto">View day →</div>' +
      '</div>';
    });
    el.innerHTML += '</div></div>';
  }

  document.getElementById('modal').classList.add('visible');
  document.getElementById('searchResults').classList.remove('visible');
}

function closeModal() { document.getElementById('modal').classList.remove('visible'); }

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

function renderGroups() {
  var el = document.getElementById('tab-groups'), html = '';
  if (!wcData || !wcData.groups) {
    el.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading live data…</div>';
    return;
  }
  var letters = Object.keys(wcData.groups);
  var teamsIndex = getTeamsIndex();
  letters.forEach(function(letter) {
    var group = wcData.groups[letter];
    var gc = groupColors[letter] || '#6366f1';
    html += '<div class="group-section group-' + letter + '">' +
      '<div class="group-header"><div class="group-badge">' + letter + '</div><div><div class="group-title">Group ' + letter + '</div><div class="group-region">📍 ' + group.region + '</div></div></div>' +
      '<div class="standings-table-wrap"><table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th></th></tr></thead><tbody>';
    var teams = standingsData[letter] || [];
    teams.forEach(function(t, i) {
      var flag = (teamsIndex[t.t] && teamsIndex[t.t].flag) ? teamsIndex[t.t].flag + ' ' : '';
      var posClass = '';
      if (i < 2) posClass = ' standings-pos-qualify';
      else if (i === 2) posClass = ' standings-pos-third';
      html += '<tr class="standings-row' + posClass + '" data-team="' + t.t + '">' +
        '<td>' + (i+1) + '</td>' +
        '<td>' + flag + t.t + '</td>' +
        '<td>' + t.p + '</td><td>' + t.w + '</td><td>' + t.d + '</td><td>' + t.l + '</td>' +
        '<td>' + t.gf + '</td><td>' + t.ga + '</td><td>' + t.gd + '</td>' +
        '<td class="pts">' + t.pts + '</td>' +
        '<td class="standings-chevron">›</td></tr>';
    });
    html += '</tbody></table></div></div>';
  });
  el.innerHTML = html;
  // Event delegation for team card clicks
  if (!el._hasTeamListener) {
    el._hasTeamListener = true;
    el.addEventListener('click', function(e) {
      var row = e.target.closest('.standings-row');
      if (row && row.dataset.team) {
        openTeamModal(row.dataset.team);
      }
    });
  }
}


// === GROUP STANDINGS ===
function renderBracket() {
  var el = document.getElementById('tab-bracket');

  // R32 structure: [matchId, homeSlot, awaySlot]
  // Slots: "1A" = winner group A, "2A" = runner-up group A, "3" = best 3rd place
  var r32Matches = [
    ["M73", "2A", "2B"],
    ["M74", "1E", "3rd"],
    ["M75", "1F", "2C"],
    ["M76", "1C", "2F"],
    ["M77", "1I", "3rd"],
    ["M78", "2E", "2I"],
    ["M79", "1A", "3rd"],
    ["M80", "1L", "3rd"],
    ["M81", "1D", "3rd"],
    ["M82", "1G", "3rd"],
    ["M83", "2K", "2L"],
    ["M84", "1H", "2J"],
    ["M85", "1B", "3rd"],
    ["M86", "1J", "2H"],
    ["M87", "1K", "3rd"],
    ["M88", "2D", "2G"]
  ];

  // R16: winners of paired R32 matches
  var r16Pairs = [["M73","M75"],["M74","M76"],["M77","M78"],["M79","M80"],["M81","M82"],["M83","M84"],["M85","M86"],["M87","M88"]];
  var qfPairs = [[0,1],[2,3],[4,5],[6,7]]; // indices into r16
  var sfPairs = [[0,1],[2,3]]; // indices into qf

  // Get all qualified 3rd-place teams (best 8 by Elo)
  function getQualified3rdTeams() {
    var thirds = [];
    'ABCDEFGHIJKL'.split('').forEach(function(g) {
      var team = bracketState['g_' + g + '_3'];
      if (team) thirds.push({team: team, group: g, elo: (eloRatings && eloRatings[team]) || 1600});
    });
    // Sort by Elo descending, take best 8
    thirds.sort(function(a, b) { return b.elo - a.elo; });
    return thirds.slice(0, 8);
  }

  // Route 3rd-place teams to R32 slots by strength
  // Simplified: strongest 3rd goes to slot index 0, weakest to slot index 7
  var qualified3rd = getQualified3rdTeams();
  var thirdSlots = []; // 8 slots in order: M74, M77, M79, M80, M81, M82, M85, M87
  var thirdSlotIds = ['M74','M77','M79','M80','M81','M82','M85','M87'];
  // Fill from weakest qualified 3rd → strongest group winner opponent
  // (reversed: weakest 3rd gets the strongest opponent slot)
  // Actually simpler: just assign in order
  for (var ti = 0; ti < 8; ti++) {
    thirdSlots[ti] = qualified3rd[ti] ? qualified3rd[ti].team : '3rd TBD';
  }

  // Resolve a slot like "1A", "2B", or "3rd" to a team name
  var thirdIdx = 0;
  function resolveSlot(slot) {
    if (slot === "3rd") {
      var team = thirdSlots[thirdIdx] || '3rd TBD';
      thirdIdx++;
      return team;
    }
    var pos = slot[0]; // '1' or '2'
    var grp = slot.substring(1); // 'A', 'B', etc.
    var key = 'g_' + grp + '_' + pos;
    return bracketState[key] || slot;
  }

  function getFlag(teamName) {
    return (wcData.teams[teamName] && wcData.teams[teamName].flag) ? wcData.teams[teamName].flag + ' ' : '';
  }

  // Build HTML
  var html = '<div class="bracket-info"><h3>Elimination Bracket</h3><p>Pick 1st, 2nd, and 3rd place per group (click teams in order). Best 8 third-place teams auto-qualify for R32.</p><button id="resetBtn">↺ Reset</button></div>';

  // === GROUP PICKS ===
  html += '<div class="bracket-round-title">Group Stage Picks</div>';
  html += '<div class="bracket-grid" id="bracketGrid">';
  var idx = 0;
  Object.keys(wcData.groups).forEach(function(letter) {
    var group = wcData.groups[letter];
    var k1 = 'g_' + letter + '_1', k2 = 'g_' + letter + '_2';
    html += '<div class="bracket-match"><div class="bracket-match-lbl" style="color:' + groupColors[letter] + '">Group ' + letter + '</div>';
    var k3 = 'g_' + letter + '_3';
    group.teams.forEach(function(team) {
      var is1 = bracketState[k1] === team, is2 = bracketState[k2] === team, is3 = bracketState[k3] === team;
      var cls = is1 ? ' winner' : is2 ? ' runner' : is3 ? ' third' : '';
      var rank = is1 ? '1st' : is2 ? '2nd' : is3 ? '3rd' : '';
      html += '<div class="bracket-team' + cls + '" data-idx="' + idx + '">' +
        '<span class="bt-name">' + getFlag(team) + team + '</span>' +
        '<span class="bt-rank">' + rank + '</span></div>';
      window._bracketMap = window._bracketMap || [];
      window._bracketMap[idx] = {g: letter, t: team};
      idx++;
    });
    html += '</div>';
  });
  html += '</div>';

  // === ROUND OF 32 ===
  html += '<div class="bracket-round-title">Round of 32</div>';
  html += '<div class="bracket-grid">';
  r32Matches.forEach(function(m) {
    var matchId = m[0];
    var homeTeam = resolveSlot(m[1]);
    var awayTeam = resolveSlot(m[2]);
    var winner = bracketState['ko_' + matchId];
    html += '<div class="bracket-match"><div class="bracket-match-lbl">' + matchId + ' · ' + m[1] + ' vs ' + m[2] + '</div>';
    html += '<div class="bracket-team' + (winner === homeTeam ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="home">' +
      '<span class="bt-name">' + getFlag(homeTeam) + homeTeam + '</span></div>';
    html += '<div class="bracket-team' + (winner === awayTeam ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="away">' +
      '<span class="bt-name">' + getFlag(awayTeam) + awayTeam + '</span></div>';
    if (bracketVenues[matchId]) {
      html += '<div class="bracket-venue-lbl">' + bracketVenues[matchId] + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // === ROUND OF 16 ===
  html += '<div class="bracket-round-title">Round of 16</div>';
  html += '<div class="bracket-grid">';
  r16Pairs.forEach(function(pair, i) {
    var matchId = 'R16_' + i;
    var home = bracketState['ko_' + pair[0]] || 'W ' + pair[0];
    var away = bracketState['ko_' + pair[1]] || 'W ' + pair[1];
    var winner = bracketState['ko_' + matchId];
    html += '<div class="bracket-match"><div class="bracket-match-lbl">R16 · W' + pair[0] + ' vs W' + pair[1] + '</div>';
    html += '<div class="bracket-team' + (winner === home ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="home">' +
      '<span class="bt-name">' + getFlag(home) + home + '</span></div>';
    html += '<div class="bracket-team' + (winner === away ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="away">' +
      '<span class="bt-name">' + getFlag(away) + away + '</span></div>';
    if (bracketVenues[matchId]) {
      html += '<div class="bracket-venue-lbl">' + bracketVenues[matchId] + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // === QUARTER-FINALS ===
  html += '<div class="bracket-round-title">Quarter-Finals</div>';
  html += '<div class="bracket-grid">';
  qfPairs.forEach(function(pair, i) {
    var matchId = 'QF_' + i;
    var r16a = 'R16_' + pair[0], r16b = 'R16_' + pair[1];
    var home = bracketState['ko_' + r16a] || 'W R16.' + (pair[0]+1);
    var away = bracketState['ko_' + r16b] || 'W R16.' + (pair[1]+1);
    var winner = bracketState['ko_' + matchId];
    html += '<div class="bracket-match"><div class="bracket-match-lbl">QF' + (i+1) + '</div>';
    html += '<div class="bracket-team' + (winner === home ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="home">' +
      '<span class="bt-name">' + getFlag(home) + home + '</span></div>';
    html += '<div class="bracket-team' + (winner === away ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="away">' +
      '<span class="bt-name">' + getFlag(away) + away + '</span></div>';
    if (bracketVenues[matchId]) {
      html += '<div class="bracket-venue-lbl">' + bracketVenues[matchId] + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // === SEMI-FINALS ===
  html += '<div class="bracket-round-title">Semi-Finals</div>';
  html += '<div class="bracket-grid">';
  sfPairs.forEach(function(pair, i) {
    var matchId = 'SF_' + i;
    var qfa = 'QF_' + pair[0], qfb = 'QF_' + pair[1];
    var home = bracketState['ko_' + qfa] || 'W QF' + (pair[0]+1);
    var away = bracketState['ko_' + qfb] || 'W QF' + (pair[1]+1);
    var winner = bracketState['ko_' + matchId];
    html += '<div class="bracket-match"><div class="bracket-match-lbl">SF' + (i+1) + '</div>';
    html += '<div class="bracket-team' + (winner === home ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="home">' +
      '<span class="bt-name">' + getFlag(home) + home + '</span></div>';
    html += '<div class="bracket-team' + (winner === away ? ' winner' : '') + '" data-ko="' + matchId + '" data-pick="away">' +
      '<span class="bt-name">' + getFlag(away) + away + '</span></div>';
    if (bracketVenues[matchId]) {
      html += '<div class="bracket-venue-lbl">' + bracketVenues[matchId] + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // === FINAL ===
  html += '<div class="bracket-round-title">🏆 Final</div>';
  html += '<div class="bracket-grid">';
  var finalHome = bracketState['ko_SF_0'] || 'W SF1';
  var finalAway = bracketState['ko_SF_1'] || 'W SF2';
  var champion = bracketState['ko_FINAL'];
  html += '<div class="bracket-match"><div class="bracket-match-lbl">Final · MetLife Stadium</div>';
  html += '<div class="bracket-team' + (champion === finalHome ? ' winner' : '') + '" data-ko="FINAL" data-pick="home">' +
    '<span class="bt-name">' + getFlag(finalHome) + finalHome + '</span></div>';
  html += '<div class="bracket-team' + (champion === finalAway ? ' winner' : '') + '" data-ko="FINAL" data-pick="away">' +
    '<span class="bt-name">' + getFlag(finalAway) + finalAway + '</span></div>';
  html += '</div>';
  if (champion && wcData.teams[champion]) {
    html += '<div style="text-align:center;padding:20px;font-size:1.5rem">🏆 ' + wcData.teams[champion].flag + ' <strong>' + champion + '</strong> wins the World Cup!</div>';
  }
  html += '</div>';

  el.innerHTML = html;

  // Event delegation (set once)
  if (!el._hasListener) {
    el._hasListener = true;
    el.addEventListener('click', function(e) {
      // Group pick
      var teamDiv = e.target.closest('.bracket-team[data-idx]');
      if (teamDiv) {
        var i = parseInt(teamDiv.getAttribute('data-idx'));
        if (!isNaN(i) && window._bracketMap && window._bracketMap[i]) {
          pickGroup(window._bracketMap[i].g, window._bracketMap[i].t);
        }
        return;
      }
      // Knockout pick
      var koDiv = e.target.closest('.bracket-team[data-ko]');
      if (koDiv) {
        var matchId = koDiv.getAttribute('data-ko');
        var pick = koDiv.getAttribute('data-pick');
        var nameEl = koDiv.querySelector('.bt-name');
        if (nameEl) {
          var teamName = nameEl.textContent.trim();
          // Remove flag emoji (first 2+ chars that are emoji)
          teamName = teamName.replace(/^[\u{1F1E0}-\u{1F1FF}\u{1F3F4}\u{E0061}-\u{E007A}\u{E007F}\s]+/u, '').trim();
          if (teamName && teamName.indexOf('W ') !== 0 && teamName.indexOf('W R') !== 0 && teamName.indexOf('W Q') !== 0 && teamName.indexOf('W S') !== 0 && teamName !== '3rd Place') {
            pickKnockout(matchId, teamName);
          }
        }
        return;
      }
      // Reset button
      if (e.target.id === 'resetBtn' || e.target.closest('#resetBtn')) {
        resetBracket();
      }
    });
  }
}

function pickGroup(letter, team) {
  var k1 = 'g_' + letter + '_1', k2 = 'g_' + letter + '_2', k3 = 'g_' + letter + '_3';
  // Toggle: if already selected at a position, remove it
  if (bracketState[k1] === team) { delete bracketState[k1]; }
  else if (bracketState[k2] === team) { delete bracketState[k2]; }
  else if (bracketState[k3] === team) { delete bracketState[k3]; }
  // Assign to first empty slot
  else if (!bracketState[k1]) { bracketState[k1] = team; }
  else if (!bracketState[k2]) { bracketState[k2] = team; }
  else if (!bracketState[k3]) { bracketState[k3] = team; }
  else { bracketState[k3] = team; } // Override 3rd
  try { localStorage.setItem('wc2026bracket', JSON.stringify(bracketState)); } catch(e) {}
  renderBracket();
}

function pickKnockout(matchId, team) {
  var key = 'ko_' + matchId;
  if (bracketState[key] === team) {
    delete bracketState[key];
  } else {
    bracketState[key] = team;
  }
  try { localStorage.setItem('wc2026bracket', JSON.stringify(bracketState)); } catch(e) {}
  renderBracket();
}

function resetBracket() {
  bracketState = {};
  window._bracketMap = [];
  try { localStorage.removeItem('wc2026bracket'); } catch(e) {}
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
  html += '<div class="stat-card"><div class="stat-val" style="color:var(--accent)">' + overview.matchesPlayed + '</div><div class="stat-lbl">Matches Played</div></div>';
  html += '<div class="stat-card"><div class="stat-val" style="color:#22c55e">' + overview.goalsScored + '</div><div class="stat-lbl">Goals Scored</div></div>';
  html += '<div class="stat-card"><div class="stat-val" style="color:#f59e0b">' + overview.goalsPerMatch.toFixed(1) + '</div><div class="stat-lbl">Goals/Match</div></div>';
  html += '<div class="stat-card"><div class="stat-val" style="color:#ec4899">' + overview.teams + '</div><div class="stat-lbl">Teams</div></div>';
  html += '</div>';
  
  // Top Scorers
  html += '<div class="modal-section"><h3 style="color:var(--accent)">⚽ Top Scorers</h3>';
  var maxGoals = scorers[0].g;
  // Golden leader card
  var leader = scorers[0];
  var leaderFlag = (teamsIndex[leader.t] && teamsIndex[leader.t].flag) ? teamsIndex[leader.t].flag : '';
  html += '<div class="scorer-leader">';
  html += '<div class="scorer-rank">🥇</div>';
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
  
  // Group Goals
  html += '<div class="modal-section"><h3 style="color:var(--accent)">📊 Goals by Group</h3>';
  html += '<table class="standings-table"><thead><tr><th>Group</th><th>Matches</th><th>Goals</th><th>Avg/Match</th></tr></thead><tbody>';
  groupGoals.forEach(function(gg) {
    html += '<tr><td style="font-weight:700;color:' + (groupColors[gg.g]||'var(--accent)') + '">Group ' + gg.g + '</td><td>' + gg.m + '</td><td style="font-weight:600">' + gg.goals + '</td><td>' + (gg.goals/gg.m).toFixed(1) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  
  // Confederation stats
  html += '<div class="modal-section"><h3 style="color:var(--accent)">🌍 Goals by Confederation</h3>';
  html += '<table class="standings-table"><thead><tr><th>Confederation</th><th>Scored</th><th>Conceded</th><th>+/-</th></tr></thead><tbody>';
  confStats.forEach(function(cs) {
    var diff = cs.s - cs.con;
    html += '<tr><td style="font-weight:500">' + cs.c + '</td><td>' + cs.s + '</td><td>' + cs.con + '</td><td style="color:' + (diff>=0?'var(--green, #22c55e)':'var(--red, #ef4444)') + '">' + (diff>=0?'+':'') + diff + '</td></tr>';
  });
  html += '</tbody></table></div>';
  
  // Key records
  html += '<div class="modal-section"><h3 style="color:var(--accent)">🏅 Records & Milestones</h3>';
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
  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><button class="today-btn" onclick="jumpToToday()">Today</button><a href="world-cup-2026-schedule.ics" download class="cal-download-btn">📅 Add All Matches to Calendar</a></div>';
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
      var pdt = etToLocal(m.t, m.d);
      var gc = groupColors[m.g] || '#a78bfa';
      var hFlag = wcData.teams[m.h] ? wcData.teams[m.h].flag : '';
      var aFlag = wcData.teams[m.a] ? wcData.teams[m.a].flag : '';
      var isKnockout = m.stage;
      var hClick = wcData.teams[m.h] ? ' data-team="' + m.h + '" style="cursor:pointer"' : '';
      var aClick = wcData.teams[m.a] ? ' data-team="' + m.a + '" style="cursor:pointer"' : '';

      html += '<div class="match-card">';
      // Header: meta info
      html += '<div class="mc-header">';
      if (isKnockout) {
        html += '<span class="mc-stage-label">' + m.stage + '</span>';
      } else {
        var mdLabel = m.matchday ? ' · <span class="mc-matchday">MD' + m.matchday + '</span>' : '';
        html += '<span class="mc-meta"><span class="mc-group-tag" style="color:' + gc + '">Group ' + m.g + '</span>' + mdLabel + '</span>';
      }
      html += '<span class="mc-countdown">' + pdt + ' ' + localTz + '</span>';
      html += '</div>';
      // Body: teams centered
      html += '<div class="mc-body">';
      html += '<div class="mc-team mc-team-home"' + hClick + '><span class="mc-name">' + m.h + '</span><span class="mc-flag">' + hFlag + '</span></div>';
      var predKey = m.h + '_' + m.a;
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
        html += '<div class="mc-pred-score">' + scorePred.h + ' - ' + scorePred.a + '</div>';
        html += '<div class="mc-xg">xG ' + scorePred.xgH + ' - ' + scorePred.xgA + '</div>';
        html += '</div></div>';
      } else {
        html += '<div class="mc-score"><div><div class="mc-time-center">—  :  —</div></div></div>';
      }
      html += '<div class="mc-team mc-team-away"' + aClick + '><span class="mc-flag">' + aFlag + '</span><span class="mc-name">' + m.a + '</span></div>';
      html += '</div>';
      // Prediction bar (only for group stage matches)
      if (!isKnockout && teamStrength[m.h] && teamStrength[m.a]) {
        var pred = getMatchPrediction(m.h, m.a);
        html += '<div class="mc-pred">';
        html += '<div class="pred-bar">';
        html += '<div class="pred-seg pred-home" style="width:' + pred.h + '%"><span>' + pred.h + '%</span></div>';
        html += '<div class="pred-seg pred-draw" style="width:' + pred.d + '%"><span>' + pred.d + '%</span></div>';
        html += '<div class="pred-seg pred-away" style="width:' + pred.a + '%"><span>' + pred.a + '%</span></div>';
        html += '</div>';
        html += '<div class="pred-label">Win probability · Elo-Poisson model (Opta/PELE data)</div>';
        html += '</div>';
      }
      // Footer: venue + broadcast
      html += '<div class="mc-footer">';
      var capacityStr = m.capacity ? ' · <span class="mc-capacity">🏟 ' + m.capacity.toLocaleString() + '</span>' : '';
      html += '<span class="mc-venue">📍 ' + m.v + capacityStr + '</span>';
      html += '<div class="mc-broadcast">';
      if (m.net === 'FOX') {
        html += '<span class="bc-tag bc-free">📡 FOX</span><span class="bc-tag bc-free">🇪🇸 TMD</span>';
      } else {
        html += '<span class="bc-tag bc-paid">📺 FS1</span><span class="bc-tag bc-free">🇪🇸 TMD</span>';
      }
      html += '</div></div></div>';
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
  var fab = document.getElementById('themeFab');
  if (fab) {
    var icons = {system: '\uD83D\uDCBB', light: '\u2600\uFE0F', dark: '\uD83C\uDF19'};
    fab.textContent = icons[themePreference] || '\u2699\uFE0F';
    fab.title = 'Theme: ' + themePreference;
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

// Load bracket state once from localStorage (if available)
try { var saved = localStorage.getItem('wc2026bracket'); if (saved) bracketState = JSON.parse(saved); } catch(e) {}


// === ASYNC INITIALIZATION ===
async function init() {
  try {
    var data = null;
    try {
      var resp = await fetch('/api/data', { headers: { 'Accept': 'application/json' } });
      if (resp.ok) {
        var livePayload = await resp.json();
        data = livePayload && livePayload.data ? livePayload.data : livePayload;
        if (!isValidBootstrapData(data)) data = null;
      }
    } catch (liveErr) {}
    if (!data) {
      var fallbackResp = await fetch('data.json');
      if (!fallbackResp.ok) throw new Error('HTTP ' + fallbackResp.status);
      data = await fallbackResp.json();
    }
    // Assign data to globals
    wcData = { groups: data.groups, teams: data.teams };
    jerseyNumbers = data.jerseyNumbers;
    matchesData = data.matchesData;
    scorePredictions = data.scorePredictions;
    teamStrength = data.teamStrength;
    eloRatings = data.eloRatings;
    injuryIntel = data.injuryIntel;
    actualScores = data.actualScores || {};
    standingsData = data.standingsData || {};
    statsData = data.statsData || null;
    bracketVenues = data.bracketVenues;
    groupColors = data.groupColors;
    modelPredictions = data.modelPredictions;
  } catch(e) {
    console.error('Failed to load data:', e);
    document.body.innerHTML = '<div style="text-align:center;padding:4rem 1rem;color:var(--text)"><h2>Failed to load data</h2><p>Please refresh the page.</p></div>';
    return;
  }

  // Remove loading skeleton
  var skeleton = document.getElementById('loading-skeleton');
  if (skeleton) skeleton.remove();
  document.querySelector('.container').classList.remove('loading');

  // Restore state from URL hash on load
  var hash = window.location.hash.replace('#', '');
  if (hash) {
    var parts = hash.split('/');
    var tab = parts[0];
    var validTabs = ['groups', 'matches', 'bracket', 'stats'];
    if (validTabs.indexOf(tab) >= 0) {
      // Activate the correct tab button
      var btns = document.querySelectorAll('.nav-tab');
      var tabIndex = validTabs.indexOf(tab);
      btns.forEach(function(b, i) { b.classList.toggle('active', i === tabIndex); });
      document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
      document.getElementById('tab-' + tab).classList.add('active');
      document.body.setAttribute('data-active-tab', tab);
      // Restore match date if present
      if (tab === 'matches' && parts[1]) {
        selectedMatchDate = parts[1];
      }
      // Render the restored tab
      renderedTabs[tab] = true;
      try {
        if (tab === 'groups') renderGroups();
        else if (tab === 'matches') renderMatches();
        else if (tab === 'bracket') renderBracket();
        else if (tab === 'stats') renderStats();
      } catch(e) { console.error('Error restoring tab:', e); }
      return;
    }
  }
  // Default: render groups
  renderedTabs['groups'] = true;
  try { renderGroups(); } catch(e) { console.error('renderGroups error:', e); }
}

init();
