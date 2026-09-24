#!/usr/bin/env node

// Read-only legacy namespace inventory. This script intentionally imports no
// Firestore write APIs and never mutates source documents.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => {
  if (!value.startsWith('--')) return [value, true];
  const next = all[index + 1];
  return [value.slice(2), next && !next.startsWith('--') ? next : true];
}));

if (typeof args.uid !== 'string' || !args.uid.trim()) {
  console.error('Usage: node scripts/analyze-legacy-firebase-data.mjs --uid <firebase-uid> [--project <project-id>]');
  process.exitCode = 2;
} else {
  const projectId = typeof args.project === 'string' ? args.project : 'inter-level-progress-manager';
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const uid = args.uid.trim();

  const hasString = (data, key) => typeof data[key] === 'string' && data[key].trim().length > 0;
  const hasAny = (data, keys) => keys.filter((key) => key in data);

  function classifyStudent(data) {
    const samRequired = ['classId', 'rollNumber', 'name'];
    const samOptional = ['admissionNumber', 'notes', 'createdAt', 'updatedAt'];
    const labMarkers = ['roll_number', 'batch_number', 'bought_record', 'submitted_record', 'signs_obtained'];
    const collageMarkers = ['categoryId', 'photoUrl', 'participations'];
    const attendanceMarkers = ['phone', 'parentPhone', 'attendance', 'absent'];
    const samComplete = samRequired.every((key) => hasString(data, key));
    const labFound = hasAny(data, labMarkers);
    const collageFound = hasAny(data, collageMarkers);
    const attendanceFound = hasAny(data, attendanceMarkers);
    const conflicting = [...labFound, ...collageFound, ...attendanceFound];

    if (samComplete && conflicting.length === 0) {
      return {
        likelyApp: 'schoolAcademicsManager',
        confidence: 'HIGH',
        reason: `Matches required SAM fields (${samRequired.join(', ')})${hasAny(data, samOptional).length ? ' and SAM metadata' : ''}.`,
      };
    }
    if (labFound.length >= 3 && !samComplete) {
      return { likelyApp: 'labMetrics', confidence: 'HIGH', reason: `LabMetrics markers: ${labFound.join(', ')}.` };
    }
    if (samComplete && conflicting.length > 0) {
      return { likelyApp: 'ambiguous', confidence: 'LOW', reason: `Contains a complete SAM shape plus conflicting fields: ${conflicting.join(', ')}.` };
    }
    if (collageFound.length >= 2) {
      return { likelyApp: 'collageMaker', confidence: 'MEDIUM', reason: `Collage Maker markers: ${collageFound.join(', ')}.` };
    }
    if (attendanceFound.length >= 2) {
      return { likelyApp: 'attendanceWaSender', confidence: 'MEDIUM', reason: `Attendance markers: ${attendanceFound.join(', ')}.` };
    }
    return {
      likelyApp: 'unknown',
      confidence: 'LOW',
      reason: `Insufficient app-specific evidence. Present keys: ${Object.keys(data).sort().join(', ') || '(none)'}.`,
    };
  }

  const targets = [
    ['users', uid, 'students'],
    ['users', uid, 'classes'],
    ['users', uid, 'settings'],
    ['users', uid, 'experiments'],
    ['users', uid, 'grades'],
    ['users', uid, 'profiles'],
    ['users', uid, 'workouts'],
    ['users', uid, 'categories'],
    ['users', uid, 'items'],
    ['users', uid, 'participations'],
    ['users', uid, 'results'],
    ['users', uid, 'frameTemplates'],
    ['users', uid, 'absentees'],
    ['users', uid, 'backups'],
    ['ascensionManagerUsers', uid, 'settings'],
    ['schoolFestProUsers', uid, 'data'],
    ['attendanceManagerUsers', uid, 'settings'],
  ];

  const documents = [];
  for (const segments of targets) {
    const path = segments.join('/');
    const snapshot = await db.collection(path).get();
    for (const item of snapshot.docs) {
      const data = item.data();
      const classification = path === `users/${uid}/students`
        ? classifyStudent(data)
        : {
            likelyApp: path.startsWith('ascensionManagerUsers/') ? 'ascensionManager'
              : path.startsWith('schoolFestProUsers/') ? 'schoolFestPro'
                : path.startsWith('attendanceManagerUsers/') ? 'attendanceManagerWithWaSender'
                  : 'legacy-shared-path',
            confidence: path.startsWith('users/') ? 'LOW' : 'HIGH',
            reason: path.startsWith('users/')
              ? 'Generic legacy path; inspect fields and related collections before assigning ownership.'
              : 'Application-specific legacy root.',
          };
      documents.push({
        path: `${path}/${item.id}`,
        documentId: item.id,
        ...classification,
        fields: Object.keys(data).sort(),
      });
    }
  }

  console.log(JSON.stringify({
    type: 'FIREBASE_LEGACY_READ_ONLY_ANALYSIS',
    projectId,
    uid,
    analyzedAt: new Date().toISOString(),
    readOnly: true,
    documentCount: documents.length,
    documents,
  }, null, 2));
}
