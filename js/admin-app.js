/**
 * SQL Exam Administrator Console Logic
 * - Implements all 6 requested statistical indicators:
 *   1) 응시자별 점수 · 순위 (Leaderboard & Table)
 *   2) 문항별 정답률 (Hardest questions & full 90-question analytics)
 *   3) 영역별 점수 (SQL 기초 / SQL 활용 / SQL 응용 Chart & breakdown)
 *   4) 점수 분포 그래프 (Score Histogram via Chart.js)
 *   5) 평균 · 최고 · 최저 · 합격률(80점 이상) KPI summary
 *   6) 엑셀(CSV) 다운로드 (UTF-8 BOM included)
 * - Plus Subjective SQL Execution Review & Manual Score Override
 */
(function (global) {
  'use strict';

  const ALLOWED_PASSCODES = ['tuesvonita', 'TUESVONITA'];
  const SESSION_AUTH_KEY = 'dmdg_sql_exam_admin_authed';

  let allSubmissions = [];
  let histogramChartInstance = null;
  let areaChartInstance = null;
  let activeTab = 'dashboard';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + min;
  }

  function unlockAdminConsole() {
    sessionStorage.setItem(SESSION_AUTH_KEY, '1');
    const overlay = document.getElementById('admin-auth-overlay');
    if (overlay) overlay.classList.add('hidden');
    loadAdminDataAndRender();
  }

  function handleAdminPasscodeLogin() {
    const input = document.getElementById('admin-passcode-input');
    const errEl = document.getElementById('admin-auth-error');
    const val = input ? input.value.trim() : '';
    const upperVal = val.toUpperCase();
    if (ALLOWED_PASSCODES.includes(upperVal) || ALLOWED_PASSCODES.includes(val)) {
      if (errEl) errEl.classList.add('hidden');
      unlockAdminConsole();
    } else {
      if (errEl) {
        errEl.textContent = '관리자 접속 암호가 올바르지 않습니다.';
        errEl.classList.remove('hidden');
      }
    }
  }

  async function handleGoogleAdminLogin() {
    const errEl = document.getElementById('admin-auth-error');
    try {
      if (typeof global.firebase === 'undefined' || !global.firebase.auth) {
        throw new Error('Firebase Auth SDK를 초기화할 수 없습니다.');
      }
      const provider = new global.firebase.auth.GoogleAuthProvider();
      await global.firebase.auth().signInWithPopup(provider);
      unlockAdminConsole();
    } catch (err) {
      if (errEl) {
        errEl.textContent = 'Google 인증에 실패했습니다. 관리자 접속 암호를 입력해 주세요.';
        errEl.classList.remove('hidden');
      }
    }
  }

  function switchAdminTab(tabName) {
    activeTab = tabName;
    const tabs = ['dashboard', 'candidates', 'subjective', 'questions', 'settings'];
    tabs.forEach(function (t) {
      const sec = document.getElementById('tab-' + t);
      if (sec) {
        if (t === tabName) {
          sec.classList.remove('hidden');
        } else {
          sec.classList.add('hidden');
        }
      }
    });

    const btns = document.querySelectorAll('.admin-tab-btn');
    btns.forEach(function (b) {
      if (b.getAttribute('data-tab') === tabName) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    if (tabName === 'dashboard') {
      renderDashboardTab();
    } else if (tabName === 'candidates') {
      renderCandidatesTable();
    } else if (tabName === 'subjective') {
      renderSubjectiveReviewList();
    } else if (tabName === 'questions') {
      renderQuestionStatsTable();
    } else if (tabName === 'settings') {
      populateSettingsForm();
      runAdminSqlSandbox();
    }
  }

  async function loadAdminDataAndRender() {
    // One-time auto cleanup of initial auto-seeded DEMO-SUB-* records so real statistics start clean
    if (!localStorage.getItem('dmdg_sql_exam_demo_cleaned_v2')) {
      localStorage.setItem('dmdg_sql_exam_demo_cleaned_v2', '1');
      const existing = await global.SqlExamStorage.fetchAllSubmissions();
      const hasOnlyDemo = existing.length > 0 && existing.every(function (s) {
        return String(s.id || '').startsWith('DEMO-SUB-');
      });
      if (hasOnlyDemo) {
        await global.SqlExamStorage.clearAllSubmissions();
      }
    }

    allSubmissions = await global.SqlExamStorage.fetchAllSubmissions();
    updatePendingReviewBadge();
    switchAdminTab(activeTab);
  }

  function updatePendingReviewBadge() {
    let pending = 0;
    allSubmissions.forEach(function (s) {
      (s.details || []).forEach(function (d) {
        if (d.type === 'sql' && d.needsReview && !d.adminReviewed) {
          pending += 1;
        }
      });
    });
    const badge = document.getElementById('badge-pending-review');
    if (badge) {
      badge.textContent = String(pending);
    }
  }

  function computeRankedSubmissions() {
    const sorted = allSubmissions.slice().sort(function (a, b) {
      if (b.score100 !== a.score100) return b.score100 - a.score100;
      return (a.totalElapsedSec || 0) - (b.totalElapsedSec || 0);
    });
    sorted.forEach(function (s, i) {
      s.rank = i + 1;
    });
    return sorted;
  }

  function computePerQuestionStats() {
    const questions = global.SqlExamStorage.getQuestions();
    const statMap = new Map();

    questions.forEach(function (q) {
      statMap.set(q.id, {
        question: q,
        attempts: 0,
        correct: 0,
        partial: 0,
        totalElapsedSec: 0,
        timeouts: 0,
        optionCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
      });
    });

    allSubmissions.forEach(function (sub) {
      (sub.details || []).forEach(function (d) {
        const entry = statMap.get(d.questionId);
        if (!entry) return;
        entry.attempts += 1;
        if (d.isCorrect) entry.correct += 1;
        else if (d.score > 0) entry.partial += 1;
        entry.totalElapsedSec += Number(d.elapsedSec) || 0;
        if (d.timedOut) entry.timeouts += 1;
        if (d.type === 'choice' && d.userAnswer >= 1 && d.userAnswer <= 4) {
          entry.optionCounts[d.userAnswer] = (entry.optionCounts[d.userAnswer] || 0) + 1;
        }
      });
    });

    return Array.from(statMap.values()).map(function (st) {
      const accuracy = st.attempts > 0 ? Math.round((st.correct / st.attempts) * 1000) / 10 : 0;
      const avgSec = st.attempts > 0 ? Math.round(st.totalElapsedSec / st.attempts) : 0;
      const timeoutRate = st.attempts > 0 ? Math.round((st.timeouts / st.attempts) * 100) : 0;
      return Object.assign({}, st, {
        accuracy: accuracy,
        avgSec: avgSec,
        timeoutRate: timeoutRate,
      });
    });
  }

  // =====================================================================
  // TAB 1: DASHBOARD RENDERING
  // =====================================================================
  function renderDashboardTab() {
    const ranked = computeRankedSubmissions();
    const total = ranked.length;

    const uniqueNames = new Set(
      ranked.map(function (s) {
        return String(s.studentName || '').trim();
      })
    ).size;

    let sumScore = 0;
    let passCount = 0;
    let choiceEarnedSum = 0;
    let choiceMaxSum = 0;
    let sqlEarnedSum = 0;
    let sqlMaxSum = 0;

    ranked.forEach(function (s) {
      sumScore += Number(s.score100) || 0;
      if (s.passed) passCount += 1;
      choiceEarnedSum += Number(s.choiceEarned) || 0;
      choiceMaxSum += Number(s.choiceMax) || 0;
      sqlEarnedSum += Number(s.sqlEarned) || 0;
      sqlMaxSum += Number(s.sqlMax) || 0;
    });

    const avgScore = total > 0 ? (sumScore / total).toFixed(1) : '0.0';
    const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0';
    const maxSub = total > 0 ? ranked[0] : null;
    const minSub = total > 0 ? ranked[total - 1] : null;

    const choiceRate = choiceMaxSum > 0 ? Math.round((choiceEarnedSum / choiceMaxSum) * 100) : 0;
    const sqlRate = sqlMaxSum > 0 ? Math.round((sqlEarnedSum / sqlMaxSum) * 100) : 0;

    document.getElementById('kpi-total-count').textContent = total + '명';
    document.getElementById('kpi-unique-names').textContent = '고유 이름 ' + uniqueNames + '명';
    document.getElementById('kpi-avg-score').textContent = avgScore + '점';
    document.getElementById('kpi-pass-rate').textContent = passRate + '%';
    document.getElementById('kpi-pass-count').textContent =
      '합격 ' + passCount + '명 / 미달 ' + (total - passCount) + '명';
    document.getElementById('kpi-max-score').textContent = maxSub ? maxSub.score100 + '점' : '0.0점';
    document.getElementById('kpi-max-student').textContent = maxSub ? maxSub.studentName : '-';
    document.getElementById('kpi-min-score').textContent = minSub ? minSub.score100 + '점' : '0.0점';
    document.getElementById('kpi-min-student').textContent = minSub ? minSub.studentName : '-';
    document.getElementById('kpi-type-compare').textContent = choiceRate + '% / ' + sqlRate + '%';

    renderScoreHistogramChart(ranked);
    renderAreaScoresChart(ranked);
    renderDashboardTopCandidates(ranked.slice(0, 7));
    renderDashboardHardestQuestions();
  }

  function renderScoreHistogramChart(submissions) {
    const canvas = document.getElementById('chart-score-histogram');
    if (!canvas || typeof global.Chart === 'undefined') return;

    const buckets = [0, 0, 0, 0, 0, 0];
    submissions.forEach(function (s) {
      const sc = Number(s.score100) || 0;
      if (sc < 50) buckets[0] += 1;
      else if (sc < 60) buckets[1] += 1;
      else if (sc < 70) buckets[2] += 1;
      else if (sc < 80) buckets[3] += 1;
      else if (sc < 90) buckets[4] += 1;
      else buckets[5] += 1;
    });

    if (histogramChartInstance) {
      histogramChartInstance.destroy();
    }

    histogramChartInstance = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['50점 미만', '50~59점', '60~69점', '70~79점', '80~89점 (합격)', '90~100점 (최우수)'],
        datasets: [
          {
            label: '응시자 수 (명)',
            data: buckets,
            backgroundColor: [
              'rgba(244, 63, 94, 0.55)',
              'rgba(244, 63, 94, 0.7)',
              'rgba(245, 158, 11, 0.65)',
              'rgba(245, 158, 11, 0.85)',
              'rgba(16, 185, 129, 0.75)',
              'rgba(6, 182, 212, 0.85)',
            ],
            borderColor: ['#f43f5e', '#f43f5e', '#f59e0b', '#f59e0b', '#10b981', '#06b6d4'],
            borderWidth: 1.5,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: '#94a3b8' },
            grid: { color: 'rgba(51, 65, 85, 0.4)' },
          },
          x: {
            ticks: { color: '#cbd5e1', font: { size: 11 } },
            grid: { display: false },
          },
        },
      },
    });
  }

  function renderAreaScoresChart(submissions) {
    const canvas = document.getElementById('chart-area-scores');
    if (!canvas || typeof global.Chart === 'undefined') return;

    const areas = ['SQL 기초', 'SQL 활용', 'SQL 응용'];
    const sums = {
      'SQL 기초': { choiceEarned: 0, choiceMax: 0, sqlEarned: 0, sqlMax: 0 },
      'SQL 활용': { choiceEarned: 0, choiceMax: 0, sqlEarned: 0, sqlMax: 0 },
      'SQL 응용': { choiceEarned: 0, choiceMax: 0, sqlEarned: 0, sqlMax: 0 },
    };

    submissions.forEach(function (sub) {
      (sub.details || []).forEach(function (d) {
        const cat = sums[d.category] ? d.category : 'SQL 기초';
        if (d.type === 'choice') {
          sums[cat].choiceEarned += Number(d.score) || 0;
          sums[cat].choiceMax += Number(d.maxPoints) || 2;
        } else {
          sums[cat].sqlEarned += Number(d.score) || 0;
          sums[cat].sqlMax += Number(d.maxPoints) || 2;
        }
      });
    });

    const choiceData = areas.map(function (a) {
      return sums[a].choiceMax > 0 ? Math.round((sums[a].choiceEarned / sums[a].choiceMax) * 1000) / 10 : 0;
    });
    const sqlData = areas.map(function (a) {
      return sums[a].sqlMax > 0 ? Math.round((sums[a].sqlEarned / sums[a].sqlMax) * 1000) / 10 : 0;
    });

    if (areaChartInstance) {
      areaChartInstance.destroy();
    }

    areaChartInstance = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['SQL 기초 (Ch05)', 'SQL 활용 (Ch06)', 'SQL 응용 (Ch07)'],
        datasets: [
          {
            label: '객관식 득점률 (%)',
            data: choiceData,
            backgroundColor: 'rgba(99, 102, 241, 0.8)',
            borderColor: '#6366f1',
            borderWidth: 1,
            borderRadius: 6,
          },
          {
            label: '주관식 득점률 (%)',
            data: sqlData,
            backgroundColor: 'rgba(6, 182, 212, 0.8)',
            borderColor: '#06b6d4',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#cbd5e1', font: { size: 11 } },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { color: '#94a3b8', callback: function (v) { return v + '%'; } },
            grid: { color: 'rgba(51, 65, 85, 0.4)' },
          },
          x: {
            ticks: { color: '#cbd5e1' },
            grid: { display: false },
          },
        },
      },
    });
  }

  function renderDashboardTopCandidates(topList) {
    const el = document.getElementById('dash-top-candidates');
    if (!el) return;
    if (topList.length === 0) {
      el.innerHTML = '<div class="text-xs text-slate-500 py-6 text-center">아직 제출된 응시 데이터가 없습니다.</div>';
      return;
    }

    el.innerHTML = topList
      .map(function (s) {
        const medal =
          s.rank === 1
            ? '🥇 1위'
            : s.rank === 2
            ? '🥈 2위'
            : s.rank === 3
            ? '🥉 3위'
            : s.rank + '위';
        const passCls = s.passed ? 'text-emerald-400' : 'text-rose-400';
        return (
          '<div class="bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs">' +
          '<div class="flex items-center gap-3">' +
          '<span class="code-font font-extrabold text-amber-300 w-12">' + medal + '</span>' +
          '<span class="font-bold text-white">' + escapeHtml(s.studentName) + '</span>' +
          '<span class="text-slate-400 hidden sm:inline">' + escapeHtml(s.examModeLabel || '') + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-3">' +
          '<span class="code-font font-extrabold text-sm ' + passCls + '">' + s.score100 + '점</span>' +
          '<button type="button" onclick="openCandidateModal(\'' + escapeHtml(s.id) + '\')" class="text-slate-400 hover:text-cyan-300"><i class="fa-solid fa-eye"></i></button>' +
          '</div></div>'
        );
      })
      .join('');
  }

  function renderDashboardHardestQuestions() {
    const el = document.getElementById('dash-hardest-questions');
    if (!el) return;
    const stats = computePerQuestionStats()
      .filter(function (st) {
        return st.attempts > 0;
      })
      .sort(function (a, b) {
        return a.accuracy - b.accuracy;
      })
      .slice(0, 7);

    if (stats.length === 0) {
      el.innerHTML = '<div class="text-xs text-slate-500 py-6 text-center">응시 데이터가 쌓이면 오답률 상위 문항이 표시됩니다.</div>';
      return;
    }

    el.innerHTML = stats
      .map(function (st) {
        const q = st.question;
        return (
          '<div class="bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">' +
          '<div class="truncate">' +
          '<span class="code-font font-bold text-cyan-400 mr-2">[' + escapeHtml(q.id) + ']</span>' +
          '<span class="text-slate-200">' + escapeHtml(q.title) + '</span>' +
          '</div>' +
          '<div class="shrink-0 flex items-center gap-2">' +
          '<span class="text-[11px] text-slate-400">정답률</span>' +
          '<span class="code-font font-extrabold text-rose-400">' + st.accuracy + '%</span>' +
          '</div></div>'
        );
      })
      .join('');
  }

  // =====================================================================
  // TAB 2: CANDIDATES TABLE RENDERING
  // =====================================================================
  function renderCandidatesTable() {
    const tbody = document.getElementById('candidates-table-body');
    if (!tbody) return;

    const searchQ = (document.getElementById('cand-search-input')?.value || '').trim().toLowerCase();
    const passFilter = document.getElementById('cand-pass-filter')?.value || 'ALL';
    const sortMode = document.getElementById('cand-sort-select')?.value || 'rank';

    let list = computeRankedSubmissions().filter(function (s) {
      const nameMatch = !searchQ || String(s.studentName || '').toLowerCase().includes(searchQ);
      const passMatch =
        passFilter === 'ALL' ||
        (passFilter === 'PASS' && s.passed) ||
        (passFilter === 'FAIL' && !s.passed);
      return nameMatch && passMatch;
    });

    if (sortMode === 'latest') {
      list.sort(function (a, b) {
        return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
      });
    } else if (sortMode === 'name') {
      list.sort(function (a, b) {
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ko');
      });
    }

    if (list.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="py-8 text-center text-slate-500">조건에 해당하는 응시 기록이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = list
      .map(function (s) {
        const bBasic = s.areaStats && s.areaStats['SQL 기초'] ? s.areaStats['SQL 기초'] : { earned: 0, max: 0 };
        const bUtil = s.areaStats && s.areaStats['SQL 활용'] ? s.areaStats['SQL 활용'] : { earned: 0, max: 0 };
        const bApp = s.areaStats && s.areaStats['SQL 응용'] ? s.areaStats['SQL 응용'] : { earned: 0, max: 0 };

        const pctBasic = bBasic.max > 0 ? Math.round((bBasic.earned / bBasic.max) * 100) + '%' : '-';
        const pctUtil = bUtil.max > 0 ? Math.round((bUtil.earned / bUtil.max) * 100) + '%' : '-';
        const pctApp = bApp.max > 0 ? Math.round((bApp.earned / bApp.max) * 100) + '%' : '-';

        const passBadge = s.passed
          ? '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">PASS</span>'
          : '<span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">FAIL</span>';

        const dupBadge = s.isDuplicateName
          ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">중복이름</span>'
          : '';

        const mins = Math.floor((s.totalElapsedSec || 0) / 60);
        const secs = (s.totalElapsedSec || 0) % 60;

        return (
          '<tr class="hover:bg-slate-900/60 transition">' +
          '<td class="py-3 px-3 code-font font-extrabold text-amber-300">' + s.rank + '위</td>' +
          '<td class="py-3 px-3 font-bold text-white">' + escapeHtml(s.studentName) + dupBadge + '</td>' +
          '<td class="py-3 px-3 text-slate-300">' + escapeHtml(s.examModeLabel || '') + '</td>' +
          '<td class="py-3 px-3 code-font font-black text-sm text-cyan-300">' +
          s.score100 + '점 <span class="text-[11px] text-slate-500 font-normal">(' + s.earnedPoints + '/' + s.maxPoints + ')</span></td>' +
          '<td class="py-3 px-3">' + passBadge + '</td>' +
          '<td class="py-3 px-3 code-font text-slate-300">' + pctBasic + ' / ' + pctUtil + ' / ' + pctApp + '</td>' +
          '<td class="py-3 px-3 code-font text-slate-400">' + mins + '분 ' + secs + '초 (초과 ' + (s.timeoutCount || 0) + ')</td>' +
          '<td class="py-3 px-3 text-slate-400 code-font">' + formatDateTime(s.submittedAt) + '</td>' +
          '<td class="py-3 px-3 text-right space-x-1.5">' +
          '<button type="button" onclick="openCandidateModal(\'' + escapeHtml(s.id) + '\')" class="bg-slate-800 hover:bg-cyan-600 hover:text-slate-950 text-cyan-300 px-2.5 py-1 rounded-md font-bold transition">답안지</button>' +
          '<button type="button" onclick="handleDeleteSubmission(\'' + escapeHtml(s.id) + '\')" class="bg-slate-800 hover:bg-rose-600 text-slate-400 hover:text-white px-2 py-1 rounded-md transition" title="삭제"><i class="fa-solid fa-trash"></i></button>' +
          '</td></tr>'
        );
      })
      .join('');
  }

  // =====================================================================
  // TAB 3: SUBJECTIVE SQL REVIEW & MANUAL SCORE OVERRIDE
  // =====================================================================
  function renderSubjectiveReviewList() {
    const container = document.getElementById('subjective-review-list');
    if (!container) return;

    const filterMode = document.getElementById('subj-review-filter')?.value || 'all';
    const qMap = new Map();
    global.SqlExamStorage.getQuestions().forEach(function (q) {
      qMap.set(q.id, q);
    });

    const items = [];
    allSubmissions.forEach(function (sub) {
      (sub.details || []).forEach(function (d) {
        if (d.type !== 'sql') return;
        if (filterMode === 'needsReview' && (d.isCorrect || d.adminReviewed)) return;
        if (filterMode === 'wrong' && d.score > 0) return;
        items.push({ sub: sub, detail: d, question: qMap.get(d.questionId) || {} });
      });
    });

    if (items.length === 0) {
      container.innerHTML =
        '<div class="text-center py-10 text-sm text-slate-400">해당 조건의 주관식 답안이 없습니다.</div>';
      return;
    }

    // Show up to 60 items for fast DOM rendering
    container.innerHTML = items
      .slice(0, 60)
      .map(function (it) {
        const s = it.sub;
        const d = it.detail;
        const q = it.question;
        const maxPts = d.maxPoints || 2;

        const scoreBadge =
          d.score >= maxPts
            ? '<span class="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold">만점 (' + d.score + '/' + maxPts + '점)</span>'
            : d.score > 0
            ? '<span class="px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs font-bold">부분점수 (' + d.score + '/' + maxPts + '점)</span>'
            : '<span class="px-2.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-xs font-bold">오답 (0/' + maxPts + '점)</span>';

        return (
          '<div class="bg-slate-950/85 border border-slate-800 rounded-xl p-5 space-y-3">' +
          '<div class="flex flex-wrap justify-between items-center gap-2">' +
          '<div class="flex items-center gap-2">' +
          '<span class="font-extrabold text-white text-sm"><i class="fa-solid fa-user text-cyan-400 mr-1"></i>' + escapeHtml(s.studentName) + '</span>' +
          '<span class="code-font text-xs text-indigo-300 font-bold">[' + escapeHtml(d.questionId) + ']</span>' +
          '<span class="text-xs text-slate-400">' + escapeHtml(d.category) + '</span>' +
          scoreBadge +
          '<span class="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300">' + escapeHtml(d.methodUsed || '') + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-1.5">' +
          '<span class="text-xs text-slate-400 mr-1">점수 부여:</span>' +
          '<button type="button" onclick="handleAdminScoreOverride(\'' + escapeHtml(s.id) + '\', \'' + escapeHtml(d.questionId) + '\', 2)" class="px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white text-xs font-bold border border-emerald-500/40 transition">만점(2점)</button>' +
          '<button type="button" onclick="handleAdminScoreOverride(\'' + escapeHtml(s.id) + '\', \'' + escapeHtml(d.questionId) + '\', 1)" class="px-2.5 py-1 rounded bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white text-xs font-bold border border-amber-500/40 transition">부분(1점)</button>' +
          '<button type="button" onclick="handleAdminScoreOverride(\'' + escapeHtml(s.id) + '\', \'' + escapeHtml(d.questionId) + '\', 0)" class="px-2.5 py-1 rounded bg-rose-600/30 hover:bg-rose-600 text-rose-200 hover:text-white text-xs font-bold border border-rose-500/40 transition">오답(0점)</button>' +
          '</div></div>' +
          '<div class="text-xs sm:text-sm font-bold text-slate-200">' + escapeHtml(q.title || '') + '</div>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">' +
          '<div class="bg-slate-900 p-3 rounded-lg border border-slate-800">' +
          '<div class="text-slate-400 mb-1">응시자 제출 SQL / 답안:</div>' +
          '<pre class="code-font whitespace-pre-wrap text-amber-200">' + escapeHtml(d.userAnswer || '(미작성)') + '</pre>' +
          '</div>' +
          '<div class="bg-slate-900 p-3 rounded-lg border border-slate-800">' +
          '<div class="text-slate-400 mb-1">모범 정답 SQL / 기준:</div>' +
          '<pre class="code-font whitespace-pre-wrap text-emerald-400">' + escapeHtml(d.correctAnswer || '') + '</pre>' +
          '</div></div></div>'
        );
      })
      .join('');
  }

  async function handleAdminScoreOverride(submissionId, questionId, newScore) {
    await global.SqlExamStorage.updateSubjectiveScore(submissionId, questionId, newScore);
    allSubmissions = await global.SqlExamStorage.fetchAllSubmissions();
    updatePendingReviewBadge();
    renderSubjectiveReviewList();
  }

  // =====================================================================
  // TAB 4: PER-QUESTION ANALYTICS TABLE (90 QUESTIONS)
  // =====================================================================
  function renderQuestionStatsTable() {
    const tbody = document.getElementById('question-stats-table-body');
    if (!tbody) return;

    const catFilter = document.getElementById('qstat-cat-filter')?.value || 'ALL';
    const typeFilter = document.getElementById('qstat-type-filter')?.value || 'ALL';
    const sortFilter = document.getElementById('qstat-sort-filter')?.value || 'no';

    let stats = computePerQuestionStats().filter(function (st) {
      const q = st.question;
      const catOk = catFilter === 'ALL' || q.category === catFilter;
      const typeOk = typeFilter === 'ALL' || q.type === typeFilter;
      return catOk && typeOk;
    });

    if (sortFilter === 'hardest') {
      stats.sort(function (a, b) {
        return a.accuracy - b.accuracy;
      });
    } else if (sortFilter === 'easiest') {
      stats.sort(function (a, b) {
        return b.accuracy - a.accuracy;
      });
    } else if (sortFilter === 'slowest') {
      stats.sort(function (a, b) {
        return b.avgSec - a.avgSec;
      });
    }

    tbody.innerHTML = stats
      .map(function (st) {
        const q = st.question;
        const typeTag =
          q.type === 'choice'
            ? '<span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">객관식</span>'
            : '<span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">주관식</span>';

        const accColor =
          st.accuracy >= 80
            ? 'text-emerald-400'
            : st.accuracy >= 60
            ? 'text-amber-300'
            : 'text-rose-400';

        return (
          '<tr class="hover:bg-slate-900/60 transition">' +
          '<td class="py-3 px-3 code-font font-bold text-cyan-400">' + escapeHtml(q.id) + '</td>' +
          '<td class="py-3 px-3">' + escapeHtml(q.category) + ' · ' + typeTag + '</td>' +
          '<td class="py-3 px-3 text-slate-200 max-w-md truncate" title="' + escapeHtml(q.title) + '">' + escapeHtml(q.title) + '</td>' +
          '<td class="py-3 px-3 code-font text-slate-300">' + st.attempts + '회</td>' +
          '<td class="py-3 px-3">' +
          '<div class="flex items-center gap-2">' +
          '<span class="code-font font-extrabold ' + accColor + ' w-12">' + st.accuracy + '%</span>' +
          '<div class="w-20 bg-slate-800 h-2 rounded-full overflow-hidden hidden sm:block">' +
          '<div class="bg-cyan-400 h-full" style="width:' + st.accuracy + '%"></div>' +
          '</div></div></td>' +
          '<td class="py-3 px-3 code-font text-slate-300">' + st.avgSec + '초</td>' +
          '<td class="py-3 px-3 code-font text-slate-400">' + st.timeoutRate + '% (' + st.timeouts + '건)</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  // =====================================================================
  // TAB 5: SETTINGS, CSV EXPORT, QUESTION BANK & SQL SANDBOX
  // =====================================================================
  function populateSettingsForm() {
    const s = global.SqlExamStorage.getSettings();
    document.getElementById('set-choice-time').value = s.choiceTimeLimit || 60;
    document.getElementById('set-sql-time').value = s.sqlTimeLimit || 120;
    document.getElementById('set-pass-score').value = s.passScore || 80;
    document.getElementById('set-shuffle').checked = s.shuffleQuestions !== false;
    document.getElementById('set-block-dup').checked = Boolean(s.blockDuplicateDevice);
    document.getElementById('set-exam-open').checked = s.examOpen !== false;
  }

  async function saveAdminSettingsForm() {
    const choiceTime = Math.max(15, Number(document.getElementById('set-choice-time').value) || 60);
    const sqlTime = Math.max(30, Number(document.getElementById('set-sql-time').value) || 120);
    const passScore = Math.max(10, Math.min(100, Number(document.getElementById('set-pass-score').value) || 80));
    const shuffleQuestions = document.getElementById('set-shuffle').checked;
    const blockDuplicateDevice = document.getElementById('set-block-dup').checked;
    const examOpen = document.getElementById('set-exam-open').checked;

    await global.SqlExamStorage.saveSettings({
      choiceTimeLimit: choiceTime,
      sqlTimeLimit: sqlTime,
      passScore: passScore,
      shuffleQuestions: shuffleQuestions,
      blockDuplicateDevice: blockDuplicateDevice,
      examOpen: examOpen,
    });

    alert('시험 설정이 저장되어 즉시 반영되었습니다!');
  }

  function exportSubmissionsCsv() {
    const ranked = computeRankedSubmissions();
    if (ranked.length === 0) {
      alert('다운로드할 응시 기록이 없습니다.');
      return;
    }

    const headers = [
      '순위',
      '응시자이름',
      '응시구성',
      '환산총점(100점만점)',
      '합격여부(80점기준)',
      '획득점수',
      '만점',
      '정답문항수',
      '총문항수',
      'SQL기초_득점',
      'SQL활용_득점',
      'SQL응용_득점',
      '총소요시간(초)',
      '시간초과문항수',
      '제출일시',
    ];

    const rows = ranked.map(function (s) {
      const b1 = s.areaStats && s.areaStats['SQL 기초'] ? s.areaStats['SQL 기초'].earned + '/' + s.areaStats['SQL 기초'].max : '0/0';
      const b2 = s.areaStats && s.areaStats['SQL 활용'] ? s.areaStats['SQL 활용'].earned + '/' + s.areaStats['SQL 활용'].max : '0/0';
      const b3 = s.areaStats && s.areaStats['SQL 응용'] ? s.areaStats['SQL 응용'].earned + '/' + s.areaStats['SQL 응용'].max : '0/0';

      return [
        s.rank,
        '"' + String(s.studentName || '').replace(/"/g, '""') + '"',
        '"' + String(s.examModeLabel || '').replace(/"/g, '""') + '"',
        s.score100,
        s.passed ? 'PASS(합격)' : 'FAIL(미달)',
        s.earnedPoints,
        s.maxPoints,
        s.correctCount,
        s.totalQuestions,
        '"' + b1 + '"',
        '"' + b2 + '"',
        '"' + b3 + '"',
        s.totalElapsedSec || 0,
        s.timeoutCount || 0,
        '"' + formatDateTime(s.submittedAt) + '"',
      ].join(',');
    });

    const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'SQL역량평가_채점통계_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportQuestionsJson() {
    const qs = global.SqlExamStorage.getQuestions();
    const blob = new Blob([JSON.stringify(qs, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sql_exam_questions_90.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleImportQuestionsJson(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('유효한 문제 배열 형식이 아닙니다.');
        }
        global.SqlExamStorage.saveCustomQuestions(parsed);
        alert('총 ' + parsed.length + '문항이 성공적으로 업로드되어 반영되었습니다!');
        renderQuestionStatsTable();
      } catch (err) {
        alert('JSON 파싱 오류: ' + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function handleResetQuestionsDefault() {
    global.SqlExamStorage.resetQuestionsToDefault();
    alert('기본 90문항(객관식 45 + 주관식 45)으로 복원되었습니다.');
    renderQuestionStatsTable();
  }

  async function runAdminSqlSandbox() {
    const input = document.getElementById('admin-sandbox-sql');
    const out = document.getElementById('admin-sandbox-output');
    if (!input || !out) return;
    const res = await global.SqlExamGrader.testRunSqlOnSampleDb(input.value);
    if (!res.ok) {
      out.innerHTML = '<div class="text-xs text-rose-400 code-font">오류: ' + escapeHtml(res.error) + '</div>';
      return;
    }
    const cols = res.result.columns || [];
    const vals = res.result.values || [];
    if (cols.length === 0) {
      out.innerHTML = '<div class="text-xs text-emerald-400">쿼리가 정상 실행되었습니다. (반환 행 없음)</div>';
      return;
    }
    const ths = cols.map(function (c) {
      return '<th class="px-2 py-1 text-left text-cyan-300 border-b border-slate-700">' + escapeHtml(c) + '</th>';
    }).join('');
    const trs = vals.map(function (r) {
      return '<tr>' + r.map(function (cell) {
        return '<td class="px-2 py-1 border-b border-slate-800 text-slate-300">' + escapeHtml(cell === null ? 'NULL' : cell) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    out.innerHTML =
      '<table class="w-full text-xs code-font"><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table>';
  }

  function openCandidateModal(submissionId) {
    const sub = allSubmissions.find(function (s) {
      return s.id === submissionId;
    });
    if (!sub) return;

    const modal = document.getElementById('candidate-detail-modal');
    const titleEl = document.getElementById('modal-cand-title');
    const subTitleEl = document.getElementById('modal-cand-subtitle');
    const bodyEl = document.getElementById('modal-cand-body');

    titleEl.textContent = sub.studentName + '님의 상세 채점표 (' + sub.score100 + '점)';
    subTitleEl.textContent =
      (sub.examModeLabel || '') + ' | 제출일시: ' + formatDateTime(sub.submittedAt);

    const qMap = new Map();
    global.SqlExamStorage.getQuestions().forEach(function (q) {
      qMap.set(q.id, q);
    });

    bodyEl.innerHTML = (sub.details || [])
      .map(function (d, i) {
        const q = qMap.get(d.questionId) || {};
        const badge = d.isCorrect
          ? '<span class="text-emerald-400 font-bold">정답 (+' + d.score + ')</span>'
          : d.score > 0
          ? '<span class="text-amber-300 font-bold">부분점수 (+' + d.score + ')</span>'
          : '<span class="text-rose-400 font-bold">오답 (0)</span>';

        return (
          '<div class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs space-y-1.5">' +
          '<div class="flex justify-between items-center">' +
          '<span class="code-font font-bold text-cyan-400">#' + (i + 1) + ' [' + escapeHtml(d.questionId) + '] ' + escapeHtml(d.category) + '</span>' +
          '<div>' + badge + ' <span class="text-slate-500 ml-2">' + d.elapsedSec + '초</span></div>' +
          '</div>' +
          '<div class="text-slate-200 font-semibold">' + escapeHtml(q.title || '') + '</div>' +
          '<div class="text-slate-400">제출 답안: <span class="code-font text-white">' + escapeHtml(d.userAnswer === null ? '미선택' : d.userAnswer) + '</span></div>' +
          '<div class="text-slate-400">모범 정답: <span class="code-font text-emerald-400">' + escapeHtml(d.correctAnswer) + '</span></div>' +
          '</div>'
        );
      })
      .join('');

    modal.classList.remove('hidden');
  }

  function closeCandidateModal() {
    const modal = document.getElementById('candidate-detail-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function handleSeedDemoData() {
    global.SqlExamStorage.seedDemoSubmissions();
    allSubmissions = await global.SqlExamStorage.fetchAllSubmissions();
    updatePendingReviewBadge();
    switchAdminTab(activeTab);
  }

  async function handleDeleteSubmission(submissionId) {
    if (!confirm('이 응시 기록을 삭제하시겠습니까?')) return;
    await global.SqlExamStorage.deleteSubmission(submissionId);
    allSubmissions = await global.SqlExamStorage.fetchAllSubmissions();
    updatePendingReviewBadge();
    switchAdminTab(activeTab);
  }

  async function handleClearAllSubmissions() {
    if (!confirm('테스트 데이터를 포함한 모든 응시 기록과 통계를 0건으로 완전히 초기화하시겠습니까?')) return;
    await global.SqlExamStorage.clearAllSubmissions();
    allSubmissions = [];
    updatePendingReviewBadge();
    switchAdminTab(activeTab);
    alert('모든 응시 데이터와 통계 지표가 0건으로 깨끗하게 초기화되었습니다!');
  }

  document.addEventListener('DOMContentLoaded', function () {
    const passInput = document.getElementById('admin-passcode-input');
    if (passInput) {
      passInput.value = '';
    }
    global.SqlExamGrader.initSqlEngine();

    if (sessionStorage.getItem(SESSION_AUTH_KEY) === '1') {
      unlockAdminConsole();
    }

    global.SqlExamStorage.onSyncMessage(function () {
      if (sessionStorage.getItem(SESSION_AUTH_KEY) === '1') {
        loadAdminDataAndRender();
      }
    });
  });

  global.handleAdminPasscodeLogin = handleAdminPasscodeLogin;
  global.handleGoogleAdminLogin = handleGoogleAdminLogin;
  global.switchAdminTab = switchAdminTab;
  global.renderCandidatesTable = renderCandidatesTable;
  global.renderSubjectiveReviewList = renderSubjectiveReviewList;
  global.handleAdminScoreOverride = handleAdminScoreOverride;
  global.renderQuestionStatsTable = renderQuestionStatsTable;
  global.saveAdminSettingsForm = saveAdminSettingsForm;
  global.exportSubmissionsCsv = exportSubmissionsCsv;
  global.exportQuestionsJson = exportQuestionsJson;
  global.handleImportQuestionsJson = handleImportQuestionsJson;
  global.handleResetQuestionsDefault = handleResetQuestionsDefault;
  global.runAdminSqlSandbox = runAdminSqlSandbox;
  global.openCandidateModal = openCandidateModal;
  global.closeCandidateModal = closeCandidateModal;
  global.handleSeedDemoData = handleSeedDemoData;
  global.handleDeleteSubmission = handleDeleteSubmission;
  global.handleClearAllSubmissions = handleClearAllSubmissions;
})(window);

