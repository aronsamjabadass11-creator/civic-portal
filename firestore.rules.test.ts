/**
 * Payload-First Security Rules Verification Matrix (Dirty Dozen)
 * Designed for verification against Firestore Rules Unit Testing / Emulator.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  operation: 'create' | 'update' | 'get' | 'list';
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED' | 'ALLOW';
}

export const dirtyDozenCases: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Spoofed Author UID on report create',
    operation: 'create',
    path: 'reports/rep_spoof_01',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { authorUid: 'user_b', status: 'submitted', upvotesCount: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow field injection on report create',
    operation: 'create',
    path: 'reports/rep_shadow_02',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { authorUid: 'user_a', isVerifiedOfficial: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Initial status bypass (submitted != resolved)',
    operation: 'create',
    path: 'reports/rep_status_03',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { authorUid: 'user_a', status: 'resolved', upvotesCount: 500 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Client timestamp forgery (createdAt != request.time)',
    operation: 'create',
    path: 'reports/rep_time_04',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { authorUid: 'user_a', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Unverified email write attempt',
    operation: 'create',
    path: 'reports/rep_unverified_05',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: false },
    payload: { authorUid: 'user_a', status: 'submitted', upvotesCount: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Resource poisoning (oversized path ID > 128 chars)',
    operation: 'create',
    path: `reports/${'a'.repeat(150)}`,
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { authorUid: 'user_a', status: 'submitted', upvotesCount: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Unauthorized status mutation by non-author non-admin',
    operation: 'update',
    path: 'reports/rep_existing_07',
    auth: { uid: 'user_b', email: 'b@example.com', email_verified: true },
    payload: { status: 'acknowledged' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Terminal state tampering after resolved',
    operation: 'update',
    path: 'reports/rep_resolved_08',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { status: 'submitted', description: 'Reopening without admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'State shortcutting (submitted -> resolved directly)',
    operation: 'update',
    path: 'reports/rep_shortcut_09',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { status: 'resolved' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Cross-user PII snooping on /users/{uid}/private/info',
    operation: 'get',
    path: 'users/user_b/private/info',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unlinked vote inflation without atomic vote subdoc',
    operation: 'update',
    path: 'reports/rep_vote_11',
    auth: { uid: 'user_b', email: 'b@example.com', email_verified: true },
    payload: { upvotesCount: 99 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Self privilege escalation into /admins/{uid}',
    operation: 'create',
    path: 'admins/user_a',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { uid: 'user_a', role: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
];
