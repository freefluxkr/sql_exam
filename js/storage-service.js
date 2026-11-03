/**
 * SQL Exam Storage & Firebase Sync Service
 * - Connects to Firebase Firestore (project: dmdg-live)
 * - Mirrors all data to localStorage + BroadcastChannel for instant real-time sync
 * - Manages Exam Settings, Question Bank overrides, Submissions, and Admin Manual Reviews
 */
(function (global) {
  'use strict';

  const LS_KEYS = {
    SUBMISSIONS: 'dmdg_sql_exam_submissions_v1',
    SETTINGS: 'dmdg_sql_exam_settings_v1',
    CUSTOM_QUESTIONS: 'dmdg_sql_exam_custom_questions_v1',
    DEVICE_ID: 'dmdg_sql_exam_device_id_v1',
    ACTIVE_SESSION: 'dmdg_sql_exam_active_session_v1',
  };

  const DEFAULT_SETTINGS = {
    examTitle: 'SQL 마스터 실전 역량 평가 (Ch05 기초 · Ch06 활용 · Ch07 응용)',
    choiceTimeLimit: 60,       // 객관식 1문항 1분 (60초)
    sqlTimeLimit: 120,         // 주관식 1문항 2분 (120초)
    passScore: 80,             // 합격 기준 점수 (100점 만점 환산 기준 80점)
    shuffleQuestions: true,    // 응시자마다 문제 순서 섞기
    blockDuplicateDevice: false, // 동일 기기 중복 응시 차단 여부 (관리자 설정 가능)
    examOpen: true,            // 시험 응시 열림/닫힘
    showExplanationOnResult: true, // 시험 종료 후 결과 화면에서 해설 공개
    updatedAt: new Date().toISOString(),
  };

  const firebaseConfig = {
    apiKey: 'AIzaSyBcS8aS5yHk2KFNYPImXslsFkSyoBwYrKI',
    authDomain: 'dmdg-live.firebaseapp.com',
    projectId: 'dmdg-live',
    storageBucket: 'dmdg-live.firebasestorage.app',
    messagingSenderId: '357433220336',
    appId: '1:357433220336:web:1a8914811da09123a0f635',
  };

  let firestoreDb = null;
  let broadcastChannel = null;

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel('dmdg_sql_exam_channel');
    }
  } catch (_) {}

  function initFirebase() {
    if (firestoreDb) return firestoreDb;
    try {
      if (typeof global.firebase !== 'undefined') {
        if (!global.firebase.apps || !global.firebase.apps.length) {
          global.firebase.initializeApp(firebaseConfig);
        }
        if (typeof global.firebase.firestore === 'function') {
          firestoreDb = global.firebase.firestore();
        }
      }
    } catch (err) {
      console.warn('[StorageService] Firebase init notice:', err);
    }
    return firestoreDb;
  }

  function getDeviceId() {
    let devId = localStorage.getItem(LS_KEYS.DEVICE_ID);
    if (!devId) {
      const rand = Math.random().toString(36).substring(2, 10);
      devId = 'DEV-' + Date.now().toString(36).toUpperCase() + '-' + rand.toUpperCase();
      localStorage.setItem(LS_KEYS.DEVICE_ID, devId);
    }
    return devId;
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(LS_KEYS.SETTINGS);
      if (raw) {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
      }
    } catch (_) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  async function fetchSettingsFromCloud() {
    const db = initFirebase();
    if (!db) return getSettings();
    try {
      const doc = await db.collection('sql_exam_config').doc('settings').get();
      if (doc.exists) {
        const merged = Object.assign({}, DEFAULT_SETTINGS, doc.data());
        localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(merged));
        return merged;
      }
    } catch (_) {}
    return getSettings();
  }

  async function saveSettings(newSettings) {
    const merged = Object.assign({}, getSettings(), newSettings, {
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(merged));
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'SETTINGS_UPDATED', payload: merged });
    }
    const db = initFirebase();
    if (db) {
      try {
        await db.collection('sql_exam_config').doc('settings').set(merged, { merge: true });
      } catch (err) {
        console.warn('[StorageService] Cloud settings save skipped:', err.message);
      }
    }
    return merged;
  }

  function getQuestions() {
    try {
      const customRaw = localStorage.getItem(LS_KEYS.CUSTOM_QUESTIONS);
      if (customRaw) {
        const parsed = JSON.parse(customRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}
    return Array.isArray(global.SQL_EXAM_QUESTIONS) ? global.SQL_EXAM_QUESTIONS : [];
  }

  function saveCustomQuestions(questionsArray) {
    if (!Array.isArray(questionsArray)) return false;
    localStorage.setItem(LS_KEYS.CUSTOM_QUESTIONS, JSON.stringify(questionsArray));
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'QUESTIONS_UPDATED' });
    }
    return true;
  }

  function resetQuestionsToDefault() {
    localStorage.removeItem(LS_KEYS.CUSTOM_QUESTIONS);
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'QUESTIONS_UPDATED' });
    }
    return getQuestions();
  }

  function getLocalSubmissions() {
    try {
      const raw = localStorage.getItem(LS_KEYS.SUBMISSIONS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (_) {}
    return [];
  }

  function saveLocalSubmissions(list) {
    localStorage.setItem(LS_KEYS.SUBMISSIONS, JSON.stringify(list));
  }

  function recomputeSubmissionSummary(submission, passScoreOverride) {
    const settings = getSettings();
    const passScore = typeof passScoreOverride === 'number' ? passScoreOverride : settings.passScore;
    const details = Array.isArray(submission.details) ? submission.details : [];

    let earnedPoints = 0;
    let maxPoints = 0;
    let correctCount = 0;
    let choiceEarned = 0;
    let choiceMax = 0;
    let sqlEarned = 0;
    let sqlMax = 0;
    let timeoutCount = 0;
    let totalElapsedSec = 0;
    let pendingReviewCount = 0;

    const areaStats = {
      'SQL 기초': { earned: 0, max: 0, correct: 0, total: 0 },
      'SQL 활용': { earned: 0, max: 0, correct: 0, total: 0 },
      'SQL 응용': { earned: 0, max: 0, correct: 0, total: 0 },
    };

    details.forEach(function (d) {
      const pts = Number(d.score) || 0;
      const mPts = Number(d.maxPoints) || 2;
      earnedPoints += pts;
      maxPoints += mPts;
      if (pts >= mPts) correctCount += 1;
      if (d.timedOut) timeoutCount += 1;
      if (d.needsReview && !d.adminReviewed) pendingReviewCount += 1;
      totalElapsedSec += Number(d.elapsedSec) || 0;

      if (d.type === 'choice') {
        choiceEarned += pts;
        choiceMax += mPts;
      } else {
        sqlEarned += pts;
        sqlMax += mPts;
      }

      const cat = d.category || 'SQL 기초';
      if (!areaStats[cat]) {
        areaStats[cat] = { earned: 0, max: 0, correct: 0, total: 0 };
      }
      areaStats[cat].earned += pts;
      areaStats[cat].max += mPts;
      if (pts >= mPts) areaStats[cat].correct += 1;
      areaStats[cat].total += 1;
    });

    const normalizedScore = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 1000) / 10 : 0;
    const passed = normalizedScore >= passScore;

    submission.earnedPoints = earnedPoints;
    submission.maxPoints = maxPoints;
    submission.score100 = normalizedScore;
    submission.correctCount = correctCount;
    submission.totalQuestions = details.length;
    submission.passed = passed;
    submission.choiceEarned = choiceEarned;
    submission.choiceMax = choiceMax;
    submission.sqlEarned = sqlEarned;
    submission.sqlMax = sqlMax;
    submission.timeoutCount = timeoutCount;
    submission.totalElapsedSec = totalElapsedSec;
    submission.pendingReviewCount = pendingReviewCount;
    submission.areaStats = areaStats;
    return submission;
  }

  async function saveSubmission(submissionData) {
    const list = getLocalSubmissions();
    const deviceId = getDeviceId();
    const cleanName = String(submissionData.studentName || '').trim();

    // Check duplicate name or device
    const isDuplicateName = list.some(function (s) {
      return String(s.studentName || '').trim() === cleanName;
    });
    const isDuplicateDevice = list.some(function (s) {
      return s.deviceId === deviceId;
    });

    const record = Object.assign({}, submissionData, {
      id: submissionData.id || 'SUB-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      deviceId: deviceId,
      isDuplicateName: isDuplicateName,
      isDuplicateDevice: isDuplicateDevice,
      submittedAt: submissionData.submittedAt || new Date().toISOString(),
    });

    recomputeSubmissionSummary(record);

    list.unshift(record);
    saveLocalSubmissions(list);

    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'SUBMISSION_ADDED', payload: record });
    }

    const db = initFirebase();
    if (db) {
      try {
        await db.collection('sql_exam_submissions').doc(record.id).set(record);
      } catch (err) {
        console.warn('[StorageService] Firestore save skipped (local saved):', err.message);
      }
    }

    return record;
  }

  async function fetchAllSubmissions() {
    const localList = getLocalSubmissions();
    const db = initFirebase();
    if (!db) return localList;

    try {
      const snap = await db
        .collection('sql_exam_submissions')
        .orderBy('submittedAt', 'desc')
        .limit(500)
        .get();

      if (!snap.empty) {
        const mapById = new Map();
        localList.forEach(function (item) {
          mapById.set(item.id, item);
        });
        snap.docs.forEach(function (doc) {
          const cloudData = doc.data();
          if (cloudData && cloudData.id) {
            mapById.set(cloudData.id, cloudData);
          }
        });
        const merged = Array.from(mapById.values()).sort(function (a, b) {
          return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
        });
        saveLocalSubmissions(merged);
        return merged;
      }
    } catch (err) {
      console.warn('[StorageService] Using local submissions cache:', err.message);
    }

    return localList;
  }

  async function updateSubjectiveScore(submissionId, questionId, newScore, adminComment) {
    const list = getLocalSubmissions();
    const idx = list.findIndex(function (s) {
      return s.id === submissionId;
    });
    if (idx === -1) return null;

    const sub = list[idx];
    const detail = (sub.details || []).find(function (d) {
      return d.questionId === questionId;
    });
    if (!detail) return null;

    const clamped = Math.max(0, Math.min(detail.maxPoints || 2, Number(newScore) || 0));
    detail.score = clamped;
    detail.isCorrect = clamped >= (detail.maxPoints || 2);
    detail.adminReviewed = true;
    detail.needsReview = false;
    detail.adminComment = adminComment || '관리자 수동 검수 완료';
    detail.methodUsed = '관리자 확정 (' + clamped + '/' + (detail.maxPoints || 2) + '점)';

    recomputeSubmissionSummary(sub);
    sub.updatedAt = new Date().toISOString();

    list[idx] = sub;
    saveLocalSubmissions(list);

    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'SUBMISSION_UPDATED', payload: sub });
    }

    const db = initFirebase();
    if (db) {
      try {
        await db.collection('sql_exam_submissions').doc(sub.id).set(sub, { merge: true });
      } catch (_) {}
    }

    return sub;
  }

  async function deleteSubmission(submissionId) {
    const list = getLocalSubmissions().filter(function (s) {
      return s.id !== submissionId;
    });
    saveLocalSubmissions(list);
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'SUBMISSION_DELETED', payload: submissionId });
    }
    const db = initFirebase();
    if (db) {
      try {
        await db.collection('sql_exam_submissions').doc(submissionId).delete();
      } catch (_) {}
    }
    return list;
  }

  async function clearAllSubmissions() {
    saveLocalSubmissions([]);
    localStorage.setItem('dmdg_sql_exam_demo_seeded_v1', '1');
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'SUBMISSIONS_CLEARED' });
    }
    const db = initFirebase();
    if (db) {
      try {
        const snap = await db.collection('sql_exam_submissions').limit(500).get();
        if (!snap.empty) {
          const batch = db.batch();
          snap.docs.forEach(function (doc) {
            batch.delete(doc.ref);
          });
          await batch.commit();
        }
      } catch (err) {
        console.warn('[StorageService] Cloud clear warning:', err.message);
      }
    }
    return [];
  }

  // Active exam session persistence (prevents timer reset on page reload)
  function getActiveSession() {
    try {
      const raw = sessionStorage.getItem(LS_KEYS.ACTIVE_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveActiveSession(sessionObj) {
    try {
      if (!sessionObj) {
        sessionStorage.removeItem(LS_KEYS.ACTIVE_SESSION);
      } else {
        sessionStorage.setItem(LS_KEYS.ACTIVE_SESSION, JSON.stringify(sessionObj));
      }
    } catch (_) {}
  }

  // Generate realistic demo submissions for testing Admin Analytics
  function seedDemoSubmissions() {
    const allQs = getQuestions();
    const choiceQs = allQs.filter(function (q) { return q.type === 'choice'; });
    const sqlQs = allQs.filter(function (q) { return q.type === 'sql'; });

    const sampleStudents = [
      { name: '김민준', accuracy: 0.94, mode: '객관식 45문항', targetQs: choiceQs },
      { name: '이서연', accuracy: 0.88, mode: '주관식 45문항', targetQs: sqlQs },
      { name: '박지훈', accuracy: 0.83, mode: '통합 90문항', targetQs: allQs },
      { name: '최수빈', accuracy: 0.76, mode: '객관식 45문항', targetQs: choiceQs },
      { name: '정우성', accuracy: 0.91, mode: '통합 90문항', targetQs: allQs },
      { name: '강하늘', accuracy: 0.65, mode: '주관식 45문항', targetQs: sqlQs },
      { name: '윤채원', accuracy: 0.85, mode: '객관식 45문항', targetQs: choiceQs },
      { name: '임도현', accuracy: 0.54, mode: '객관식 45문항', targetQs: choiceQs },
      { name: '한지민', accuracy: 0.96, mode: '주관식 45문항', targetQs: sqlQs },
      { name: '오세훈', accuracy: 0.72, mode: '통합 90문항', targetQs: allQs },
    ];

    const now = Date.now();
    const list = getLocalSubmissions();

    sampleStudents.forEach(function (stu, idx) {
      const details = stu.targetQs.map(function (q, qIdx) {
        // Make certain hard questions have lower accuracy for realistic analytics
        const difficultyMod = (q.no % 7 === 0) ? -0.22 : (q.no % 5 === 0 ? -0.1 : 0.05);
        const prob = Math.min(0.98, Math.max(0.15, stu.accuracy + difficultyMod));
        const deterministicSeed = Math.sin((idx + 1) * 97 + (qIdx + 1) * 31) * 10000;
        const randVal = deterministicSeed - Math.floor(deterministicSeed);
        const isCorrect = randVal < prob;
        const timedOut = !isCorrect && randVal > 0.92;
        const maxPts = q.points || 2;
        const isPartial = !isCorrect && q.type === 'sql' && randVal > 0.78;
        const score = isCorrect ? maxPts : (isPartial ? 1 : 0);

        const limit = q.type === 'choice' ? 60 : 120;
        const elapsedSec = timedOut
          ? limit
          : Math.max(8, Math.min(limit - 3, Math.round((limit * 0.45) + (randVal * limit * 0.45))));

        let userAns = null;
        if (q.type === 'choice') {
          userAns = isCorrect ? q.answer : ((q.answer % 4) + 1);
          if (timedOut) userAns = null;
        } else {
          if (isCorrect) {
            userAns = q.answer;
          } else if (isPartial) {
            userAns = q.answer.split('\n')[0] + ' -- 조건 일부 누락';
          } else if (timedOut) {
            userAns = '';
          } else {
            userAns = 'SELECT * FROM 학생; -- 미완성 쿼리';
          }
        }

        return {
          questionId: q.id,
          no: q.no,
          category: q.category,
          type: q.type,
          userAnswer: userAns,
          correctAnswer: q.answer,
          isCorrect: isCorrect,
          score: score,
          maxPoints: maxPts,
          methodUsed: q.type === 'choice'
            ? '객관식 정답 비교'
            : (q.grading === 'result' ? 'SQL 실행 결과 비교 일치' : '핵심 키워드 분석'),
          elapsedSec: elapsedSec,
          timedOut: timedOut,
          needsReview: isPartial,
          adminReviewed: false,
        };
      });

      const sub = {
        id: 'DEMO-SUB-' + (idx + 1) + '-' + Date.now().toString(36),
        studentName: stu.name,
        examCategoryFilter: 'ALL',
        examTypeFilter: stu.mode.includes('객관식') ? 'choice' : (stu.mode.includes('주관식') ? 'sql' : 'all'),
        examModeLabel: stu.mode,
        deviceId: 'DEMO-DEV-0' + (idx + 1),
        isDuplicateName: false,
        isDuplicateDevice: false,
        submittedAt: new Date(now - (sampleStudents.length - idx) * 18 * 60 * 1000).toISOString(),
        details: details,
      };

      recomputeSubmissionSummary(sub);
      list.unshift(sub);
    });

    saveLocalSubmissions(list);
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'SUBMISSION_ADDED' });
    }
    return list;
  }

  function onSyncMessage(callback) {
    if (!broadcastChannel || typeof callback !== 'function') return;
    broadcastChannel.addEventListener('message', function (ev) {
      callback(ev.data);
    });
  }

  global.SqlExamStorage = {
    getSettings: getSettings,
    fetchSettingsFromCloud: fetchSettingsFromCloud,
    saveSettings: saveSettings,
    getQuestions: getQuestions,
    saveCustomQuestions: saveCustomQuestions,
    resetQuestionsToDefault: resetQuestionsToDefault,
    getDeviceId: getDeviceId,
    saveSubmission: saveSubmission,
    fetchAllSubmissions: fetchAllSubmissions,
    updateSubjectiveScore: updateSubjectiveScore,
    deleteSubmission: deleteSubmission,
    clearAllSubmissions: clearAllSubmissions,
    getActiveSession: getActiveSession,
    saveActiveSession: saveActiveSession,
    seedDemoSubmissions: seedDemoSubmissions,
    onSyncMessage: onSyncMessage,
    recomputeSubmissionSummary: recomputeSubmissionSummary,
  };
})(window);

