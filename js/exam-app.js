/**
 * SQL Exam Student Application Logic
 * - Supports Category filter ("ALL" | "SQL 기초" | "SQL 활용" | "SQL 응용")
 * - Supports Type filter ("choice" | "sql" | "all")
 * - Per-question strict countdown timer (Choice: 60s / Subjective: 120s)
 * - Auto-submits and advances to the next question on timeout or '다음' button click
 * - Blocks backward navigation and hides explanations until the exam is finished
 */
(function (global) {
  'use strict';

  let selectedCategory = 'ALL';
  let selectedType = 'choice';

  // Active Exam State
  let examSession = null;
  let timerIntervalId = null;
  let currentSelectedChoice = null;
  let isSubmittingQuestion = false;
  let lastFinishedSubmission = null;
  let currentReviewFilter = 'all';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function showToast(msg) {
    const toastEl = document.getElementById('toast-notification');
    const msgEl = document.getElementById('toast-message');
    if (!toastEl || !msgEl) return;
    msgEl.textContent = msg;
    toastEl.classList.remove('hidden');
    setTimeout(function () {
      toastEl.classList.add('hidden');
    }, 3200);
  }

  function getFilteredQuestions(categoryFilter, typeFilter) {
    const allQs = global.SqlExamStorage.getQuestions();
    return allQs.filter(function (q) {
      const catMatch = categoryFilter === 'ALL' || q.category === categoryFilter;
      const typeMatch = typeFilter === 'all' || q.type === typeFilter;
      return catMatch && typeMatch;
    });
  }

  function updateStartFilterSummaryUI() {
    const settings = global.SqlExamStorage.getSettings();
    const catButtons = document.querySelectorAll('#category-select-group .cat-opt-btn');
    catButtons.forEach(function (btn) {
      const isSelected = btn.getAttribute('data-cat') === selectedCategory;
      btn.className = isSelected
        ? 'cat-opt-btn bg-indigo-600 text-white border border-indigo-400 font-bold text-xs py-2.5 px-3 rounded-xl transition flex items-center justify-between'
        : 'cat-opt-btn bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 font-semibold text-xs py-2.5 px-3 rounded-xl transition flex items-center justify-between';
    });

    const typeButtons = document.querySelectorAll('#type-select-group .type-opt-btn');
    typeButtons.forEach(function (btn) {
      const isSelected = btn.getAttribute('data-type') === selectedType;
      btn.className = isSelected
        ? 'type-opt-btn bg-cyan-600/25 text-cyan-200 border border-cyan-400 font-bold text-xs py-2.5 px-3.5 rounded-xl transition flex items-center justify-between'
        : 'type-opt-btn bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 font-semibold text-xs py-2.5 px-3.5 rounded-xl transition flex items-center justify-between';
    });

    // Update question count badges for current category
    const cntChoice = getFilteredQuestions(selectedCategory, 'choice').length;
    const cntSql = getFilteredQuestions(selectedCategory, 'sql').length;
    const cntAll = cntChoice + cntSql;

    const bChoice = document.getElementById('badge-cnt-choice');
    const bSql = document.getElementById('badge-cnt-sql');
    const bAll = document.getElementById('badge-cnt-all');
    if (bChoice) bChoice.textContent = cntChoice + '문항';
    if (bSql) bSql.textContent = cntSql + '문항';
    if (bAll) bAll.textContent = cntAll + '문항';

    const matchedQs = getFilteredQuestions(selectedCategory, selectedType);
    const catLabel = selectedCategory === 'ALL' ? '전체 단원' : selectedCategory;
    const typeLabel =
      selectedType === 'choice'
        ? '객관식'
        : selectedType === 'sql'
        ? '주관식'
        : '객관식+주관식 통합';

    let totalSeconds = 0;
    matchedQs.forEach(function (q) {
      totalSeconds += q.type === 'choice' ? (settings.choiceTimeLimit || 60) : (settings.sqlTimeLimit || 120);
    });
    const totalMinutes = Math.round(totalSeconds / 60);

    const titleEl = document.getElementById('start-summary-title');
    const timeEl = document.getElementById('start-summary-time');
    if (titleEl) {
      titleEl.textContent = catLabel + ' · ' + typeLabel + ' ' + matchedQs.length + '문항';
    }
    if (timeEl) {
      timeEl.textContent = '최대 ' + totalMinutes + '분';
    }
  }

  function selectStartFilter(kind, value) {
    if (kind === 'category') {
      selectedCategory = value;
    } else if (kind === 'type') {
      selectedType = value;
    }
    updateStartFilterSummaryUI();
  }

  function quickSelectPreset(category, type) {
    selectedCategory = category;
    selectedType = type;
    updateStartFilterSummaryUI();
    const nameInput = document.getElementById('input-student-name');
    if (nameInput) {
      nameInput.focus();
    }
    showToast('[' + category + ' - ' + (type === 'choice' ? '객관식 15문항' : '주관식 15문항') + '] 구성이 선택되었습니다. 이름을 입력하고 시작하세요!');
  }

  async function startExamSession() {
    const errorEl = document.getElementById('start-error-msg');
    if (errorEl) errorEl.classList.add('hidden');

    const nameInput = document.getElementById('input-student-name');
    const studentName = nameInput ? nameInput.value.trim() : '';
    if (!studentName) {
      if (errorEl) {
        errorEl.textContent = '응시자 성명을 입력해 주세요.';
        errorEl.classList.remove('hidden');
      }
      if (nameInput) nameInput.focus();
      return;
    }

    const settings = await global.SqlExamStorage.fetchSettingsFromCloud();
    if (!settings.examOpen) {
      if (errorEl) {
        errorEl.textContent = '현재 관리자에 의해 시험 응시가 일시 마감되었습니다.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (settings.blockDuplicateDevice !== false) {
      const existingDeviceId = global.SqlExamStorage.getDeviceId();
      const allSubs = await global.SqlExamStorage.fetchAllSubmissions();
      const normName = studentName.replace(/\s+/g, '').toLowerCase();

      const dupNameSub = allSubs.find(function (s) {
        return String(s.studentName || '').replace(/\s+/g, '').toLowerCase() === normName;
      });
      if (dupNameSub) {
        if (errorEl) {
          errorEl.textContent =
            '이미 [' + studentName + '] 성명으로 제출된 응시 기록이 존재하여 재응시가 불가능합니다. (재응시가 필요한 경우 관리자에게 기록 삭제를 요청하세요)';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      const dupDeviceSub = allSubs.find(function (s) {
        return s.deviceId && s.deviceId === existingDeviceId;
      });
      if (dupDeviceSub) {
        if (errorEl) {
          errorEl.textContent =
            '이미 이 기기(브라우저)에서 [' + dupDeviceSub.studentName + '] 성명으로 시험을 응시하셨습니다. 동일 기기 재응시는 불가능합니다.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
    }

    let pool = getFilteredQuestions(selectedCategory, selectedType);
    if (pool.length === 0) {
      if (errorEl) {
        errorEl.textContent = '선택한 조건에 해당하는 문제가 없습니다.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    // Applyconfigured per-question time limits
    pool = pool.map(function (q) {
      return Object.assign({}, q, {
        timeLimit: q.type === 'choice' ? (settings.choiceTimeLimit || 60) : (settings.sqlTimeLimit || 120),
      });
    });

    // Shuffle questions per test-taker
    if (settings.shuffleQuestions !== false) {
      pool = shuffleArray(pool);
    }

    const catLabel = selectedCategory === 'ALL' ? '전체 단원' : selectedCategory;
    const typeLabel =
      selectedType === 'choice'
        ? '객관식'
        : selectedType === 'sql'
        ? '주관식'
        : '통합';

    examSession = {
      studentName: studentName,
      categoryFilter: selectedCategory,
      typeFilter: selectedType,
      modeLabel: catLabel + ' · ' + typeLabel + ' (' + pool.length + '문항)',
      questions: pool,
      currentIndex: 0,
      questionStartedAt: Date.now(),
      details: [],
      startedAt: new Date().toISOString(),
    };

    global.SqlExamStorage.saveActiveSession(examSession);
    // Warm up SQLite WebAssembly engine in background
    global.SqlExamGrader.initSqlEngine();

    enterExamView();
  }

  function enterExamView() {
    document.getElementById('view-start').classList.add('hidden');
    document.getElementById('view-result').classList.add('hidden');
    document.getElementById('view-exam').classList.remove('hidden');

    const headerStatus = document.getElementById('header-exam-status');
    headerStatus.classList.remove('hidden');
    headerStatus.classList.add('flex');

    document.getElementById('timer-bar-wrap').classList.remove('hidden');
    document.getElementById('header-student-name').textContent = examSession.studentName;
    document.getElementById('sidebar-mode-badge').textContent = examSession.modeLabel;

    renderCurrentExamQuestion();
  }

  function renderSidebarGrid() {
    const gridEl = document.getElementById('exam-q-grid');
    if (!gridEl || !examSession) return;
    gridEl.innerHTML = '';

    examSession.questions.forEach(function (q, idx) {
      const pill = document.createElement('div');
      const isDone = idx < examSession.currentIndex;
      const isCurrent = idx === examSession.currentIndex;

      let cls =
        'h-8 rounded-lg text-xs code-font font-bold flex items-center justify-center select-none border ';
      if (isCurrent) {
        cls += 'bg-cyan-500/25 text-cyan-300 border-cyan-400 ring-2 ring-cyan-500/30';
      } else if (isDone) {
        cls += 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 opacity-80';
      } else {
        cls += 'bg-slate-900/80 text-slate-500 border-slate-800';
      }
      pill.className = cls;
      pill.title = isDone
        ? (idx + 1) + '번 문항 (제출 완료 · 이동 불가)'
        : isCurrent
        ? (idx + 1) + '번 문항 (현재 풀이 중)'
        : (idx + 1) + '번 문항 (대기 중)';
      pill.textContent = String(idx + 1).padStart(2, '0');
      gridEl.appendChild(pill);
    });
  }

  function renderCurrentExamQuestion() {
    if (!examSession) return;
    const idx = examSession.currentIndex;
    const total = examSession.questions.length;
    const q = examSession.questions[idx];
    if (!q) return;

    currentSelectedChoice = null;
    isSubmittingQuestion = false;

    renderSidebarGrid();

    // Update Header Progress
    document.getElementById('progress-text').textContent = (idx + 1) + ' / ' + total;

    // Update Question Badges
    const catBadge = document.getElementById('q-category-badge');
    catBadge.textContent = q.category + ' (' + (q.chapter || '') + ')';
    if (q.category === 'SQL 기초') {
      catBadge.className = 'bg-indigo-500/20 text-indigo-300 text-xs font-bold px-3 py-1 rounded-lg border border-indigo-500/30';
    } else if (q.category === 'SQL 활용') {
      catBadge.className = 'bg-cyan-500/20 text-cyan-300 text-xs font-bold px-3 py-1 rounded-lg border border-cyan-500/30';
    } else {
      catBadge.className = 'bg-emerald-500/20 text-emerald-300 text-xs font-bold px-3 py-1 rounded-lg border border-emerald-500/30';
    }

    const typeBadge = document.getElementById('q-type-badge');
    const limitSec = q.timeLimit || (q.type === 'choice' ? 60 : 120);
    const limitMinLabel = limitSec % 60 === 0 ? (limitSec / 60) + '분' : limitSec + '초';
    if (q.type === 'choice') {
      typeBadge.textContent = '객관식 4지선다 (제한시간 ' + limitMinLabel + ')';
      typeBadge.className = 'bg-amber-500/20 text-amber-300 text-xs font-bold px-3 py-1 rounded-lg border border-amber-500/30';
    } else {
      typeBadge.textContent = '주관식 SQL 작성 (제한시간 ' + limitMinLabel + ')';
      typeBadge.className = 'bg-purple-500/20 text-purple-300 text-xs font-bold px-3 py-1 rounded-lg border border-purple-500/30';
    }

    document.getElementById('q-number-label').textContent =
      '문항 ' + String(idx + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0');

    // Question Title & Description
    document.getElementById('q-title').textContent = q.title;
    const descBox = document.getElementById('q-desc-box');
    const descEl = document.getElementById('q-desc');
    if (q.description && q.description.trim()) {
      descEl.textContent = q.description;
      descBox.classList.remove('hidden');
    } else {
      descEl.textContent = '';
      descBox.classList.add('hidden');
    }

    // Choice Options vs SQL Textarea
    const choiceContainer = document.getElementById('choice-options-container');
    const sqlContainer = document.getElementById('sql-input-container');
    const sqlTextarea = document.getElementById('user-sql-answer');

    if (q.type === 'choice') {
      sqlContainer.classList.add('hidden');
      choiceContainer.classList.remove('hidden');
      choiceContainer.innerHTML = '';

      (q.options || []).forEach(function (optText, optIndex) {
        const optNum = optIndex + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'option-btn w-full text-left p-4 rounded-xl border border-slate-700 bg-slate-900/80 flex items-start gap-3.5 group';
        btn.onclick = function () {
          selectChoiceOption(optNum);
        };
        btn.setAttribute('data-opt', String(optNum));

        const numCircle = document.createElement('span');
        numCircle.className =
          'opt-circle w-7 h-7 rounded-lg bg-slate-800 border border-slate-600 text-slate-300 code-font text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5 transition';
        numCircle.textContent = String(optNum);

        const textSpan = document.createElement('span');
        textSpan.className = 'text-sm sm:text-base text-slate-200 leading-relaxed flex-grow';
        textSpan.textContent = optText;

        btn.appendChild(numCircle);
        btn.appendChild(textSpan);
        choiceContainer.appendChild(btn);
      });
    } else {
      choiceContainer.classList.add('hidden');
      sqlContainer.classList.remove('hidden');
      if (sqlTextarea) {
        sqlTextarea.value = '';
        setTimeout(function () {
          sqlTextarea.focus();
        }, 40);
      }
    }

    // Update Next Button Label on Last Question
    const nextBtnText = document.getElementById('next-submit-btn-text');
    if (nextBtnText) {
      if (idx === total - 1) {
        nextBtnText.textContent = '마지막 답안 제출 및 채점 결과 보기';
      } else {
        nextBtnText.textContent = '다음 문제 (자동 제출)';
      }
    }

    startQuestionTimer(limitSec);
  }

  function selectChoiceOption(optNum) {
    currentSelectedChoice = optNum;
    const buttons = document.querySelectorAll('#choice-options-container .option-btn');
    buttons.forEach(function (btn) {
      const n = Number(btn.getAttribute('data-opt'));
      const circle = btn.querySelector('.opt-circle');
      if (n === optNum) {
        btn.classList.add('selected');
        if (circle) {
          circle.className =
            'opt-circle w-7 h-7 rounded-lg bg-cyan-500 border border-cyan-300 text-slate-950 code-font text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5 transition';
        }
      } else {
        btn.classList.remove('selected');
        if (circle) {
          circle.className =
            'opt-circle w-7 h-7 rounded-lg bg-slate-800 border border-slate-600 text-slate-300 code-font text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5 transition';
        }
      }
    });
  }

  function startQuestionTimer(limitSeconds) {
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }

    function tick() {
      if (!examSession) return;
      const elapsedMs = Date.now() - examSession.questionStartedAt;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const remainingSec = Math.max(0, limitSeconds - elapsedSec);

      updateTimerDisplayUI(remainingSec, limitSeconds);

      if (remainingSec <= 0) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
        submitCurrentQuestionAndAdvance(true);
      }
    }

    tick();
    timerIntervalId = setInterval(tick, 250);
  }

  function updateTimerDisplayUI(remainingSec, totalSec) {
    const dispEl = document.getElementById('timer-display');
    const barEl = document.getElementById('timer-bar');
    const ringEl = document.getElementById('timer-ring');

    const mins = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const secs = String(remainingSec % 60).padStart(2, '0');
    if (dispEl) {
      dispEl.textContent = mins + ':' + secs;
    }

    const pct = totalSec > 0 ? Math.max(0, (remainingSec / totalSec) * 100) : 0;
    if (barEl) {
      barEl.style.width = pct + '%';
    }

    // SVG circle circumference = 2 * PI * 15 = 94.2
    if (ringEl) {
      const offset = 94.2 - (94.2 * pct) / 100;
      ringEl.setAttribute('stroke-dashoffset', String(offset));
    }

    const isWarning = remainingSec <= 15;
    if (dispEl) {
      if (isWarning) {
        dispEl.classList.add('timer-warning');
      } else {
        dispEl.classList.remove('timer-warning');
      }
    }
    if (barEl) {
      barEl.className = isWarning
        ? 'bg-rose-500 h-full transition-all duration-300 ease-linear'
        : 'bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 h-full transition-all duration-300 ease-linear';
    }
    if (ringEl) {
      ringEl.setAttribute('stroke', isWarning ? '#f43f5e' : '#22d3ee');
    }
  }

  function handleNextButtonClick() {
    submitCurrentQuestionAndAdvance(false);
  }

  async function submitCurrentQuestionAndAdvance(isTimedOut) {
    if (!examSession || isSubmittingQuestion) return;
    isSubmittingQuestion = true;

    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }

    const idx = examSession.currentIndex;
    const q = examSession.questions[idx];
    const limitSec = q.timeLimit || (q.type === 'choice' ? 60 : 120);
    const rawElapsed = Math.round((Date.now() - examSession.questionStartedAt) / 1000);
    const elapsedSec = Math.max(1, Math.min(limitSec, rawElapsed));

    let userAnswer = null;
    if (q.type === 'choice') {
      userAnswer = currentSelectedChoice;
    } else {
      const sqlTextarea = document.getElementById('user-sql-answer');
      userAnswer = sqlTextarea ? sqlTextarea.value.trim() : '';
    }

    if (isTimedOut) {
      showToast(
        (idx + 1) + '번 문항 제한 시간(' + limitSec + '초)이 경과하여 자동 제출 후 다음 문제로 이동합니다.'
      );
    }

    const graded = await global.SqlExamGrader.gradeQuestion(q, userAnswer, {
      elapsedSec: elapsedSec,
      timedOut: Boolean(isTimedOut),
    });

    examSession.details.push(graded);

    if (idx + 1 < examSession.questions.length) {
      examSession.currentIndex = idx + 1;
      examSession.questionStartedAt = Date.now();
      global.SqlExamStorage.saveActiveSession(examSession);
      renderCurrentExamQuestion();
    } else {
      await finalizeExamSubmission();
    }
  }

  async function finalizeExamSubmission() {
    if (!examSession) return;
    global.SqlExamStorage.saveActiveSession(null);

    const savedSubmission = await global.SqlExamStorage.saveSubmission({
      studentName: examSession.studentName,
      examCategoryFilter: examSession.categoryFilter,
      examTypeFilter: examSession.typeFilter,
      examModeLabel: examSession.modeLabel,
      startedAt: examSession.startedAt,
      submittedAt: new Date().toISOString(),
      details: examSession.details,
    });

    lastFinishedSubmission = savedSubmission;
    examSession = null;

    renderResultView(savedSubmission);
  }

  function formatTablePreviewHtml(tableObj) {
    if (!tableObj || !Array.isArray(tableObj.columns) || tableObj.columns.length === 0) {
      return '<div class="text-xs text-slate-500 italic">반환된 결과 행이 없습니다.</div>';
    }
    const headers = tableObj.columns
      .map(function (col) {
        return '<th class="px-2.5 py-1.5 text-left font-bold text-cyan-300 border-b border-slate-700">' + escapeHtml(col) + '</th>';
      })
      .join('');
    const rows = (tableObj.values || [])
      .slice(0, 8)
      .map(function (r) {
        const cells = r
          .map(function (c) {
            return '<td class="px-2.5 py-1 border-b border-slate-800/80 text-slate-300">' + escapeHtml(c === null ? 'NULL' : c) + '</td>';
          })
          .join('');
        return '<tr>' + cells + '</tr>';
      })
      .join('');

    return (
      '<div class="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">' +
      '<table class="w-full text-xs code-font">' +
      '<thead class="bg-slate-900/90"><tr>' + headers + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div>'
    );
  }

  function renderResultView(submission) {
    document.getElementById('view-start').classList.add('hidden');
    document.getElementById('view-exam').classList.add('hidden');
    document.getElementById('view-result').classList.remove('hidden');

    const headerStatus = document.getElementById('header-exam-status');
    headerStatus.classList.add('hidden');
    headerStatus.classList.remove('flex');
    document.getElementById('timer-bar-wrap').classList.add('hidden');

    document.getElementById('res-student-name').textContent = submission.studentName;
    document.getElementById('res-mode-label').textContent = submission.examModeLabel || '';
    document.getElementById('res-score-100').textContent = String(submission.score100);
    document.getElementById('res-correct-Summary').textContent =
      submission.correctCount + ' / ' + submission.totalQuestions + '문항 (' + submission.earnedPoints + '/' + submission.maxPoints + '점)';

    const totalSec = submission.totalElapsedSec || 0;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    document.getElementById('res-elapsed-summary').textContent =
      '총 소요 시간: ' + mins + '분 ' + secs + '초 (시간초과 ' + (submission.timeoutCount || 0) + '문항)';

    const passBadge = document.getElementById('res-pass-badge');
    if (submission.passed) {
      passBadge.textContent = 'PASS (합격 · 80점 이상)';
      passBadge.className =
        'px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    } else {
      passBadge.textContent = 'FAIL (미달 · 80점 기준)';
      passBadge.className =
        'px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40';
    }

    // Area Breakdown Cards
    const areaContainer = document.getElementById('res-area-cards');
    areaContainer.innerHTML = '';
    const areas = ['SQL 기초', 'SQL 활용', 'SQL 응용'];
    areas.forEach(function (areaName) {
      const st = (submission.areaStats && submission.areaStats[areaName]) || {
        earned: 0,
        max: 0,
        correct: 0,
        total: 0,
      };
      const pct = st.max > 0 ? Math.round((st.earned / st.max) * 100) : 0;
      const card = document.createElement('div');
      card.className = 'bg-slate-950/80 border border-slate-800 rounded-xl p-4';
      card.innerHTML =
        '<div class="flex justify-between items-center mb-2">' +
        '<span class="text-xs font-bold text-slate-300">' + escapeHtml(areaName) + '</span>' +
        '<span class="code-font text-xs font-extrabold text-cyan-400">' +
        (st.total > 0 ? pct + '% (' + st.correct + '/' + st.total + '문항)' : '미응시') +
        '</span>' +
        '</div>' +
        '<div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden">' +
        '<div class="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full rounded-full" style="width:' + pct + '%"></div>' +
        '</div>';
      areaContainer.appendChild(card);
    });

    currentReviewFilter = 'all';
    renderResultReviewList();
  }

  function filterResultReview(mode) {
    currentReviewFilter = mode;
    const btns = document.querySelectorAll('.res-filter-btn');
    btns.forEach(function (b) {
      const isAct = b.getAttribute('data-rfilter') === mode;
      b.className = isAct
        ? 'res-filter-btn bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition'
        : 'res-filter-btn bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition';
    });
    renderResultReviewList();
  }

  function renderResultReviewList() {
    const listEl = document.getElementById('res-review-list');
    if (!listEl || !lastFinishedSubmission) return;
    listEl.innerHTML = '';

    const allQuestionsMap = new Map();
    global.SqlExamStorage.getQuestions().forEach(function (q) {
      allQuestionsMap.set(q.id, q);
    });

    const details = (lastFinishedSubmission.details || []).filter(function (d) {
      if (currentReviewFilter === 'wrong') {
        return !d.isCorrect;
      }
      return true;
    });

    if (details.length === 0) {
      listEl.innerHTML =
        '<div class="text-center py-10 text-sm text-emerald-400 font-bold">축하합니다! 틀린 문항이 없습니다.</div>';
      return;
    }

    details.forEach(function (d, idx) {
      const q = allQuestionsMap.get(d.questionId) || {};
      const item = document.createElement('div');
      const borderCls = d.isCorrect
        ? 'border-emerald-500/30'
        : d.score > 0
        ? 'border-amber-500/40'
        : 'border-rose-500/40';
      item.className = 'bg-slate-950/85 border ' + borderCls + ' rounded-xl p-5 space-y-3';

      const statusBadge = d.isCorrect
        ? '<span class="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold">정답 (+' + d.score + '점)</span>'
        : d.score > 0
        ? '<span class="px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs font-bold">부분점수 (+' + d.score + '/' + d.maxPoints + '점)</span>'
        : '<span class="px-2.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-xs font-bold">오답 (0점)</span>';

      const timeoutTag = d.timedOut
        ? '<span class="px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 text-[11px] font-semibold">시간초과 자동제출</span>'
        : '<span class="text-xs text-slate-400 code-font">' + d.elapsedSec + '초 소요</span>';

      let answerCompareHtml = '';
      if (d.type === 'choice') {
        const opts = q.options || [];
        const userOptText = d.userAnswer ? d.userAnswer + '번 — ' + (opts[d.userAnswer - 1] || '') : '미선택 (무응답)';
        const corrOptText = d.correctAnswer + '번 — ' + (opts[d.correctAnswer - 1] || '');
        answerCompareHtml =
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">' +
          '<div class="bg-slate-900 p-3 rounded-lg border border-slate-800">' +
          '<div class="text-slate-400 mb-1">내가 선택한 답안:</div>' +
          '<div class="font-bold ' + (d.isCorrect ? 'text-emerald-400' : 'text-rose-400') + '">' + escapeHtml(userOptText) + '</div>' +
          '</div>' +
          '<div class="bg-slate-900 p-3 rounded-lg border border-slate-800">' +
          '<div class="text-slate-400 mb-1">정답 보기:</div>' +
          '<div class="font-bold text-emerald-400">' + escapeHtml(corrOptText) + '</div>' +
          '</div>' +
          '</div>';
      } else {
        const sqlExecutionPreview =
          d.expectedResultPreview && d.expectedResultPreview.columns && d.expectedResultPreview.columns.length > 0
            ? '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">' +
              '<div><div class="text-[11px] text-slate-400 mb-1">내 SQL 실행 결과표:</div>' +
              formatTablePreviewHtml(d.userResultPreview) +
              '</div>' +
              '<div><div class="text-[11px] text-slate-400 mb-1">정답 SQL 실행 결과표:</div>' +
              formatTablePreviewHtml(d.expectedResultPreview) +
              '</div></div>'
            : '';

        answerCompareHtml =
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">' +
          '<div class="bg-slate-900 p-3 rounded-lg border border-slate-800">' +
          '<div class="text-slate-400 mb-1 flex justify-between"><span>내 제출 답안:</span><span class="text-cyan-400">' + escapeHtml(d.methodUsed || '') + '</span></div>' +
          '<pre class="code-font whitespace-pre-wrap text-slate-200">' + escapeHtml(d.userAnswer || '(미작성)') + '</pre>' +
          (d.sqlError ? '<div class="mt-1.5 text-[11px] text-rose-400">SQL 오류: ' + escapeHtml(d.sqlError) + '</div>' : '') +
          '</div>' +
          '<div class="bg-slate-900 p-3 rounded-lg border border-slate-800">' +
          '<div class="text-slate-400 mb-1">모범 정답 (Standard SQL / Answer):</div>' +
          '<pre class="code-font whitespace-pre-wrap text-emerald-400">' + escapeHtml(d.correctAnswer || '') + '</pre>' +
          '</div>' +
          '</div>' +
          sqlExecutionPreview;
      }

      item.innerHTML =
        '<div class="flex flex-wrap justify-between items-center gap-2">' +
        '<div class="flex items-center gap-2">' +
        '<span class="code-font text-xs font-bold text-slate-400">#' + (idx + 1) + ' (' + escapeHtml(d.questionId) + ')</span>' +
        '<span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-semibold">' + escapeHtml(d.category) + '</span>' +
        statusBadge +
        '</div>' +
        '<div>' + timeoutTag + '</div>' +
        '</div>' +
        '<div class="text-sm sm:text-base font-bold text-white leading-relaxed">' + escapeHtml(q.title || '') + '</div>' +
        answerCompareHtml +
        '<div class="bg-indigo-950/30 border border-indigo-500/25 rounded-lg p-3 text-xs text-slate-300 leading-relaxed">' +
        '<span class="font-bold text-amber-400 mr-1.5"><i class="fa-solid fa-lightbulb"></i> 핵심 해설:</span>' +
        escapeHtml(q.explanation || '') +
        '</div>';

      listEl.appendChild(item);
    });
  }

  function returnToStartScreen() {
    document.getElementById('view-result').classList.add('hidden');
    document.getElementById('view-exam').classList.add('hidden');
    document.getElementById('view-start').classList.remove('hidden');
    updateStartFilterSummaryUI();
  }

  // Restore active session if page was reloaded mid-exam
  document.addEventListener('DOMContentLoaded', function () {
    updateStartFilterSummaryUI();

    const savedSession = global.SqlExamStorage.getActiveSession();
    if (
      savedSession &&
      Array.isArray(savedSession.questions) &&
      savedSession.currentIndex < savedSession.questions.length
    ) {
      examSession = savedSession;
      global.SqlExamGrader.initSqlEngine();
      enterExamView();
      showToast('진행 중이던 시험 세션과 남은 타이머를 이어서 복구했습니다.');
    }
  });

  // Expose handlers to global scope for inline button events
  global.selectStartFilter = selectStartFilter;
  global.quickSelectPreset = quickSelectPreset;
  global.startExamSession = startExamSession;
  global.handleNextButtonClick = handleNextButtonClick;
  global.filterResultReview = filterResultReview;
  global.returnToStartScreen = returnToStartScreen;
})(window);

