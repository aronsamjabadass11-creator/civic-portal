import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Bell,
  Globe,
  LogIn,
  LogOut,
  MapPin,
  Radio,
  Shield,
  Users,
} from 'lucide-react';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from './lib/firebase';
import {
  AgeMode,
  CivicReport,
  IssueCategory,
  LanguageCode,
} from './types/civic';
import { LANGUAGE_OPTIONS, TRANSLATIONS } from './i18n/translations';
import { ROUTING_RULES, sanitizeString } from './utils/triage';
import { CivicMap } from './components/CivicMap';
import { ReportForm } from './components/ReportForm';
import { ReportTracker } from './components/ReportTracker';
import { SocketNotification, useRealtimeSocket } from './hooks/useRealtimeSocket';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const DEFAULT_COORDS = { lat: 37.7749, lng: -122.4194 };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem('civic_lang') as LanguageCode | null;
    return saved && TRANSLATIONS[saved] ? saved : 'en';
  });
  const [ageMode, setAgeMode] = useState<AgeMode>(() => {
    const saved = localStorage.getItem('civic_age_mode') as AgeMode | null;
    return saved && (saved === 'standard' || saved === 'senior' || saved === 'youth')
      ? saved
      : 'standard';
  });

  const [reports, setReports] = useState<CivicReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [selectedReport, setSelectedReport] = useState<CivicReport | null>(null);

  const [draftCoords, setDraftCoords] = useState<{ lat: number; lng: number }>(DEFAULT_COORDS);
  const [draftAddress, setDraftAddress] = useState('');
  const [isLocating, setIsLocating] = useState(false);

  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const reportSectionRef = useRef<HTMLDivElement | null>(null);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);

  const t = TRANSLATIONS[language];

  // Listen for Google Maps quota exceeded event
  useEffect(() => {
    const handler = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Sync <html lang> attribute
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Real-time WebSocket stream for instant cross-session notifications & presence
  const handleSocketEvent = useCallback((ev: SocketNotification) => {
    const actionLabel =
      ev.type === 'report:created'
        ? `${ev.ticketId} reported`
        : ev.type === 'report:status_updated'
        ? `${ev.ticketId} → ${ev.status}`
        : `${ev.ticketId} confirmed`;
    setLiveNotice(actionLabel);
    setTimeout(() => {
      setLiveNotice((curr) => (curr === actionLabel ? null : curr));
    }, 5000);
  }, []);

  const { connected: wsConnected, activeUsers, broadcast } = useRealtimeSocket(handleSocketEvent);

  // Firebase Auth state & user profile synchronization
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setIsAdmin(false);
        return;
      }

      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(userRef);
        const displayName = sanitizeString(
          firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Citizen',
          80
        );

        if (!snap.exists()) {
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            displayName,
            ageMode,
            preferredLang: language,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          const data = snap.data();
          if (data.ageMode === 'standard' || data.ageMode === 'senior' || data.ageMode === 'youth') {
            setAgeMode(data.ageMode);
          }
          if (data.preferredLang && TRANSLATIONS[data.preferredLang as LanguageCode]) {
            setLanguage(data.preferredLang as LanguageCode);
          }
        }

        if (firebaseUser.email) {
          const privRef = doc(db, 'users', firebaseUser.uid, 'private', 'info');
          await setDoc(
            privRef,
            {
              uid: firebaseUser.uid,
              email: firebaseUser.email.slice(0, 160),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        if (firebaseUser.email === 'aron.27062007@gmail.com' && firebaseUser.emailVerified) {
          setIsAdmin(true);
        } else {
          const adminSnap = await getDoc(doc(db, 'admins', firebaseUser.uid));
          setIsAdmin(adminSnap.exists());
        }
      } catch (err) {
        console.warn('Profile sync notice:', err);
      }
    });

    return () => unsub();
  }, []);

  // Real-time Firestore listener for all public civic reports
  useEffect(() => {
    const q = query(
      collection(db, 'reports'),
      where('isPublic', '==', true),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: CivicReport[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ticketId: String(data.ticketId || ''),
            authorUid: String(data.authorUid || ''),
            authorDisplayName: String(data.authorDisplayName || 'Citizen'),
            title: String(data.title || ''),
            description: String(data.description || ''),
            category: data.category || 'pothole',
            department: data.department || 'Roads & PWD',
            priority: data.priority || 'medium',
            status: data.status || 'submitted',
            lat: Number(data.lat || 0),
            lng: Number(data.lng || 0),
            incidentLocation: String(data.incidentLocation || ''),
            photoUrl: String(data.photoUrl || ''),
            isPublic: Boolean(data.isPublic),
            upvotesCount: Number(data.upvotesCount || 0),
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
          };
        });
        items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setReports(items);
        setLoadingReports(false);
      },
      (err) => {
        setLoadingReports(false);
        handleFirestoreError(err, OperationType.LIST, 'reports');
      }
    );

    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      console.error('Google Sign-In failed:', err);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleLanguageChange = async (nextLang: LanguageCode) => {
    setLanguage(nextLang);
    localStorage.setItem('civic_lang', nextLang);
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          preferredLang: nextLang,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore preference sync error
      }
    }
  };

  const handleAgeModeChange = async (nextMode: AgeMode) => {
    setAgeMode(nextMode);
    localStorage.setItem('civic_age_mode', nextMode);
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          ageMode: nextMode,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore preference sync error
      }
    }
  };

  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      try {
        const res = await fetch(
          `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&lang=${encodeURIComponent(language)}`
        );
        if (res.status === 429) {
          setQuotaExceeded(true);
          return;
        }
        const data = (await res.json()) as { formattedAddress?: string };
        if (data.formattedAddress) {
          setDraftAddress(data.formattedAddress);
        }
      } catch {
        setDraftAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    },
    [language]
  );

  const handlePickLocation = useCallback(
    (lat: number, lng: number, resolvedAddress?: string) => {
      setDraftCoords({ lat, lng });
      if (resolvedAddress) {
        setDraftAddress(resolvedAddress);
      } else {
        void reverseGeocode(lat, lng);
      }
    },
    [reverseGeocode]
  );

  const handleLocateUser = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setDraftCoords({ lat, lng });
        void reverseGeocode(lat, lng).finally(() => setIsLocating(false));
      },
      () => {
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const statusCounts = useMemo(() => {
    const counts = { total: reports.length, open: 0, inProgress: 0, resolved: 0 };
    reports.forEach((r) => {
      if (r.status === 'submitted' || r.status === 'acknowledged') counts.open += 1;
      else if (r.status === 'in_progress') counts.inProgress += 1;
      else if (r.status === 'resolved') counts.resolved += 1;
    });
    return counts;
  }, [reports]);

  const mapPanel = MAPS_API_KEY ? (
    <APIProvider
      key={language}
      apiKey={MAPS_API_KEY}
      libraries={['places', 'marker']}
      language={language}
    >
      <CivicMap
        reports={reports}
        selectedReport={selectedReport}
        onSelectReport={setSelectedReport}
        draftCoords={draftCoords}
        onPickLocation={handlePickLocation}
        ageMode={ageMode}
        t={t}
        hasMapsKey={true}
      />
    </APIProvider>
  ) : (
    <div className="bg-white border border-[#D8D3C8] rounded-xl overflow-hidden flex flex-col h-full min-h-[460px] items-center justify-center p-6 text-center space-y-2">
      <MapPin className="w-8 h-8 text-[#2F5D8A]" />
      <p className="text-sm font-medium text-[#1C2B39]">{t.mapMissingKey}</p>
      <p className="font-mono text-xs text-[#6B7280]">
        {draftCoords.lat.toFixed(5)}, {draftCoords.lng.toFixed(5)}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-[#1C2B39] flex flex-col">
      {/* Demo Key Quota Banner (Section 8 Case A) */}
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Strict 3-Zone Top Bar */}
      <header className="bg-white border-b border-[#D8D3C8]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Wordmark */}
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-[#1C2B39] whitespace-nowrap shrink-0"
          >
            {t.brand}
          </a>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#6B7280]">
            <a href="#report-issue" className="hover:text-[#1C2B39] transition-colors whitespace-nowrap shrink-0">
              {t.navReport}
            </a>
            <a href="#live-map" className="hover:text-[#1C2B39] transition-colors whitespace-nowrap shrink-0">
              {t.navMap}
            </a>
            <a href="#track-tickets" className="hover:text-[#1C2B39] transition-colors whitespace-nowrap shrink-0">
              {t.navTrack}
            </a>
            <a href="#departments" className="hover:text-[#1C2B39] transition-colors whitespace-nowrap shrink-0">
              {t.navDepartments}
            </a>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            {user ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#1C2B39] bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg hover:bg-[#EDE9DF] transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 text-[#2F5D8A]" />
                <span>{user.displayName?.split(' ')[0] || t.signedInAs} · {t.signOut}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSignIn()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2F5D8A] rounded-lg hover:bg-[#244A6E] transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{t.signIn}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Accessibility (Age Category), Language & Real-Time Sync Toolbar */}
      <div className="bg-[#EFECE4] border-b border-[#D8D3C8]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Age Category Accessibility Selector */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[#1C2B39]">{t.ageModeLabel}:</span>
              <div className="flex items-center gap-1 p-0.5 bg-white border border-[#D8D3C8] rounded-lg">
                {(['standard', 'senior', 'youth'] as AgeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    title={t.ageModes[mode].hint}
                    onClick={() => void handleAgeModeChange(mode)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      ageMode === mode
                        ? 'bg-[#1C2B39] text-white'
                        : 'text-[#6B7280] hover:text-[#1C2B39]'
                    }`}
                  >
                    {t.ageModes[mode].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Language Selector */}
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-[#2F5D8A]" />
              <label htmlFor="lang-select" className="text-xs font-semibold text-[#1C2B39]">
                {t.languageLabel}:
              </label>
              <select
                id="lang-select"
                value={language}
                onChange={(e) => void handleLanguageChange(e.target.value as LanguageCode)}
                className="bg-white border border-[#D8D3C8] rounded-lg px-2.5 py-1 text-xs font-medium text-[#1C2B39] focus:outline-none focus:ring-2 focus:ring-[#2F5D8A]"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.nativeName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Live WebSocket Sync & Community Presence */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#1C2B39]">
            {isAdmin && (
              <span className="inline-flex items-center gap-1 font-semibold text-[#2F5D8A]">
                <Shield className="w-3.5 h-3.5" />
                <span>{t.adminBadge}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Radio className={`w-3.5 h-3.5 ${wsConnected ? 'text-[#3F7D58]' : 'text-[#E2A63B]'}`} />
              <span>{wsConnected ? t.liveConnected : t.reconnecting}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[#6B7280] font-mono">
              <Users className="w-3.5 h-3.5" />
              <span>{activeUsers} {t.viewersOnline}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Live WebSocket Event Toast */}
      {liveNotice && (
        <div className="max-w-[1360px] w-full mx-auto px-4 sm:px-6 pt-3">
          <div className="px-4 py-2 rounded-lg bg-[#1C2B39] text-white text-xs font-medium inline-flex items-center gap-2">
            <Bell className="w-3.5 h-3.5 text-[#E2A63B]" />
            <span className="font-mono">{liveNotice}</span>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main id="top" className="max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-8 flex-1">
        {/* Functional Left-Aligned Portal Heading + Tabular Summary Strip */}
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 border-b border-[#D8D3C8] pb-6">
          <div className="max-w-2xl space-y-2">
            <h1
              className={`font-bold tracking-tight text-[#1C2B39] [text-wrap:balance] ${
                ageMode === 'senior' ? 'text-3xl md:text-4xl' : 'text-2xl md:text-3xl'
              }`}
            >
              {t.heroTitle}
            </h1>
            <p className={`text-[#6B7280] ${ageMode === 'senior' ? 'text-lg' : 'text-sm md:text-base'}`}>
              {t.heroSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:gap-6 shrink-0">
            <div>
              <div className="font-mono text-xl md:text-2xl font-bold text-[#1C2B39]">
                {statusCounts.total}
              </div>
              <div className="text-xs text-[#6B7280]">{t.filterAll}</div>
            </div>
            <div>
              <div className="font-mono text-xl md:text-2xl font-bold text-[#2F5D8A]">
                {statusCounts.open + statusCounts.inProgress}
              </div>
              <div className="text-xs text-[#6B7280]">{t.statuses.in_progress}</div>
            </div>
            <div>
              <div className="font-mono text-xl md:text-2xl font-bold text-[#3F7D58]">
                {statusCounts.resolved}
              </div>
              <div className="text-xs text-[#6B7280]">{t.statuses.resolved}</div>
            </div>
          </div>
        </section>

        {/* Primary Functional Workspace: Report Form + Live Google Map */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div id="report-issue" ref={reportSectionRef} className="lg:col-span-5">
            <ReportForm
              user={user}
              onSignInClick={() => void handleSignIn()}
              ageMode={ageMode}
              language={language}
              t={t}
              coords={draftCoords}
              address={draftAddress}
              onAddressChange={setDraftAddress}
              onLocateUser={handleLocateUser}
              isLocating={isLocating}
              onReportCreated={(reportId, ticketId, category) => {
                broadcast({
                  type: 'report:created',
                  reportId,
                  ticketId,
                  category,
                  status: 'submitted',
                });
              }}
            />
          </div>

          <div id="live-map" ref={mapSectionRef} className="lg:col-span-7">
            {mapPanel}
          </div>
        </section>

        {/* Live Ticket Registry */}
        <ReportTracker
          reports={reports}
          loading={loadingReports}
          user={user}
          isAdmin={isAdmin}
          ageMode={ageMode}
          t={t}
          onLocateReport={(rep) => {
            setSelectedReport(rep);
            mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          onSignInClick={() => void handleSignIn()}
          onBroadcastUpdate={(type, reportId, ticketId, status) => {
            broadcast({ type, reportId, ticketId, status });
          }}
          onJumpToReportForm={() => {
            reportSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />

        {/* Municipal Department SLA Directory */}
        <section id="departments" className="bg-white border border-[#D8D3C8] rounded-xl p-5 md:p-6 space-y-4">
          <div>
            <h2 className={ageMode === 'senior' ? 'text-xl font-bold text-[#1C2B39]' : 'text-lg font-semibold text-[#1C2B39]'}>
              {t.departmentsTitle}
            </h2>
            <p className="text-sm text-[#6B7280]">{t.departmentsSubtitle}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(Object.keys(ROUTING_RULES) as IssueCategory[]).map((cat) => {
              const rule = ROUTING_RULES[cat];
              return (
                <div
                  key={cat}
                  className="p-4 rounded-lg bg-[#F7F5F0] border border-[#E6E2D8] space-y-1"
                >
                  <div className="text-xs text-[#6B7280]">{t.categories[cat]}</div>
                  <div className="text-sm font-semibold text-[#1C2B39]">{rule.department}</div>
                  <div className="font-mono text-xs text-[#2F5D8A]">
                    {rule.slaHours} {t.hoursLabel} · {t.priorities[rule.defaultPriority]}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Quiet Civic Footer */}
      <footer className="border-t border-[#D8D3C8] bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-[#6B7280]">
          <span>{t.brand} · {new Date().getFullYear()}</span>
          <a
            href="https://cloud.google.com/maps-platform/terms?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#1C2B39] underline"
          >
            Google Maps Platform Terms
          </a>
        </div>
      </footer>
    </div>
  );
}
