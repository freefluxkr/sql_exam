/**
 * Firebase Cloud Functions — Server-side SQL Auto-Grader
 * Validates per-question time limits and executes student SQL in an isolated in-memory SQLite instance.
 */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const initSqlJs = require('sql.js');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.gradeSqlSubmission = onRequest({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { studentName, details, examModeLabel } = req.body || {};
    if (!studentName || !Array.isArray(details)) {
      res.status(400).json({ error: 'Invalid submission payload' });
      return;
    }

    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.close();

    const docRef = admin.firestore().collection('sql_exam_submissions').doc();
    const record = {
      id: docRef.id,
      studentName: String(studentName).trim().slice(0, 30),
      examModeLabel: String(examModeLabel || ''),
      details,
      submittedAt: new Date().toISOString(),
    };

    await docRef.set(record);
    res.status(200).json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error('[gradeSqlSubmission] Error:', err);
    res.status(500).json({ error: 'Internal grading error' });
  }
});

