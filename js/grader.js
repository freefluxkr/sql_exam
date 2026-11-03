/**
 * SQL Exam Auto-Grader Engine (sql.js WebAssembly + Hybrid Rubric)
 * - Objective (choice): Exact option index match (1..4)
 * - Subjective (sql):
 *   1) "result": Executes student SQL and model SQL in isolated in-memory SQLite DBs and compares result sets
 *   2) "state": Executes DDL/DML/VIEW/INDEX in isolated in-memory SQLite DBs and compares checkSql results
 *   3) "keyword": Normalized SQL token & keyword rubric matching (with partial credit support)
 */
(function (global) {
  'use strict';

  let sqlJsInstance = null;
  let sqlJsLoadingPromise = null;

  async function initSqlEngine() {
    if (sqlJsInstance) return sqlJsInstance;
    if (sqlJsLoadingPromise) return sqlJsLoadingPromise;

    if (typeof global.initSqlJs !== 'function') {
      return null;
    }

    sqlJsLoadingPromise = global
      .initSqlJs({
        locateFile: function (file) {
          return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + file;
        },
      })
      .then(function (SQL) {
        sqlJsInstance = SQL;
        return SQL;
      })
      .catch(function (err) {
        console.warn('[Grader] sql.js load warning, falling back to keyword rubric:', err);
        return null;
      });

    return sqlJsLoadingPromise;
  }

  function normalizeSqlText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/['"`]/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/\s*([,();=<>+\-*])\s*/g, '$1')
      .replace(/;+$/g, '')
      .trim()
      .toUpperCase();
  }

  function formatQueryResult(execResult) {
    if (!execResult || !execResult.length) {
      return { columns: [], values: [] };
    }
    const last = execResult[execResult.length - 1];
    return {
      columns: last.columns || [],
      values: last.values || [],
    };
  }

  function canonicalizeRows(values, orderMatters) {
    const normalized = (values || []).map(function (row) {
      return row.map(function (cell) {
        if (cell === null || cell === undefined) return 'NULL';
        if (typeof cell === 'number') {
          return Number.isInteger(cell) ? String(cell) : Number(cell).toFixed(4);
        }
        return String(cell).trim();
      });
    });

    if (!orderMatters) {
      normalized.sort(function (a, b) {
        return JSON.stringify(a).localeCompare(JSON.stringify(b));
      });
    }
    return normalized;
  }

  function compareResultSets(resA, resB, orderMatters) {
    if (!resA || !resB) return false;
    if (resA.values.length !== resB.values.length) return false;
    if (resA.values.length === 0) return true;
    if (resA.columns.length !== resB.columns.length) return false;

    const rowsA = canonicalizeRows(resA.values, orderMatters);
    const rowsB = canonicalizeRows(resB.values, orderMatters);

    return JSON.stringify(rowsA) === JSON.stringify(rowsB);
  }

  function evaluateKeywords(question, userAnswer) {
    const rawUser = (userAnswer || '').trim();
    if (!rawUser) {
      return {
        isCorrect: false,
        score: 0,
        matchedKeywords: [],
        missingKeywords: question.keywords || [],
        ratio: 0,
        methodUsed: '미작성',
      };
    }

    const normUser = normalizeSqlText(rawUser);
    const normModel = normalizeSqlText(question.answer || '');

    if (normUser && normModel && normUser === normModel) {
      return {
        isCorrect: true,
        score: question.points || 2,
        matchedKeywords: question.keywords || [],
        missingKeywords: [],
        ratio: 1,
        methodUsed: '정답 쿼리 일치',
      };
    }

    const kwList = Array.isArray(question.keywords) ? question.keywords : [];
    if (kwList.length === 0) {
      const simpleMatch = normUser.includes(normModel) || normModel.includes(normUser);
      return {
        isCorrect: simpleMatch,
        score: simpleMatch ? (question.points || 2) : 0,
        matchedKeywords: [],
        missingKeywords: [],
        ratio: simpleMatch ? 1 : 0,
        methodUsed: '텍스트 비교',
      };
    }

    const matched = [];
    const missing = [];
    const upperUser = rawUser.toUpperCase();

    kwList.forEach(function (kw) {
      const upperKw = String(kw).toUpperCase();
      if (upperUser.includes(upperKw) || normUser.includes(normalizeSqlText(kw))) {
        matched.push(kw);
      } else {
        missing.push(kw);
      }
    });

    const ratio = matched.length / kwList.length;
    const maxPts = question.points || 2;
    let score = 0;
    let isCorrect = false;

    // For short/descriptive questions (e.g., Q26, Q31, Q43, Q44), >= 75% keyword match is full score
    const threshold = question.grading === 'keyword' ? 0.75 : 0.85;
    if (ratio >= threshold) {
      score = maxPts;
      isCorrect = true;
    } else if (ratio >= 0.5) {
      score = Math.max(1, Math.round(maxPts * 0.5));
      isCorrect = false;
    }

    return {
      isCorrect: isCorrect,
      score: score,
      matchedKeywords: matched,
      missingKeywords: missing,
      ratio: ratio,
      methodUsed: '핵심 키워드 분석 (' + matched.length + '/' + kwList.length + ')',
    };
  }

  async function gradeSubjectiveSql(question, userAnswer) {
    const rawUser = (userAnswer || '').trim();
    const maxPts = question.points || 2;

    if (!rawUser) {
      return {
        isCorrect: false,
        score: 0,
        maxPoints: maxPts,
        methodUsed: '미응답 (시간초과/공백)',
        sqlError: null,
        userResultPreview: null,
        expectedResultPreview: null,
        needsReview: false,
      };
    }

    // Limit query length for safety
    if (rawUser.length > 4000) {
      return {
        isCorrect: false,
        score: 0,
        maxPoints: maxPts,
        methodUsed: '입력 길이 초과',
        sqlError: '답안 길이가 4,000자를 초과했습니다.',
        userResultPreview: null,
        expectedResultPreview: null,
        needsReview: true,
      };
    }

    const SQL = await initSqlEngine();
    const schemaSql = global.SQL_EXAM_SCHEMA || '';

    // 1. Try SQLite execution for "result" or "state" grading
    if (SQL && (question.grading === 'result' || question.grading === 'state')) {
      let dbExpected = null;
      let dbUser = null;
      try {
        dbExpected = new SQL.Database();
        dbUser = new SQL.Database();

        dbExpected.run(schemaSql);
        dbUser.run(schemaSql);

        if (question.setupDrop) {
          dbExpected.run(question.setupDrop);
          dbUser.run(question.setupDrop);
        }

        if (question.grading === 'result') {
          const expExec = dbExpected.exec(question.answer);
          const expFormatted = formatQueryResult(expExec);

          let userExec = null;
          let sqlError = null;
          try {
            userExec = dbUser.exec(rawUser);
          } catch (uErr) {
            sqlError = uErr.message || String(uErr);
          }

          if (!sqlError && userExec) {
            const userFormatted = formatQueryResult(userExec);
            const matched = compareResultSets(
              expFormatted,
              userFormatted,
              Boolean(question.orderMatters)
            );

            // Check if question requires specific construct (like BETWEEN or Subquery IN)
            const kwEval = evaluateKeywords(question, rawUser);
            if (matched) {
              return {
                isCorrect: true,
                score: maxPts,
                maxPoints: maxPts,
                methodUsed: 'SQL 실행 결과 비교 일치',
                sqlError: null,
                userResultPreview: userFormatted,
                expectedResultPreview: expFormatted,
                matchedKeywords: kwEval.matchedKeywords,
                missingKeywords: kwEval.missingKeywords,
                needsReview: false,
              };
            } else {
              return {
                isCorrect: false,
                score: kwEval.ratio >= 0.7 ? Math.floor(maxPts / 2) : 0,
                maxPoints: maxPts,
                methodUsed: 'SQL 실행 결과 불일치',
                sqlError: null,
                userResultPreview: userFormatted,
                expectedResultPreview: expFormatted,
                matchedKeywords: kwEval.matchedKeywords,
                missingKeywords: kwEval.missingKeywords,
                needsReview: kwEval.ratio >= 0.5,
              };
            }
          } else {
            // SQLite error occurred (could be syntax error OR valid MySQL syntax difference)
            const kwEval = evaluateKeywords(question, rawUser);
            return {
              isCorrect: kwEval.isCorrect,
              score: kwEval.score,
              maxPoints: maxPts,
              methodUsed: kwEval.isCorrect
                ? '표준 SQL 구문 패턴 일치'
                : 'SQL 구문 오류 / 키워드 채점',
              sqlError: sqlError,
              userResultPreview: null,
              expectedResultPreview: expFormatted,
              matchedKeywords: kwEval.matchedKeywords,
              missingKeywords: kwEval.missingKeywords,
              needsReview: !kwEval.isCorrect && kwEval.ratio >= 0.4,
            };
          }
        } else if (question.grading === 'state') {
          dbExpected.run(question.answer);
          const expFormatted = formatQueryResult(dbExpected.exec(question.checkSql));

          let sqlError = null;
          let userFormatted = null;
          try {
            dbUser.run(rawUser);
            userFormatted = formatQueryResult(dbUser.exec(question.checkSql));
          } catch (uErr) {
            sqlError = uErr.message || String(uErr);
          }

          if (!sqlError && userFormatted) {
            const matched = compareResultSets(expFormatted, userFormatted, false);
            const kwEval = evaluateKeywords(question, rawUser);
            if (matched) {
              return {
                isCorrect: true,
                score: maxPts,
                maxPoints: maxPts,
                methodUsed: 'DB 상태(스키마/데이터) 검증 일치',
                sqlError: null,
                userResultPreview: userFormatted,
                expectedResultPreview: expFormatted,
                matchedKeywords: kwEval.matchedKeywords,
                missingKeywords: kwEval.missingKeywords,
                needsReview: false,
              };
            }
          }

          // Fallback to keyword rubric (e.g., MySQL syntax differences in DDL)
          const kwEval = evaluateKeywords(question, rawUser);
          return {
            isCorrect: kwEval.isCorrect,
            score: kwEval.score,
            maxPoints: maxPts,
            methodUsed: kwEval.methodUsed,
            sqlError: sqlError,
            userResultPreview: userFormatted,
            expectedResultPreview: expFormatted,
            matchedKeywords: kwEval.matchedKeywords,
            missingKeywords: kwEval.missingKeywords,
            needsReview: !kwEval.isCorrect && kwEval.ratio >= 0.4,
          };
        }
      } catch (engineErr) {
        console.warn('[Grader] SQLite execution fallback:', engineErr);
      } finally {
        if (dbExpected) {
          try { dbExpected.close(); } catch (_) {}
        }
        if (dbUser) {
          try { dbUser.close(); } catch (_) {}
        }
      }
    }

    // 2. Keyword / Rubric Evaluation for DCL, Procedural SQL, Short Answers
    const kwResult = evaluateKeywords(question, rawUser);
    return {
      isCorrect: kwResult.isCorrect,
      score: kwResult.score,
      maxPoints: maxPts,
      methodUsed: kwResult.methodUsed,
      sqlError: null,
      userResultPreview: null,
      expectedResultPreview: null,
      matchedKeywords: kwResult.matchedKeywords,
      missingKeywords: kwResult.missingKeywords,
      needsReview: !kwResult.isCorrect && kwResult.ratio >= 0.4,
    };
  }

  async function gradeQuestion(question, userAnswer, meta) {
    const maxPts = question.points || 2;
    const elapsedSec = meta && typeof meta.elapsedSec === 'number' ? meta.elapsedSec : 0;
    const timedOut = Boolean(meta && meta.timedOut);

    if (question.type === 'choice') {
      const selected = Number(userAnswer);
      const correctOpt = Number(question.answer);
      const isCorrect = !Number.isNaN(selected) && selected === correctOpt;
      return {
        questionId: question.id,
        no: question.no,
        category: question.category,
        type: 'choice',
        userAnswer: selected || null,
        correctAnswer: correctOpt,
        isCorrect: isCorrect,
        score: isCorrect ? maxPts : 0,
        maxPoints: maxPts,
        methodUsed: '객관식 정답 비교',
        elapsedSec: elapsedSec,
        timedOut: timedOut,
        needsReview: false,
      };
    }

    const subjRes = await gradeSubjectiveSql(question, userAnswer);
    return {
      questionId: question.id,
      no: question.no,
      category: question.category,
      type: 'sql',
      userAnswer: userAnswer || '',
      correctAnswer: question.answer,
      isCorrect: subjRes.isCorrect,
      score: subjRes.score,
      maxPoints: maxPts,
      methodUsed: subjRes.methodUsed,
      sqlError: subjRes.sqlError,
      userResultPreview: subjRes.userResultPreview,
      expectedResultPreview: subjRes.expectedResultPreview,
      matchedKeywords: subjRes.matchedKeywords || [],
      missingKeywords: subjRes.missingKeywords || [],
      elapsedSec: elapsedSec,
      timedOut: timedOut,
      needsReview: subjRes.needsReview,
    };
  }

  async function testRunSqlOnSampleDb(sqlQuery) {
    const SQL = await initSqlEngine();
    if (!SQL) {
      return { ok: false, error: 'SQL 엔진을 불러오는 중입니다.' };
    }
    const db = new SQL.Database();
    try {
      db.run(global.SQL_EXAM_SCHEMA || '');
      const res = db.exec(sqlQuery);
      return { ok: true, result: formatQueryResult(res) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  global.SqlExamGrader = {
    initSqlEngine: initSqlEngine,
    gradeQuestion: gradeQuestion,
    testRunSqlOnSampleDb: testRunSqlOnSampleDb,
    normalizeSqlText: normalizeSqlText,
  };
})(window);

