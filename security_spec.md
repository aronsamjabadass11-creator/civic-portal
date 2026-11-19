# Civic Report Portal Security Specification

## 1. Data Invariants
1. **Identity Integrity**: No user may create a report (`CivicReport`), vote (`ReportVote`), or activity log (`ReportActivity`) on behalf of another `uid`. All write operations require an authenticated, email-verified user (`request.auth.token.email_verified == true`).
2. **PII Isolation**: Email addresses live strictly under `/users/{userId}/private/info` and are readable/writable only by `userId == request.auth.uid` or verified municipal admins. Public report records never store email or phone numbers.
3. **Immutable Audit Fields**: `ticketId`, `authorUid`, and `createdAt` cannot be modified after creation. `createdAt` on create and `updatedAt` on update must match server timestamp `request.time`.
4. **State Machine Integrity**: Reports start with `status == 'submitted'` and `upvotesCount == 0`. Status transitions must advance cleanly (`submitted -> acknowledged -> in_progress -> resolved`) unless overridden by a verified municipal admin. Once `status == 'resolved'`, non-admin edits are locked.
5. **Atomic Vote Coupling**: Creating a `/reports/{reportId}/votes/{voterId}` document requires atomically incrementing the parent report's `upvotesCount` by exactly `1` in the same Firestore batch.
6. **Master Gate Enforcement**: Subcollections (`votes`, `activity`) verify parent report existence via `exists()` and `get()` before permitting writes.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Spoofed Author UID**: Creating `/reports/rep1` with `authorUid: "other_user_uid"`. Expected: `PERMISSION_DENIED`.
2. **Shadow Field Injection**: Creating `/reports/rep1` with an extra unlisted field `isVerifiedOfficial: true`. Expected: `PERMISSION_DENIED`.
3. **Initial Status Bypass**: Creating `/reports/rep1` with `status: "resolved"` and `upvotesCount: 500`. Expected: `PERMISSION_DENIED`.
4. **Client Timestamp Forgery**: Creating `/reports/rep1` with a backdated client `createdAt` not equal to `request.time`. Expected: `PERMISSION_DENIED`.
5. **Unverified Email Write**: Attempting to create `/reports/rep1` with `email_verified: false`. Expected: `PERMISSION_DENIED`.
6. **Resource Poisoning (Oversized ID / String)**: Writing `/reports/<150-char-id>` or a `description` exceeding 2000 characters. Expected: `PERMISSION_DENIED`.
7. **Unauthorized Status Mutation**: A non-author, non-admin citizen updating `status` on another user's report. Expected: `PERMISSION_DENIED`.
8. **Terminal State Tampering**: A non-admin author attempting to edit `description` or reopen a report whose `status` is already `'resolved'`. Expected: `PERMISSION_DENIED`.
9. **State Shortcutting**: Jumping directly from `'submitted'` to `'resolved'` as a non-admin user. Expected: `PERMISSION_DENIED`.
10. **PII Snooping**: An authenticated citizen attempting `get` on `/users/{otherUid}/private/info`. Expected: `PERMISSION_DENIED`.
11. **Unlinked Vote Inflation**: Incrementing `upvotesCount` on `/reports/rep1` without atomically creating `/reports/rep1/votes/{uid}`. Expected: `PERMISSION_DENIED`.
12. **Privilege Escalation**: Writing directly to `/admins/{myUid}` or adding a `role` field to `/users/{myUid}`. Expected: `PERMISSION_DENIED`.
