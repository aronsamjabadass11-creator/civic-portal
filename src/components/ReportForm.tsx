import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Droplets,
  Lightbulb,
  LocateFixed,
  Navigation,
  ShieldCheck,
  Trash2,
  TrafficCone,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  AgeMode,
  IssueCategory,
  LanguageCode,
  PriorityLevel,
} from '../types/civic';
import { TranslationBundle } from '../i18n/translations';
import {
  detectCategoryFromText,
  generateTicketId,
  ROUTING_RULES,
  sanitizeString,
} from '../utils/triage';

interface ReportFormProps {
  user: User | null;
  onSignInClick: () => void;
  ageMode: AgeMode;
  language: LanguageCode;
  t: TranslationBundle;
  coords: { lat: number; lng: number };
  address: string;
  onAddressChange: (addr: string) => void;
  onLocateUser: () => void;
  isLocating: boolean;
  onReportCreated: (reportId: string, ticketId: string, category: IssueCategory) => void;
}

const CATEGORY_ICONS: Record<IssueCategory, React.ReactNode> = {
  pothole: <Wrench className="w-4 h-4 shrink-0" />,
  garbage: <Trash2 className="w-4 h-4 shrink-0" />,
  streetlight: <Lightbulb className="w-4 h-4 shrink-0" />,
  water: <Droplets className="w-4 h-4 shrink-0" />,
  drainage: <Navigation className="w-4 h-4 shrink-0" />,
  traffic: <TrafficCone className="w-4 h-4 shrink-0" />,
};

export const ReportForm: React.FC<ReportFormProps> = ({
  user,
  onSignInClick,
  ageMode,
  language,
  t,
  coords,
  address,
  onAddressChange,
  onLocateUser,
  isLocating,
  onReportCreated,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IssueCategory>('pothole');
  const [manualOverride, setManualOverride] = useState(false);
  const [priority, setPriority] = useState<PriorityLevel>('high');
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successTicket, setSuccessTicket] = useState<string | null>(null);
  const [guidedStep, setGuidedStep] = useState<1 | 2 | 3>(1);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Auto-detect category as user types unless manually overridden
  useEffect(() => {
    if (manualOverride) return;
    const detected = detectCategoryFromText(`${title} ${description}`);
    if (detected) {
      setCategory(detected);
      setPriority(ROUTING_RULES[detected].defaultPriority);
    }
  }, [title, description, manualOverride]);

  const routingRule = ROUTING_RULES[category];

  const handleToggleSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(
      `${t.spokenWelcome} ${t.routingLabel}: ${routingRule.department}.`
    );
    utterance.lang = language === 'hi' ? 'hi-IN' : language === 'ta' ? 'ta-IN' : language;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setUploadingPhoto(true);

    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      setPhotoPreview(dataUrl);

      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Upload failed');
      }
      const data = (await res.json()) as { url: string };
      setPhotoUrl(data.url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to upload image.');
      setPhotoPreview('');
      setPhotoUrl('');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessTicket(null);

    if (!user) {
      onSignInClick();
      return;
    }

    const cleanTitle = sanitizeString(title, 140);
    const cleanDesc = sanitizeString(description, 2000);
    const cleanLocation = sanitizeString(
      address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      260
    );

    if (cleanTitle.length < 3 || cleanDesc.length < 5 || cleanLocation.length < 2) {
      setErrorMsg(t.validationError);
      return;
    }

    setSubmitting(true);
    const ticketId = generateTicketId();
    const actorName = sanitizeString(user.displayName || user.email?.split('@')[0] || 'Citizen', 80);

    try {
      const reportRef = doc(collection(db, 'reports'));
      const activityRef = doc(collection(db, 'reports', reportRef.id, 'activity'));
      const batch = writeBatch(db);

      batch.set(reportRef, {
        ticketId,
        authorUid: user.uid,
        authorDisplayName: actorName,
        title: cleanTitle,
        description: cleanDesc,
        category,
        department: routingRule.department,
        priority,
        status: 'submitted',
        lat: Number(coords.lat.toFixed(6)),
        lng: Number(coords.lng.toFixed(6)),
        incidentLocation: cleanLocation,
        photoUrl: photoUrl.slice(0, 500),
        isPublic: true,
        upvotesCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(activityRef, {
        reportId: reportRef.id,
        actorUid: user.uid,
        actorName,
        fromStatus: 'none',
        toStatus: 'submitted',
        note: `Routed automatically to ${routingRule.department}`,
        isReportPublic: true,
        createdAt: serverTimestamp(),
      });

      await batch.commit();

      setTitle('');
      setDescription('');
      setManualOverride(false);
      setPhotoPreview('');
      setPhotoUrl('');
      setGuidedStep(1);
      setSuccessTicket(ticketId);
      onReportCreated(reportRef.id, ticketId, category);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'reports');
    } finally {
      setSubmitting(false);
    }
  };

  const isSenior = ageMode === 'senior';
  const isYouth = ageMode === 'youth';

  const labelClass = isSenior
    ? 'block text-base font-semibold text-[#1C2B39] mb-2'
    : 'block text-sm font-medium text-[#1C2B39] mb-1.5';

  const inputClass = isSenior
    ? 'w-full px-4 py-3.5 text-lg bg-[#F7F5F0] border-2 border-[#1C2B39] rounded-lg text-[#1C2B39] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#2F5D8A]'
    : 'w-full px-3.5 py-2.5 text-sm bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg text-[#1C2B39] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#2F5D8A]';

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className={`bg-white rounded-xl p-5 md:p-6 space-y-5 ${
        isSenior ? 'border-2 border-[#1C2B39]' : 'border border-[#D8D3C8]'
      }`}
    >
      {/* Header + Voice Assist */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E6E2D8]">
        <h2 className={isSenior ? 'text-xl font-bold text-[#1C2B39]' : 'text-lg font-semibold text-[#1C2B39]'}>
          {t.reportFormTitle}
        </h2>
        <button
          type="button"
          onClick={handleToggleSpeech}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8D3C8] bg-[#F7F5F0] hover:bg-[#EDE9DF] text-[#1C2B39] font-medium transition-colors whitespace-nowrap shrink-0 ${
            isSenior ? 'text-sm min-h-[44px]' : 'text-xs'
          }`}
        >
          {isSpeaking ? <VolumeX className="w-4 h-4 text-[#2F5D8A]" /> : <Volume2 className="w-4 h-4 text-[#2F5D8A]" />}
          <span>{isSpeaking ? t.stopReading : t.readAloud}</span>
        </button>
      </div>

      {/* Youth Guided Stepper */}
      {isYouth && (
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as const).map((step) => {
            const stepLabel = step === 1 ? t.step1Title : step === 2 ? t.step2Title : t.step3Title;
            return (
              <button
                key={step}
                type="button"
                onClick={() => setGuidedStep(step)}
                className={`px-2.5 py-2 rounded-lg text-xs font-semibold text-left border transition-colors ${
                  guidedStep === step
                    ? 'bg-[#2F5D8A] text-white border-[#2F5D8A]'
                    : 'bg-[#F7F5F0] text-[#1C2B39] border-[#D8D3C8] hover:bg-[#EDE9DF]'
                }`}
              >
                {stepLabel}
              </button>
            );
          })}
        </div>
      )}

      {/* Feedback Alerts */}
      {successTicket && (
        <div className="p-3.5 rounded-lg bg-[#EAF4EE] border border-[#3F7D58]/30 text-[#1C2B39] flex items-start gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-[#3F7D58] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="text-sm font-semibold">{t.submissionSuccess}</div>
            <div className="font-mono text-xs font-medium text-[#3F7D58]">{successTicket}</div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-[#FEF3C7] border border-[#E2A63B]/50 text-[#1C2B39] flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" />
          <span className={isSenior ? 'text-base' : 'text-sm'}>{errorMsg}</span>
        </div>
      )}

      {/* STEP 1: Summary, Description, Category, Priority */}
      {(!isYouth || guidedStep === 1) && (
        <div className="space-y-4">
          <div>
            <label htmlFor="report-title" className={labelClass}>
              {t.titleLabel}
            </label>
            <input
              id="report-title"
              type="text"
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.titlePlaceholder}
              className={inputClass}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="report-desc" className={isSenior ? 'text-base font-semibold text-[#1C2B39]' : 'text-sm font-medium text-[#1C2B39]'}>
                {t.descLabel}
              </label>
              {!manualOverride && description.trim().length > 2 && (
                <span className="text-xs text-[#2F5D8A] font-medium">
                  {t.autoDetectedHint}
                </span>
              )}
            </div>
            <textarea
              id="report-desc"
              rows={isSenior ? 4 : 3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.descPlaceholder}
              className={inputClass}
              required
            />
          </div>

          {/* Interactive Category Selector */}
          <div>
            <span className={labelClass}>{t.categoryLabel}</span>
            <div className={`grid gap-2 ${isYouth || isSenior ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
              {(Object.keys(ROUTING_RULES) as IssueCategory[]).map((cat) => {
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setCategory(cat);
                      setManualOverride(true);
                    }}
                    className={`flex items-center gap-2 px-3 rounded-lg border text-left transition-colors ${
                      isSenior ? 'py-3.5 text-base font-semibold min-h-[48px]' : 'py-2 text-xs font-medium'
                    } ${
                      active
                        ? 'bg-[#2F5D8A] text-white border-[#2F5D8A]'
                        : 'bg-[#F7F5F0] text-[#1C2B39] border-[#D8D3C8] hover:bg-[#EDE9DF]'
                    }`}
                  >
                    {CATEGORY_ICONS[cat]}
                    <span className="truncate">{t.categories[cat]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority Segmented Control */}
          <div>
            <span className={labelClass}>{t.priorityLabel}</span>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg">
              {(['low', 'medium', 'high', 'urgent'] as PriorityLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setPriority(lvl)}
                  className={`rounded-md font-medium transition-colors whitespace-nowrap ${
                    isSenior ? 'py-2.5 text-sm' : 'py-1.5 text-xs'
                  } ${
                    priority === lvl
                      ? 'bg-[#1C2B39] text-white'
                      : 'text-[#6B7280] hover:text-[#1C2B39]'
                  }`}
                >
                  {t.priorities[lvl]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Location & GPS */}
      {(!isYouth || guidedStep === 2) && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="report-location" className={isSenior ? 'text-base font-semibold text-[#1C2B39]' : 'text-sm font-medium text-[#1C2B39]'}>
              {t.locationLabel}
            </label>
            <button
              type="button"
              onClick={onLocateUser}
              disabled={isLocating}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2F5D8A]/10 text-[#2F5D8A] hover:bg-[#2F5D8A]/20 font-medium transition-colors whitespace-nowrap shrink-0 ${
                isSenior ? 'text-sm min-h-[44px]' : 'text-xs'
              }`}
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span>{isLocating ? t.locating : t.useMyLocation}</span>
            </button>
          </div>
          <input
            id="report-location"
            type="text"
            maxLength={260}
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder={t.locationPlaceholder}
            className={inputClass}
          />
          <div className="font-mono text-xs text-[#6B7280]">
            GPS: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </div>
        </div>
      )}

      {/* STEP 3: Photo & Live Auto-Routing Result */}
      {(!isYouth || guidedStep === 3) && (
        <div className="space-y-4">
          {/* Photo Evidence Upload */}
          <div>
            <span className={labelClass}>{t.photoLabel}</span>
            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`inline-flex items-center gap-2 px-4 rounded-lg border border-[#D8D3C8] bg-[#F7F5F0] hover:bg-[#EDE9DF] text-[#1C2B39] cursor-pointer font-medium transition-colors ${
                  isSenior ? 'py-3 text-base min-h-[48px]' : 'py-2 text-xs'
                }`}
              >
                <Camera className="w-4 h-4 text-[#2F5D8A]" />
                <span>{uploadingPhoto ? '...' : t.uploadPhoto}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => void handlePhotoUpload(e)}
                />
              </label>

              {photoPreview && (
                <div className="flex items-center gap-2.5">
                  <img
                    src={photoPreview}
                    alt="Uploaded evidence preview"
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-lg object-cover border border-[#D8D3C8]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoPreview('');
                      setPhotoUrl('');
                    }}
                    className="text-xs font-medium text-[#6B7280] hover:text-[#1C2B39] underline"
                  >
                    {t.removePhoto}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Live Auto-Routing Result Box (clean hairline border, no border-l-4) */}
          <div className="p-3.5 rounded-lg bg-[#F7F5F0] border border-[#D8D3C8] space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs text-[#6B7280]">
              <span>{t.routingLabel}</span>
              <span className="font-mono">{routingRule.slaHours} {t.hoursLabel}</span>
            </div>
            <div className={`font-semibold text-[#1C2B39] ${isSenior ? 'text-lg' : 'text-sm'}`}>
              {routingRule.department}
            </div>
            <div className="text-xs text-[#6B7280]">
              {t.routingSla}: {routingRule.slaHours}h · {t.priorities[priority]}
            </div>
          </div>
        </div>
      )}

      {/* Guided Stepper Controls OR Submit CTA */}
      {isYouth && guidedStep < 3 ? (
        <div className="flex items-center justify-between gap-3 pt-2">
          {guidedStep > 1 ? (
            <button
              type="button"
              onClick={() => setGuidedStep((s) => (s === 2 ? 1 : 2))}
              className="px-4 py-2.5 text-sm font-medium text-[#1C2B39] bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg hover:bg-[#EDE9DF]"
            >
              {t.prevStep}
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={() => setGuidedStep((s) => (s === 1 ? 2 : 3))}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-[#2F5D8A] rounded-lg hover:bg-[#244A6E] transition-colors"
          >
            {t.nextStep}
          </button>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {isYouth && (
            <button
              type="button"
              onClick={() => setGuidedStep(2)}
              className="text-xs font-medium text-[#6B7280] hover:text-[#1C2B39] underline"
            >
              {t.prevStep}
            </button>
          )}
          {!user && (
            <div className="p-3 rounded-lg bg-[#2F5D8A]/10 border border-[#2F5D8A]/25 text-xs text-[#1C2B39] flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2F5D8A] shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{t.signInPromptTitle}</div>
                <div className="text-[#6B7280] mt-0.5">{t.signInPromptBody}</div>
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || uploadingPhoto}
            className={`w-full rounded-lg font-semibold text-white bg-[#2F5D8A] hover:bg-[#244A6E] disabled:opacity-60 transition-colors ${
              isSenior ? 'py-4 text-lg min-h-[54px]' : 'py-3 text-sm min-h-[44px]'
            }`}
          >
            {submitting
              ? t.submitting
              : user
              ? t.submitReport
              : t.signInToSubmit}
          </button>
        </div>
      )}
    </form>
  );
};
