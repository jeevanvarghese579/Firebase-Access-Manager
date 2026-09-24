import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, test } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-namespace-isolation';
const labAppId = '1:379503088311:web:b37328f071189e18133332';
const collageAppId = '1:379503088311:web:6a63dfcd8523e9f8133332';
const entitledApps = [
  { key: 'ascensionManager', appId: '1:379503088311:web:7b5117cc3447eded133332', uid: 'ascension-user' },
  { key: 'schoolFestPro', appId: '1:379503088311:web:5774bcc84597b656133332', uid: 'fest-user' },
  { key: 'collageMaker', appId: collageAppId, uid: 'collage-user' },
  { key: 'attendanceManagerWithWaSender', appId: '1:379503088311:web:e046f96ed629ffd4133332', uid: 'attendance-manager-user' },
  { key: 'labMetrics', appId: labAppId, uid: 'lab-user' },
];
let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    for (const app of entitledApps) {
      await setDoc(doc(admin, 'appRegistry', app.appId), { active: true });
      await setDoc(doc(admin, 'accessUsers', app.uid), {
        active: true,
        apps: { [app.appId]: true },
      });
    }
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe('canonical Firestore namespaces', () => {
  test('owner-only apps isolate one user from another user', async () => {
    const owner = environment.authenticatedContext('sam-user').firestore();
    const other = environment.authenticatedContext('other-user').firestore();
    const path = 'apps/schoolAcademicsManager/users/sam-user/students/student-1';
    await assertSucceeds(setDoc(doc(owner, path), { name: 'Student' }));
    await assertFails(getDoc(doc(other, path)));
  });

  test('an app entitlement cannot be reused for another entitled namespace', async () => {
    const lab = environment.authenticatedContext('lab-user').firestore();
    const labPath = 'apps/labMetrics/users/lab-user/students/student-1';
    const collagePath = 'apps/collageMaker/users/lab-user/students/student-1';
    await assertSucceeds(setDoc(doc(lab, labPath), { roll_number: '1' }));
    await assertFails(setDoc(doc(lab, collagePath), { name: 'Wrong app' }));
  });

  test.each(entitledApps)('$key accepts its matching active entitlement', async ({ key, uid }) => {
    const client = environment.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
    await assertSucceeds(setDoc(doc(client, `apps/${key}/users/${uid}/settings/test`), { ok: true }));
  });

  test.each([
    'schoolAcademicsManager',
    'schoolExamsManager',
    'schoolBellManager',
    'gymTracker',
    'attendanceWaSender',
  ])('%s enforces UID ownership', async (key) => {
    const owner = environment.authenticatedContext('owner-user').firestore();
    const other = environment.authenticatedContext('other-user').firestore();
    const path = `apps/${key}/users/owner-user/settings/test`;
    await assertSucceeds(setDoc(doc(owner, path), { ok: true }));
    await assertFails(getDoc(doc(other, path)));
  });

  test('destructive operations remain confined to the authorized namespace', async () => {
    const collage = environment.authenticatedContext('collage-user').firestore();
    const own = 'apps/collageMaker/users/collage-user/students/student-1';
    const lab = 'apps/labMetrics/users/collage-user/students/student-1';
    await assertSucceeds(setDoc(doc(collage, own), { name: 'Owned' }));
    await assertSucceeds(deleteDoc(doc(collage, own)));
    await assertFails(deleteDoc(doc(collage, lab)));
  });

  test('client access to control-plane collections is denied', async () => {
    const client = environment.authenticatedContext('lab-user').firestore();
    await assertFails(getDoc(doc(client, 'accessUsers', 'lab-user')));
    await assertFails(setDoc(doc(client, 'appRegistry', labAppId), { active: false }));
  });

  test('temporary owner-scoped legacy access remains available', async () => {
    const owner = environment.authenticatedContext('legacy-user').firestore();
    const other = environment.authenticatedContext('other-user').firestore();
    const path = 'users/legacy-user/students/student-1';
    await assertSucceeds(setDoc(doc(owner, path), { name: 'Legacy' }));
    await assertFails(getDoc(doc(other, path)));
  });
});

describe('canonical Storage namespaces', () => {
  test('Bell Manager objects are owner scoped', async () => {
    const owner = environment.authenticatedContext('bell-user').storage();
    const other = environment.authenticatedContext('other-user').storage();
    const path = 'apps/schoolBellManager/users/bell-user/sounds/bell-1/file.mp3';
    await assertSucceeds(uploadBytes(ref(owner, path), new Uint8Array([1, 2, 3])));
    await assertFails(getBytes(ref(other, path)));
    await assertSucceeds(deleteObject(ref(owner, path)));
  });

  test('Collage Maker requires its own entitlement', async () => {
    const collage = environment.authenticatedContext('collage-user').storage();
    const lab = environment.authenticatedContext('lab-user').storage();
    const path = 'apps/collageMaker/users/collage-user/photos/photo-1.jpg';
    await assertSucceeds(uploadBytes(ref(collage, path), new Uint8Array([1])));
    await assertFails(uploadBytes(ref(lab, 'apps/collageMaker/users/lab-user/photos/photo-1.jpg'), new Uint8Array([1])));
    await assertSucceeds(deleteObject(ref(collage, path)));
  });
});
