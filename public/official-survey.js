(function (global) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function doneNote(existing) {
    if (!existing) return '';
    return '<p class="os-done">이미 제출한 응답입니다. 고친 뒤 다시 제출하면 기존 응답을 바꿉니다. 같은 사람이 두 번 쌓이지 않습니다.</p>';
  }

  function noticeLine(line) {
    return String(line || '').replace(/^\s*[▪•·∙◆■□▶►‣⁃]\s*/, '');
  }

  function renderNoticeList(lines) {
    var items = (lines || []).map(function (line) { return String(line || ''); }).filter(function (line) { return line.trim(); });
    if (!items.length) return '';
    var numbered = items.every(function (line) { return /^\s*\d+\.\s/.test(line); });
    var html = '<ul class="os-list' + (numbered ? ' os-list-plain' : '') + '">';
    items.forEach(function (line) {
      html += '<li>' + esc(numbered ? line.trim() : noticeLine(line)) + '</li>';
    });
    html += '</ul>';
    return html;
  }

  function renderCurriculum(form, existing) {
    var saved = existing && existing.answers ? existing.answers : {};
    var html = '<div class="os-form" data-kind="curriculum" data-survey="' + esc(form.surveyId) + '">';
    html += doneNote(existing);
    html += '<p class="os-doc">' + esc(form.groupLabel || '') + (form.docLabel ? ' · ' + esc(form.docLabel) : '') + '</p>';
    if (form.dateLine) html += '<p class="os-date">' + esc(form.dateLine) + '</p>';
    if (form.signer) html += '<p class="os-signer">' + esc(form.signer) + '</p>';
    html += '<div class="os-intro">' + esc(form.intro || '') + '</div>';
    html += '<p class="os-note">만족도 문항은 모두 선택해 주세요. 서술형은 비워 두어도 됩니다. 결과에는 학번과 이름을 표시하지 않습니다.</p>';
    var section = '';
    (form.questions || []).forEach(function (q) {
      if (q.section && q.section !== section) {
        section = q.section;
        html += '<h3>' + esc(section) + '</h3>';
      }
      if (q.type === 'long_text') {
        html += '<div class="os-q" data-qid="' + esc(q.id) + '" data-qtype="long_text">';
        html += '<div class="os-qtext"><span class="os-ind">' + esc(q.promptLabel || '서술형1)') + '</span>' + esc(q.text) + ' <span class="os-optional">(선택)</span></div>';
        html += '<textarea class="form-control" rows="5" maxlength="4000" placeholder="비워 두어도 제출할 수 있습니다.">' + esc(saved[q.id] || '') + '</textarea>';
        html += '</div>';
        return;
      }
      html += '<div class="os-q" data-qid="' + esc(q.id) + '" data-qtype="likert5">';
      html += '<div class="os-qtext"><span class="os-ind">' + esc(q.indicator || q.id) + '</span>' + esc(q.text) + ' <span class="os-req">필수</span></div>';
      html += '<div class="os-likert">';
      (q.options || []).forEach(function (opt) {
        var checked = saved[q.id] === opt ? ' checked' : '';
        html += '<label><input type="radio" name="osq-' + esc(form.surveyId) + '-' + esc(q.id) + '" value="' + esc(opt) + '"' + checked + '> ' + esc(opt) + '</label>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function field(label, id, value, kind) {
    var control;
    if (kind === 'textarea') {
      control = '<textarea class="form-control" rows="3" maxlength="2000" data-pfield="' + esc(id) + '">' + esc(value || '') + '</textarea>';
    } else {
      control = '<input class="form-control" maxlength="200" data-pfield="' + esc(id) + '" value="' + esc(value || '') + '">';
    }
    return '<label class="os-field"><span>' + esc(label) + '</span>' + control + '</label>';
  }

  function proposalCard(index, item) {
    item = item || {};
    return '<div class="os-proposal" data-proposal>' +
      '<div class="d-flex justify-content-between align-items-center mb-2"><strong>제안 <span data-proposal-seq>' + (index + 1) + '</span></strong>' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-remove-proposal>삭제</button></div>' +
      field('사업명', 'title', item.title, 'text') +
      field('사업내용', 'content', item.content, 'textarea') +
      field('예산요구액', 'amount', item.amount, 'text') +
      field('요구사유', 'reason', item.reason, 'textarea') +
      '</div>';
  }

  function identityControl(fieldInfo, value, locked) {
    var val = value == null ? '' : String(value);
    var attr = ' data-identity="' + esc(fieldInfo.id) + '"' + (locked ? ' readonly' : '');
    var gradeLike = fieldInfo.id === 'grade' || fieldInfo.id === 'child_grade';
    var numLike = fieldInfo.id === 'class' || fieldInfo.id === 'child_class' || fieldInfo.id === 'number' || fieldInfo.id === 'child_number';
    if (!locked && gradeLike) {
      var opts = ['1', '2', '3'].map(function (g) {
        return '<option value="' + g + '"' + (val === g ? ' selected' : '') + '>' + g + '학년</option>';
      }).join('');
      return '<select class="form-select"' + attr + '><option value="">선택</option>' + opts + '</select>';
    }
    if (!locked && numLike) return '<input class="form-control" inputmode="numeric" maxlength="2" value="' + esc(val) + '"' + attr + '>';
    var type = fieldInfo.id === 'phone' ? 'tel' : 'text';
    return '<input class="form-control" type="' + type + '" maxlength="50" value="' + esc(val) + '"' + attr + '>';
  }

  function renderBudget(form, existing) {
    var savedIdentity = {};
    if (form.identityPrefill) {
      Object.keys(form.identityPrefill).forEach(function (k) { savedIdentity[k] = form.identityPrefill[k]; });
    }
    if (existing && existing.identity && !form.identityLocked) {
      Object.keys(existing.identity).forEach(function (k) { savedIdentity[k] = existing.identity[k]; });
    }
    var items = existing && existing.proposals && existing.proposals.length ? existing.proposals : [{}];
    var html = '<div class="os-form" data-kind="budget" data-os-budget data-survey="' + esc(form.surveyId) + '">';
    html += doneNote(existing);
    html += '<p class="os-doc">' + esc(form.heading || form.title) + ' · ' + esc(form.groupLabel || '') + '</p>';
    html += '<p class="os-note">제안하고 싶은 사업이 있을 때만 작성하면 됩니다. 최대 3건이며, 사업명만 적어도 됩니다.</p>';
    html += renderNoticeList(form.instructions);
    if (form.example) {
      html += '<p class="os-optional">예시 (제출되지 않습니다)</p><div style="overflow-x:auto"><table class="os-example"><thead><tr><th>순</th><th>사업명</th><th>사업내용</th><th>예산요구액</th><th>요구사유</th></tr></thead><tbody><tr><td>1</td><td>' +
        esc(form.example.title) + '</td><td>' + esc(form.example.content) + '</td><td>' + esc(form.example.amount) + '</td><td>' + esc(form.example.reason) + '</td></tr></tbody></table></div>';
    }
    html += '<h3>제안자</h3><div class="os-grid">';
    (form.identityFields || []).forEach(function (info) {
      html += '<label class="os-field"><span>' + esc(info.label) + '</span>' +
        identityControl(info, savedIdentity[info.id], !!form.identityLocked) + '</label>';
    });
    html += '</div>';
    if (form.identityLocked) html += '<p class="os-optional">학년·반·번호·이름은 로그인한 계정으로 채웁니다.</p>';
    html += '<div data-proposal-list>' + items.map(function (item, i) { return proposalCard(i, item); }).join('') + '</div>';
    html += '<button type="button" class="btn btn-outline-primary w-100 mb-3" data-add-proposal>제안 추가 (최대 3건)</button>';
    if (form.footnote) html += '<p class="os-note">' + esc(form.footnote) + '</p>';
    var privacy = form.privacy || {};
    html += '<div class="os-privacy"><h3>' + esc(privacy.title || '개인정보 수집·이용 동의서') + '</h3>';
    if (privacy.body) html += '<p>' + esc(privacy.body) + '</p>';
    html += renderNoticeList(privacy.items);
    (privacy.notes || []).forEach(function (line) { html += '<p class="os-note">' + esc(line) + '</p>'; });
    if (form.under14Notice) html += '<p class="os-under14">' + esc(form.under14Notice) + '</p>';
    html += '<div class="os-qtext">' + esc(privacy.consentLabel || '개인정보 수집·이용 동의') + '</div><div class="os-consent">';
    (privacy.consentOptions || ['예', '아니요']).forEach(function (opt) {
      var checked = existing && existing.consent === opt ? ' checked' : '';
      html += '<label><input type="radio" data-consent name="os-consent-' + esc(form.surveyId) + '" value="' + esc(opt) + '"' + checked + '> ' + esc(opt) + '</label>';
    });
    html += '</div></div></div>';
    return html;
  }

  function refreshProposalControls(root) {
    if (!root) return;
    var cards = root.querySelectorAll('[data-proposal]');
    for (var i = 0; i < cards.length; i++) {
      var seq = cards[i].querySelector('[data-proposal-seq]');
      if (seq) seq.textContent = String(i + 1);
      var rm = cards[i].querySelector('[data-remove-proposal]');
      if (rm) rm.hidden = cards.length <= 1;
    }
    var add = root.querySelector('[data-add-proposal]');
    if (add) add.hidden = cards.length >= 3;
  }

  function mount(root) {
    if (!root) return;
    var boxes = root.querySelectorAll ? root.querySelectorAll('[data-os-budget]') : [];
    for (var i = 0; i < boxes.length; i++) refreshProposalControls(boxes[i]);
  }

  function readCurriculum(root) {
    var answers = {};
    if (!root) return answers;
    var nodes = root.querySelectorAll('[data-qid]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var id = el.getAttribute('data-qid');
      if (el.getAttribute('data-qtype') === 'long_text') {
        var area = el.querySelector('textarea');
        answers[id] = area ? area.value : '';
      } else {
        var checked = el.querySelector('input[type="radio"]:checked');
        answers[id] = checked ? checked.value : '';
      }
    }
    return answers;
  }

  function readBudget(root) {
    var identity = {};
    var proposals = [];
    var consent = '';
    if (!root) return { identity: identity, consent: consent, proposals: proposals };
    var fields = root.querySelectorAll('[data-identity]');
    for (var i = 0; i < fields.length; i++) identity[fields[i].getAttribute('data-identity')] = fields[i].value;
    var consentEl = root.querySelector('[data-consent]:checked');
    if (consentEl) consent = consentEl.value;
    var cards = root.querySelectorAll('[data-proposal]');
    for (var c = 0; c < cards.length; c++) {
      var item = {};
      var inputs = cards[c].querySelectorAll('[data-pfield]');
      for (var j = 0; j < inputs.length; j++) item[inputs[j].getAttribute('data-pfield')] = inputs[j].value;
      proposals.push(item);
    }
    return { identity: identity, consent: consent, proposals: proposals };
  }

  function problems(kind, form, data) {
    if (kind === 'sdq') {
      var answers = data || {};
      for (var n = 1; n <= 25; n++) {
        var v = answers[String(n)];
        if (v !== 0 && v !== 1 && v !== 2 && v !== '0' && v !== '1' && v !== '2') {
          return '25문항을 모두 선택해 주세요. (' + n + '번)';
        }
      }
      return '';
    }
    if (kind === 'curriculum') {
      var questions = (form && form.questions) || [];
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].type === 'likert5') {
          var options = questions[i].options || [];
          if (options.indexOf(data[questions[i].id]) < 0) return '만족도 문항은 모두 선택해 주세요.';
        }
      }
      return '';
    }
    if (!data || data.consent !== '예') return '개인정보 수집·이용에 「예」로 동의해야 제출할 수 있습니다.';
    var filled = 0;
    var list = data.proposals || [];
    for (var p = 0; p < list.length; p++) {
      var item = list[p] || {};
      var title = String(item.title || '').trim();
      var rest = String(item.content || '').trim() || String(item.amount || '').trim() || String(item.reason || '').trim();
      if (!title && !rest) continue;
      if (!title) return '제출할 때는 사업명을 적어 주세요. 내용·예산요구액·요구사유는 비워도 됩니다.';
      filled += 1;
    }
    if (filled < 1 || filled > 3) return '제출할 때는 사업명을 1건 이상 3건 이하로 적어 주세요.';
    var fields = (form && form.identityFields) || [];
    if (!form || !form.identityLocked) {
      for (var f = 0; f < fields.length; f++) {
        if (fields[f].required && !String((data.identity || {})[fields[f].id] || '').trim()) {
          return fields[f].label + '을(를) 입력해 주세요.';
        }
      }
    }
    return '';
  }

  function renderSdqDone(form) {
    var who = form && form.identity ? form.identity : {};
    var html = '<div class="os-sdq-done" data-kind="sdq" data-sdq-done="1">';
    html += '<p class="os-done">이번 회차 응답을 마쳤습니다.' + (form && form.wave ? ' (회차 ' + esc(form.wave) + ')' : '') + '</p>';
    html += '<p class="os-note">다시 응답하면 이전 응답은 남지 않고 새 답으로 바뀝니다. 점수도 새 답으로 다시 계산됩니다.</p>';
    if (who.name) {
      html += '<p class="os-note">' + esc(who.grade) + '학년 ' + esc(who.classNo) + '반 ' + esc(who.number) + '번 ' + esc(who.name) + '</p>';
    }
    html += '<button type="button" class="btn btn-primary fw-bold w-100" data-sdq-retry>다시 응답하기</button>';
    html += '</div>';
    return html;
  }

  function renderSdq(form, existing) {
    var saved = existing && existing.answers ? existing.answers : {};
    var who = form && form.identity ? form.identity : {};
    var html = '<div class="os-form" data-kind="sdq" data-survey="' + esc(form.surveyId) + '">';
    if (existing) {
      html += '<p class="os-done">다시 제출하면 이번 회차의 이전 응답을 새 답으로 바꿉니다. 아래에는 마지막 응답을 채워 두었습니다.</p>';
    }
    html += '<p class="os-doc">강점·난점 설문지 (SDQ-Kr) · 자기보고용 · 회차 ' + esc(form.wave || '') + '</p>';
    if (who.name) {
      html += '<p class="os-note">저장되는 학생: ' + esc(who.grade) + '학년 ' + esc(who.classNo) + '반 ' + esc(who.number) + '번 ' + esc(who.name) + ' (' + esc(who.studentId) + ')</p>';
    }
    html += '<div class="os-intro">' + esc(form.intro || '') + '</div>';
    if (form.notice) html += '<p class="os-note">' + esc(form.notice) + '</p>';
    (form.questions || []).forEach(function (q) {
      html += '<div class="os-q" data-qid="' + esc(q.id) + '" data-qtype="sdq">';
      html += '<div class="os-qtext"><span class="os-ind">' + esc(q.number || q.id) + '.</span>' + esc(q.text) + '</div>';
      html += '<div class="os-likert">';
      (q.options || []).forEach(function (opt) {
        var value = opt.value != null ? opt.value : opt;
        var label = opt.label != null ? opt.label : opt;
        var checked = String(saved[q.id]) === String(value) ? ' checked' : '';
        html += '<label><input type="radio" name="sdq-' + esc(q.id) + '" value="' + esc(value) + '"' + checked + '> ' + esc(label) + '</label>';
      });
      html += '</div></div>';
    });
    html += '<p class="os-optional">문항: 한국어판 강점·난점 설문지(SDQ-Kr) 자기보고용. 안정숙·전성균·한준규·노경선·Robert Goodman(2003).</p>';
    html += '</div>';
    return html;
  }

  function readSdq(root) {
    var answers = {};
    if (!root) return answers;
    var nodes = root.querySelectorAll('[data-qtype="sdq"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var checked = el.querySelector('input[type="radio"]:checked');
      answers[el.getAttribute('data-qid')] = checked ? Number(checked.value) : '';
    }
    return answers;
  }

  function formatKst(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(date);
      var get = function (type) {
        var found = null;
        for (var i = 0; i < parts.length; i++) if (parts[i].type === type) found = parts[i];
        return found ? found.value : '';
      };
      var hour = get('hour') === '24' ? '00' : get('hour');
      return get('year') + '-' + get('month') + '-' + get('day') + ' ' + hour + ':' + get('minute');
    } catch (e) {
      return '';
    }
  }

  function sdqWhen(row) {
    var time = formatKst(row && row.updatedAt);
    var badge = row && row.revised ? ' <span class="os-band os-band-borderline">재응답</span>' : '';
    return (time || '-') + badge;
  }

  function bandMark(band) {
    if (!band) return '';
    var id = band.id || 'normal';
    return '<span class="os-band os-band-' + esc(id) + '">' + esc(band.label || '') + '</span>';
  }

  function renderSdqStats(view) {
    var stats = view.stats || {};
    var all = stats.all || { count: 0, options: [], mean: null };
    var html = '<section class="os-sdq-stats"><h3>전체 · 학년별 위험 수준 <span class="os-count">채점 ' + Number(all.count || 0) + '명</span></h3>';
    html += '<p class="os-meta">총난점 분포입니다. 학년·반 필터와 상관없이 이번 회차 전체입니다.';
    if (all.mean != null) html += ' 평균 총난점 ' + Number(all.mean).toFixed(2) + '.';
    html += '</p>';
    html += renderBandBars(all);
    (stats.byGrade || []).forEach(function (g) {
      html += '<h4>' + esc(g.grade) + '학년 <span class="os-count">' + Number(g.count || 0) + '명</span></h4>';
      html += renderBandBars(g);
    });
    if (stats.scales && stats.scales.length) {
      html += '<h4>하위척도 분포 (전체)</h4><div class="os-sdq-tablewrap"><table class="os-table os-sdq-scale"><thead><tr><th>척도</th><th>정상</th><th>경계</th><th>임상</th><th>평균</th></tr></thead><tbody>';
      stats.scales.forEach(function (scale) {
        html += '<tr><td>' + esc(scale.label) + '</td><td>' + Number(scale.bands.정상 || 0) + '</td><td>' + Number(scale.bands.경계 || 0) + '</td><td>' + Number(scale.bands.임상 || 0) + '</td><td>' + (scale.mean == null ? '-' : Number(scale.mean).toFixed(2)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<div class="os-sdq-legend"><p class="os-meta">자기보고 표준 3밴드입니다. 친사회성은 높을수록 강점이고, 임상은 0–4입니다.</p><ul class="os-list">';
    (view.cutoffs || []).forEach(function (row) {
      html += '<li>' + esc(row.label) + ' 정상 ' + esc(row.normal) + ' · 경계 ' + esc(row.borderline) + ' · 임상 ' + esc(row.clinical) + (row.note ? ' (' + esc(row.note) + ')' : '') + '</li>';
    });
    html += '</ul></div></section>';
    return html;
  }

  function renderBandBars(dist) {
    var html = '';
    (dist.options || []).forEach(function (opt) {
      var width = Math.max(0, Math.min(100, Number(opt.pct) || 0));
      var id = opt.label === '임상' ? 'clinical' : (opt.label === '경계' ? 'borderline' : 'normal');
      html += '<div class="os-optrow"><div>' + bandMark({ label: opt.label, id: id }) + '</div><div class="os-bar os-bar-' + id + '" role="img" aria-label="' + esc(opt.label) + ' ' + opt.count + '"><span style="width:' + width + '%"></span></div><div class="os-optnum">' + opt.count + '명 (' + opt.pct + '%)</div></div>';
    });
    return html;
  }

  function sdqScoreCell(scores, bands, key) {
    if (!scores) return '<td>-</td>';
    return '<td><b>' + Number(scores[key]) + '</b> ' + bandMark(bands[key]) + '</td>';
  }

  function renderSdqStudentTable(students) {
    var html = '<div class="os-sdq-desktop"><div class="os-sdq-tablewrap"><table class="os-table os-sdq-table"><thead><tr><th>위험</th><th>학년</th><th>반</th><th>번호</th><th>이름</th><th>학번</th><th>최근 제출</th><th>정서</th><th>품행</th><th>과잉</th><th>또래</th><th>친사회</th><th>총난점</th></tr></thead><tbody>';
    students.forEach(function (row) {
      html += '<tr><td>' + bandMark(row.bands && row.bands.total) + '</td><td>' + esc(row.grade) + '</td><td>' + esc(row.classNo) + '</td><td>' + esc(row.number) + '</td><td>' + esc(row.name) + '</td><td>' + esc(row.studentId) + '</td><td>' + sdqWhen(row) + '</td>';
      html += sdqScoreCell(row.scores, row.bands, 'emotional');
      html += sdqScoreCell(row.scores, row.bands, 'conduct');
      html += sdqScoreCell(row.scores, row.bands, 'hyperactivity');
      html += sdqScoreCell(row.scores, row.bands, 'peer');
      html += sdqScoreCell(row.scores, row.bands, 'prosocial');
      html += sdqScoreCell(row.scores, row.bands, 'total');
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function renderSdqStudentCards(students) {
    var html = '<div class="os-sdq-mobile">';
    students.forEach(function (row) {
      var id = row.bands && row.bands.total ? row.bands.total.id : 'normal';
      html += '<article class="os-sdq-card os-sdq-card-' + esc(id) + '">';
      html += '<div class="os-sdq-who">' + bandMark(row.bands && row.bands.total) + ' ' + esc(row.grade) + '학년 ' + esc(row.classNo) + '반 ' + esc(row.number) + '번 ' + esc(row.name) + '</div>';
      html += '<div class="os-optional">' + esc(row.studentId) + ' · ' + sdqWhen(row) + '</div>';
      if (!row.scores) {
        html += '<p class="os-empty">채점할 수 없는 응답입니다.</p>';
      } else {
        html += '<div class="os-sdq-total">총난점 <b>' + Number(row.scores.total) + '</b></div>';
        html += '<div class="os-sdq-scales">정서 ' + row.scores.emotional + ' ' + bandMark(row.bands.emotional);
        html += ' · 품행 ' + row.scores.conduct + ' ' + bandMark(row.bands.conduct);
        html += ' · 과잉 ' + row.scores.hyperactivity + ' ' + bandMark(row.bands.hyperactivity);
        html += ' · 또래 ' + row.scores.peer + ' ' + bandMark(row.bands.peer);
        html += ' · 친사회 ' + row.scores.prosocial + ' ' + bandMark(row.bands.prosocial) + '</div>';
      }
      html += '</article>';
    });
    html += '</div>';
    return html;
  }

  function renderSdqResults(view) {
    if (!view) return '<p class="os-empty">결과가 없습니다.</p>';
    var html = '<div class="os-results os-sdq-results">';
    html += '<h2>' + esc(view.title) + '</h2>';
    html += '<p class="os-meta">회차 ' + esc(view.wave) + ' · ' + esc(view.gradeLabel) + ' · ' + esc(view.classLabel) + ' · 명단 ' + Number(view.responseCount || 0) + '명</p>';
    html += '<p class="os-note">임상 학생을 위에 두고, 같은 수준에서는 총난점이 높은 순입니다. 선별 참고 점수이며 진단이 아닙니다. 같은 회차에 다시 제출한 학생은 마지막 응답과 그 시각만 보입니다.</p>';
    html += renderSdqStats(view);
    var students = view.students || [];
    if (!students.length) {
      html += '<p class="os-empty">이 조건의 응답이 없습니다.</p></div>';
      return html;
    }
    if (view.unscoredCount) html += '<p class="os-note">채점할 수 없는 응답 ' + Number(view.unscoredCount) + '건이 명단 아래에 있습니다.</p>';
    html += '<h3>학생별 결과</h3>';
    html += renderSdqStudentTable(students);
    html += renderSdqStudentCards(students);
    html += '</div>';
    return html;
  }

  function syncSurveySelect(select, allowed) {
    if (!select || !select.querySelector || !select.appendChild) return false;
    var existing = select.querySelector('option[value="sdq_kr"]');
    if (!allowed) {
      if (existing) {
        if (select.value === 'sdq_kr') {
          var fallback = select.querySelector('option[value="curriculum_sat_2026"]');
          if (fallback) select.value = fallback.value;
        }
        if (existing.remove) existing.remove();
        else if (existing.parentNode) existing.parentNode.removeChild(existing);
      }
      return false;
    }
    if (existing) return true;
    var doc = select.ownerDocument;
    if (!doc || !doc.createElement) return false;
    var opt = doc.createElement('option');
    opt.value = 'sdq_kr';
    opt.textContent = 'SDQ 정신건강 설문';
    select.appendChild(opt);
    return true;
  }

  function renderParticipation(report) {
    var surveys = report && report.surveys ? report.surveys : [];
    if (!surveys.length) return '';
    var html = '<div class="os-results os-participation">';
    surveys.forEach(function (survey) {
      html += '<section class="os-part">';
      html += '<h3>참여 현황 · ' + esc(survey.title) + '</h3>';
      if (survey.wave) html += '<p class="os-meta">회차 ' + esc(survey.wave) + ' · 응답 여부만 표시합니다. 문항 답과 위험 수준은 여기에 없습니다.</p>';
      else html += '<p class="os-meta">학생 응답만 집계합니다. 학부모·교사 응답은 아래 결과에서 봅니다.</p>';
      if (survey.warning) html += '<p class="os-note">' + esc(survey.warning) + '</p>';
      if (survey.unavailable) {
        html += '</section>';
        return;
      }
      var lowRate = Number(survey.lowRate || (report && report.lowRate) || 70);
      html += '<p class="os-meta">재적 학생 대비 응답입니다. 참여율 ' + lowRate + '% 미만인 반은 색으로 표시했습니다. 반을 누르면 아직 응답하지 않은 학생의 번호와 이름이 나옵니다.</p>';
      if (!survey.grades || !survey.grades.length) {
        html += '<p class="os-empty">재적 학생이 없습니다.</p></section>';
        return;
      }
      html += '<div class="os-sdq-tablewrap"><table class="os-table os-part-table"><thead><tr><th>학년</th><th>반</th><th>응답</th><th>재적</th><th>참여율</th></tr></thead><tbody>';
      (survey.grades || []).forEach(function (grade) {
        (grade.classes || []).forEach(function (cls) {
          var key = String(survey.id) + '-' + grade.grade + '-' + cls.classNo;
          var label = grade.grade + '학년 ' + cls.classNo + '반 미응답 보기';
          html += '<tr class="os-part-class' + (cls.low ? ' os-part-low' : '') + '" data-part-key="' + esc(key) + '">';
          html += '<td>' + esc(grade.grade) + '</td>';
          html += '<td><button type="button" class="os-part-open" aria-expanded="false" aria-label="' + esc(label) + '">' + esc(cls.classNo) + '반</button></td>';
          html += '<td>' + Number(cls.responded || 0) + '</td>';
          html += '<td>' + Number(cls.enrolled || 0) + '</td>';
          html += '<td class="os-part-rate">' + esc(cls.rate) + '%</td></tr>';
          html += '<tr class="os-part-missing" data-part-panel="' + esc(key) + '" hidden><td colspan="5">';
          if (!cls.missing || !cls.missing.length) html += '이 반은 모두 응답했습니다.';
          else {
            html += '<div class="os-part-misshead">미응답 ' + cls.missing.length + '명</div>';
            cls.missing.forEach(function (stu) {
              html += '<span class="os-part-name">' + esc(stu.number) + '번 ' + esc(stu.name) + '</span>';
            });
          }
          html += '</td></tr>';
        });
        html += '<tr class="os-part-sub' + (grade.low ? ' os-part-low' : '') + '"><td>' + esc(grade.grade) + '</td><td>소계</td><td>' + Number(grade.responded || 0) + '</td><td>' + Number(grade.enrolled || 0) + '</td><td class="os-part-rate">' + esc(grade.rate) + '%</td></tr>';
      });
      html += '<tr class="os-part-total' + (survey.low ? ' os-part-low' : '') + '"><td colspan="2">학교 전체</td><td>' + Number(survey.responded || 0) + '</td><td>' + Number(survey.enrolled || 0) + '</td><td class="os-part-rate">' + esc(survey.rate) + '%</td></tr>';
      html += '</tbody></table></div></section>';
    });
    html += '</div>';
    return html;
  }

  function renderResults(view) {
    if (!view) return '<p class="os-empty">결과가 없습니다.</p>';
    var html = '<div class="os-results">';
    html += '<h2>' + esc(view.title) + '</h2>';
    html += '<p class="os-meta">' + esc(view.groupLabel) + ' · ' + esc(view.gradeLabel) + '</p>';
    if (view.surveyId === 'curriculum_sat_2026') {
      html += '<p class="os-meta">평균은 매우 그렇다 5점 · 그렇다 4점 · 보통이다 3점 · 그렇지않다 2점 · 전혀 그렇지 않다 1점입니다. 학번과 이름은 표시하지 않습니다.</p>';
    }
    (view.sections || []).forEach(function (sec) {
      html += '<section><h3>' + esc(sec.groupLabel) + ' <span class="os-count">응답 ' + Number(sec.responseCount || 0) + '건</span></h3>';
      if (sec.gradeAvailable) {
        html += '<p class="os-meta">학년 분포 ' + [1, 2, 3].map(function (g) {
          var n = sec.gradeCounts ? (sec.gradeCounts[g] || sec.gradeCounts[String(g)] || 0) : 0;
          return g + '학년 ' + n + '건';
        }).join(' · ') + '</p>';
      }
      if (sec.proposalCount != null) html += '<p class="os-meta">제안 ' + Number(sec.proposalCount) + '건</p>';
      if (sec.note) html += '<p class="os-note">' + esc(sec.note) + '</p>';
      var section = '';
      (sec.questions || []).forEach(function (q) {
        if (q.section && q.section !== section) {
          section = q.section;
          html += '<h4>' + esc(section) + '</h4>';
        }
        if (q.type === 'long_text') {
          html += '<article class="os-q"><div class="os-qtext"><span class="os-ind">' + esc(q.promptLabel || '서술형1)') + '</span>' + esc(q.text) + '</div>';
          if (!q.answers || !q.answers.length) html += '<p class="os-empty">서술형 응답이 없습니다.</p>';
          else q.answers.forEach(function (a) {
            html += '<blockquote class="os-open">' + (a.grade ? '<span class="os-ind">' + esc(a.grade) + '학년</span> ' : '') + esc(a.text) + '</blockquote>';
          });
          html += '</article>';
          return;
        }
        html += '<article class="os-q"><div class="os-qtext"><span class="os-ind">' + esc(q.indicator || q.id) + '</span>' + esc(q.text) + '</div>';
        html += '<div class="os-meta">평균 ' + (q.mean == null ? '-' : Number(q.mean).toFixed(2)) + ' / 5 · 응답 ' + Number(q.responseCount || 0) + '</div>';
        (q.options || []).forEach(function (opt) {
          var width = Math.max(0, Math.min(100, Number(opt.pct) || 0));
          html += '<div class="os-optrow"><div>' + esc(opt.label) + '</div><div class="os-bar" role="img" aria-label="' + esc(opt.label) + ' ' + opt.count + '"><span style="width:' + width + '%"></span></div><div class="os-optnum">' + opt.count + '명 (' + opt.pct + '%)</div></div>';
        });
        html += '</article>';
      });
      if (sec.proposals) html += renderProposals(sec);
      html += '</section>';
    });
    html += '</div>';
    return html;
  }

  function renderProposals(sec) {
    if (!sec.proposals.length) return '<p class="os-empty">제안이 없습니다.</p>';
    return sec.proposals.map(function (p, idx) {
      var idn = p.identity || {};
      var who = sec.group === 'student'
        ? esc(idn.grade) + '학년 ' + esc(idn.class) + '반 ' + esc(idn.number) + '번 ' + esc(idn.name)
        : '제안자 ' + esc(idn.proposer_name) + ' · ' + esc(idn.phone) + ' · 자녀 ' + esc(idn.child_grade) + '학년 ' + esc(idn.child_class) + '반 ' + (idn.child_number ? esc(idn.child_number) : '-') + '번 ' + esc(idn.child_name);
      var rows = (p.items || []).map(function (item, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(item.title) + '</td><td>' + esc(item.content) + '</td><td>' + esc(item.amount) + '</td><td>' + esc(item.reason) + '</td></tr>';
      }).join('');
      return '<article class="os-person"><h4>' + (idx + 1) + '. ' + who + '</h4><div style="overflow-x:auto"><table class="os-table"><thead><tr><th>순</th><th>사업명</th><th>사업내용</th><th>예산요구액</th><th>요구사유</th></tr></thead><tbody>' + rows + '</tbody></table></div></article>';
    }).join('');
  }

  function printResults(title, innerHtml) {
    var w = global.open ? global.open('', 'officialSurveyPrint') : null;
    if (!w) return;
    var css = (global.location && global.location.origin ? global.location.origin : '') + '/official-survey.css';
    w.document.open();
    w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(title) + '</title><link rel="stylesheet" href="' + esc(css) + '"></head><body>' + innerHtml + '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>');
    w.document.close();
  }

  var xlsxPromise = null;
  function loadXlsx() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = global.document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = function () { resolve(global.XLSX); };
      s.onerror = function () { xlsxPromise = null; reject(new Error('엑셀 라이브러리를 불러오지 못했습니다.')); };
      global.document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function downloadXlsx(sheets, filename) {
    return loadXlsx().then(function (XLSX) {
      var wb = XLSX.utils.book_new();
      (sheets || []).forEach(function (sheet) {
        var ws = XLSX.utils.aoa_to_sheet(sheet.rows || []);
        XLSX.utils.book_append_sheet(wb, ws, String(sheet.name || 'sheet').slice(0, 31));
      });
      XLSX.writeFile(wb, filename || '천중_공식조사_결과.xlsx');
    });
  }

  if (global.document && global.document.addEventListener) {
    global.document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var add = target.closest('[data-add-proposal]');
      if (add) {
        var box = add.closest('[data-os-budget]');
        var list = box && box.querySelector('[data-proposal-list]');
        if (!list || list.querySelectorAll('[data-proposal]').length >= 3) return;
        list.insertAdjacentHTML('beforeend', proposalCard(list.querySelectorAll('[data-proposal]').length, {}));
        refreshProposalControls(box);
        return;
      }
      var partRow = target.closest('[data-part-key]');
      if (partRow && partRow.parentNode) {
        var panel = partRow.parentNode.querySelector('[data-part-panel="' + String(partRow.getAttribute('data-part-key') || '').replace(/"/g, '') + '"]');
        if (panel) {
          panel.hidden = !panel.hidden;
          var opener = partRow.querySelector('.os-part-open');
          if (opener) opener.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
        }
        return;
      }
      var remove = target.closest('[data-remove-proposal]');
      if (remove) {
        var box2 = remove.closest('[data-os-budget]');
        if (!box2 || box2.querySelectorAll('[data-proposal]').length <= 1) return;
        var card = remove.closest('[data-proposal]');
        if (card) card.remove();
        refreshProposalControls(box2);
      }
    });
  }

  global.OfficialSurvey = {
    esc: esc,
    renderCurriculum: renderCurriculum,
    renderBudget: renderBudget,
    renderSdq: renderSdq,
    renderSdqDone: renderSdqDone,
    renderParticipation: renderParticipation,
    readCurriculum: readCurriculum,
    readBudget: readBudget,
    readSdq: readSdq,
    problems: problems,
    renderResults: renderResults,
    renderSdqResults: renderSdqResults,
    syncSurveySelect: syncSurveySelect,
    printResults: printResults,
    downloadXlsx: downloadXlsx,
    mount: mount
  };
})(typeof window !== 'undefined' ? window : globalThis);
