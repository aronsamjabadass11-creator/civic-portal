import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  Search,
  ThumbsUp,
  Wrench,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  AgeMode,
  CivicReport,
  ReportActivityItem,
  ReportStatus,
} from '../types/civic';
import { TranslationBundle } from '../i18n/translations';
import { getNextStatus, sanitizeString } from '../utils/triage';

interface ReportTrackerProps {
  reports: CivicReport[];
  loading: boolean;
  user: User | null;
  isAdmin: boolean;
  ageMode: AgeMode;
  t: TranslationBundle;
  onLocateReport: (report: CivicReport) => void;
  onSignInClick: () => void;
  onBroadcastUpdate: (
    type: 'report:status_updated' | 'report:upvoted',
    reportId: string,
    ticketId: string,
    status?: string
  ) => void;
  onJumpToReportForm: () => void;
}

function StatusLabel({ status, label }: { status: ReportStatus; label: string }) {
  switch (status) {
    case 'submitted':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9A6B16]">
          <Clock className="w-3.5 h-3.5 text-[#E2A63B]" />
          <span>{label}</span>
        </span>
      );
    case 'acknowledged':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2F5D8A]">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#2F5D8A]" />
          <span>{label}</span>
        </span>
      );
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1C2B39]">
          <Wrench className="w-3.5 h-3.5 text-[#1C2B39]" />
          <span>{label}</span>
        </span>
      );
    case 'resolved':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#3F7D58]">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#3F7D58]" />
          <span>{label}</span>
        </span>
      );
  }
}

export const ReportTracker: React.FC<ReportTrackerProps> = ({
  reports,
  loading,
  user,
  isAdmin,
  ageMode,
  t,
  onLocateReport,
  onSignInClick,
  onBroadcastUpdate,
  onJumpToReportForm,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all');
  const [votedIds, setVotedIds] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [timelineReport, setTimelineReport] = useState<CivicReport | null>(null);
  const [activities, setActivities] = useState<ReportActivityItem[]>([]);

  // Check which visible reports the current user already confirmed
  useEffect(() => {
    if (!user || reports.length === 0) {
      setVotedIds({});
      return;
    }
    let cancelled = false;
    const checkVotes = async () => {
      const results: Record<string, boolean> = {};
      await Promise.all(
        reports.slice(0, 30).map(async (r) => {
          try {
            const snap = await getDoc(doc(db, 'reports', r.id, 'votes', user.uid));
            if (snap.exists()) {
              results[r.id] = true;
            }
          } catch {
            // Ignore unreadable check
          }
        })
      );
      if (!cancelled) {
        setVotedIds(results);
      }
    };
    void checkVotes();
    return () => {
      cancelled = true;
    };
  }, [user, reports]);

  // Real-time listener for audit timeline modal
  useEffect(() => {
    if (!timelineReport) {
      setActivities([]);
      return;
    }
    const actPath = `reports/${timelineReport.id}/activity`;
    const q = query(
      collection(db, 'reports', timelineReport.id, 'activity'),
      where('isReportPublic', '==', true)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ReportActivityItem[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            reportId: String(data.reportId || timelineReport.id),
            actorUid: String(data.actorUid || ''),
            actorName: String(data.actorName || 'Citizen'),
            fromStatus: data.fromStatus || 'none',
            toStatus: data.toStatus || 'submitted',
            note: String(data.note || ''),
            isReportPublic: Boolean(data.isReportPublic),
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          };
        });
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setActivities(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, actPath);
      }
    );

    return () => unsub();
  }, [timelineReport]);

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reports.filter((rep) => {
      if (statusFilter !== 'all' && rep.status !== statusFilter) return false;
      if (!q) return true;
      return (
        rep.ticketId.toLowerCase().includes(q) ||
        rep.title.toLowerCase().includes(q) ||
        rep.incidentLocation.toLowerCase().includes(q) ||
        rep.department.toLowerCase().includes(q)
      );
    });
  }, [reports, searchQuery, statusFilter]);

  const handleConfirmIssue = async (report: CivicReport) => {
    if (!user) {
      onSignInClick();
      return;
    }
    if (votedIds[report.id] || report.status === 'resolved') return;

    setBusyId(report.id);
    try {
      const batch = writeBatch(db);
      const reportRef = doc(db, 'reports', report.id);
      const voteRef = doc(db, 'reports', report.id, 'votes', user.uid);

      batch.set(voteRef, {
        reportId: report.id,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });

      batch.update(reportRef, {
        upvotesCount: report.upvotesCount + 1,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setVotedIds((prev) => ({ ...prev, [report.id]: true }));
      onBroadcastUpdate('report:upvoted', report.id, report.ticketId);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `reports/${report.id}/votes/${user.uid}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleAdvanceStatus = async (report: CivicReport) => {
    if (!user) {
      onSignInClick();
      return;
    }
    const next = getNextStatus(report.status);
    if (!next) return;

    setBusyId(report.id);
    const actorName = sanitizeString(user.displayName || user.email?.split('@')[0] || 'Citizen', 80);

    try {
      const batch = writeBatch(db);
      const reportRef = doc(db, 'reports', report.id);
      const activityRef = doc(collection(db, 'reports', report.id, 'activity'));

      batch.update(reportRef, {
        status: next,
        updatedAt: serverTimestamp(),
      });

      batch.set(activityRef, {
        reportId: report.id,
        actorUid: user.uid,
        actorName,
        fromStatus: report.status,
        toStatus: next,
        note: `Status updated from ${report.status} to ${next}`,
        isReportPublic: report.isPublic,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      onBroadcastUpdate('report:status_updated', report.id, report.ticketId, next);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `reports/${report.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const isSenior = ageMode === 'senior';

  return (
    <section id="track-tickets" className="bg-white border border-[#D8D3C8] rounded-xl p-5 md:p-6 space-y-5">
      {/* Header & Search */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className={isSenior ? 'text-2xl font-bold text-[#1C2B39]' : 'text-lg font-semibold text-[#1C2B39]'}>
            {t.trackerTitle}
          </h2>
          <p className={`text-[#6B7280] ${isSenior ? 'text-base' : 'text-sm'}`}>
            {t.trackerSubtitle}
          </p>
        </div>

        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchTicketsPlaceholder}
            className={`w-full pl-9 pr-3.5 bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg text-[#1C2B39] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#2F5D8A] ${
              isSenior ? 'py-3 text-base' : 'py-2 text-sm'
            }`}
          />
        </div>
      </div>

      {/* Status Segmented Filter */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg w-fit">
        {(['all', 'submitted', 'acknowledged', 'in_progress', 'resolved'] as const).map((st) => {
          const active = statusFilter === st;
          return (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                isSenior ? 'text-sm min-h-[40px]' : 'text-xs'
              } ${
                active
                  ? 'bg-white text-[#1C2B39] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#1C2B39]'
              }`}
            >
              {st === 'all' ? t.filterAll : t.statuses[st]}
            </button>
          );
        })}
      </div>

      {/* States: Loading / Empty / Populated */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-20 bg-[#F7F5F0] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="py-12 px-4 text-center bg-[#F7F5F0] border border-[#E6E2D8] rounded-lg space-y-3">
          <p className="text-sm text-[#6B7280]">{t.emptyReports}</p>
          <button
            type="button"
            onClick={onJumpToReportForm}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#2F5D8A] rounded-lg hover:bg-[#244A6E] transition-colors"
          >
            {t.emptyReportsCta}
          </button>
        </div>
      ) : (
        <div className="divide-y divide-[#E6E2D8] border border-[#E6E2D8] rounded-lg overflow-hidden">
          {filteredReports.map((report) => {
            const canAdvance =
              report.status !== 'resolved' &&
              Boolean(user && (isAdmin || report.authorUid === user.uid));
            const hasVoted = Boolean(votedIds[report.id]);

            return (
              <div
                key={report.id}
                className="p-4 md:p-5 bg-white hover:bg-[#FAF9F6] transition-colors flex flex-col md:flex-row md:items-center md:justify-between gap-4"
              >
                <div className="flex items-start gap-4 min-w-0">
                  {report.photoUrl && (
                    <img
                      src={report.photoUrl}
                      alt={report.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-lg object-cover border border-[#D8D3C8] shrink-0"
                    />
                  )}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="font-mono text-xs font-semibold text-[#2F5D8A]">
                        {report.ticketId}
                      </span>
                      <span aria-hidden="true" className="text-[#D8D3C8]">·</span>
                      <StatusLabel status={report.status} label={t.statuses[report.status]} />
                      <span aria-hidden="true" className="text-[#D8D3C8]">·</span>
                      <span className="text-xs text-[#6B7280]">
                        {t.priorities[report.priority]}
                      </span>
                    </div>

                    <h3 className={`font-semibold text-[#1C2B39] truncate ${isSenior ? 'text-lg' : 'text-base'}`}>
                      {report.title}
                    </h3>

                    <p className={`text-[#6B7280] line-clamp-2 ${isSenior ? 'text-base' : 'text-sm'}`}>
                      {report.description}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6B7280]">
                      <span>{t.categories[report.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{report.department}</span>
                      <span aria-hidden="true">·</span>
                      <span>{report.incidentLocation}</span>
                      <span aria-hidden="true">·</span>
                      <span>{report.createdAt.toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === report.id || hasVoted || report.status === 'resolved'}
                    onClick={() => void handleConfirmIssue(report)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      hasVoted
                        ? 'bg-[#EAF4EE] border-[#3F7D58]/30 text-[#3F7D58]'
                        : 'bg-[#F7F5F0] border-[#D8D3C8] text-[#1C2B39] hover:bg-[#EDE9DF]'
                    } disabled:opacity-70`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>{hasVoted ? t.confirmedIssue : t.confirmIssue}</span>
                    <span className="font-mono font-semibold">({report.upvotesCount})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onLocateReport(report)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8D3C8] bg-[#F7F5F0] hover:bg-[#EDE9DF] text-xs font-medium text-[#1C2B39] transition-colors whitespace-nowrap shrink-0"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#2F5D8A]" />
                    <span>{t.viewOnMap}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTimelineReport(report)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8D3C8] bg-[#F7F5F0] hover:bg-[#EDE9DF] text-xs font-medium text-[#1C2B39] transition-colors whitespace-nowrap shrink-0"
                  >
                    <History className="w-3.5 h-3.5 text-[#6B7280]" />
                    <span>{t.viewTimeline}</span>
                  </button>

                  {canAdvance && (
                    <button
                      type="button"
                      disabled={busyId === report.id}
                      onClick={() => void handleAdvanceStatus(report)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2F5D8A] hover:bg-[#244A6E] text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                    >
                      <span>{t.advanceStatus}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Audit Timeline Modal */}
      {timelineReport && (
        <div
          className="fixed inset-0 z-50 bg-[#1C2B39]/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-[#D8D3C8] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E6E2D8]">
              <div>
                <div className="font-mono text-xs font-semibold text-[#2F5D8A]">
                  {timelineReport.ticketId}
                </div>
                <h3 className="text-base font-semibold text-[#1C2B39]">
                  {t.timelineTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTimelineReport(null)}
                aria-label={t.close}
                className="p-1.5 rounded-lg text-[#6B7280] hover:bg-[#F7F5F0] hover:text-[#1C2B39]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto">
              {activities.length === 0 ? (
                <p className="text-sm text-[#6B7280]">{t.loadingReports}</p>
              ) : (
                activities.map((act) => (
                  <div
                    key={act.id}
                    className="p-3 rounded-lg bg-[#F7F5F0] border border-[#E6E2D8] space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <StatusLabel status={act.toStatus} label={t.statuses[act.toStatus]} />
                      <span className="font-mono text-[#6B7280]">
                        {act.createdAt.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-[#1C2B39]">{act.note}</p>
                    <p className="text-xs text-[#6B7280]">{act.actorName}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
