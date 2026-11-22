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

  function renderCurriculum(form, existing) {
    var saved = existing && existing.answers ? existing.answers : {};
    var html = '<div class="os-form" data-kind="curriculum" data-survey="' + esc(form.surveyId) + '">';
    html += doneNote(existing);
    html += '<p class="os-doc">' + esc(form.groupLabel || '') + (form.docLabel ? ' · ' + esc(form.docLabel) : '') + '</p>';
    if (form.dateLine) html += '<p class="os-date">' + esc(form.dateLine) + '</p>';
    if (form.signer) html += '<p class="os-signer">' + esc(form.signer) + '</p>';
    html += '<div class="os-intro">' + esc(form.intro || '') + '</div>';
    html += '<p class="os-note">만족도 문항은 모두 필수입니다. 서술형은 선택입니다. 이 조사는 마일리지를 지급하지 않으며, 결과에는 학번과 이름을 표시하지 않습니다.</p>';
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

  function field(label, id, value, required, kind) {
    var req = required ? ' <span class="os-req">필수</span>' : ' <span class="os-optional">(선택)</span>';
    var control;
    if (kind === 'textarea') {
      control = '<textarea class="form-control" rows="3" maxlength="2000" data-pfield="' + esc(id) + '">' + esc(value || '') + '</textarea>';
    } else {
      control = '<input class="form-control" maxlength="200" data-pfield="' + esc(id) + '" value="' + esc(value || '') + '">';
    }
    return '<label class="os-field"><span>' + esc(label) + req + '</span>' + control + '</label>';
  }

  function proposalCard(index, item) {
    item = item || {};
    return '<div class="os-proposal" data-proposal>' +
      '<div class="d-flex justify-content-between align-items-center mb-2"><strong>제안 <span data-proposal-seq>' + (index + 1) + '</span></strong>' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-remove-proposal>삭제</button></div>' +
      field('사업명', 'title', item.title, true, 'text') +
      field('사업내용', 'content', item.content, false, 'textarea') +
      field('예산요구액', 'amount', item.amount, false, 'text') +
      field('요구사유', 'reason', item.reason, false, 'textarea') +
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
    html += '<p class="os-note">이 조사는 마일리지를 지급하지 않습니다. 사업은 1건 이상 3건 이하이며, 사업명만 적어도 됩니다.</p>';
    if (form.instructions && form.instructions.length) {
      html += '<ul class="os-list">';
      form.instructions.forEach(function (line) { html += '<li>' + esc(line) + '</li>'; });
      html += '</ul>';
    }
    if (form.example) {
      html += '<p class="os-optional">예시 (제출되지 않습니다)</p><div style="overflow-x:auto"><table class="os-example"><thead><tr><th>순</th><th>사업명</th><th>사업내용</th><th>예산요구액</th><th>요구사유</th></tr></thead><tbody><tr><td>1</td><td>' +
        esc(form.example.title) + '</td><td>' + esc(form.example.content) + '</td><td>' + esc(form.example.amount) + '</td><td>' + esc(form.example.reason) + '</td></tr></tbody></table></div>';
    }
    html += '<h3>제안자</h3><div class="os-grid">';
    (form.identityFields || []).forEach(function (info) {
      html += '<label class="os-field"><span>' + esc(info.label) + (info.required ? ' <span class="os-req">필수</span>' : ' <span class="os-optional">(선택)</span>') + '</span>' +
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
    html += '<ul class="os-list">';
    (privacy.items || []).forEach(function (line) { html += '<li>' + esc(line) + '</li>'; });
    html += '</ul>';
    (privacy.notes || []).forEach(function (line) { html += '<p class="os-note">' + esc(line) + '</p>'; });
    if (form.under14Notice) html += '<p class="os-under14">' + esc(form.under14Notice) + '</p>';
    html += '<div class="os-qtext">' + esc(privacy.consentLabel || '개인정보 수집·이용 동의') + ' <span class="os-req">필수</span></div><div class="os-consent">';
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
      if (!title) return '사업명을 입력해 주세요. 내용·예산요구액·요구사유는 비워도 됩니다.';
      filled += 1;
    }
    if (filled < 1 || filled > 3) return '사업 제안은 1건 이상 3건 이하로 적어 주세요.';
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
    readCurriculum: readCurriculum,
    readBudget: readBudget,
    problems: problems,
    renderResults: renderResults,
    printResults: printResults,
    downloadXlsx: downloadXlsx,
    mount: mount
  };
})(typeof window !== 'undefined' ? window : globalThis);
