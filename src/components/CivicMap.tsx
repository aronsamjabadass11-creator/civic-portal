import React, { useCallback, useEffect, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  MapMouseEvent,
  Pin,
  useAdvancedMarkerRef,
  useApiIsLoaded,
  useApiLoadingStatus,
  APILoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Crosshair, MapPin, Search, X } from 'lucide-react';
import { AgeMode, CivicReport, ReportStatus } from '../types/civic';
import { TranslationBundle } from '../i18n/translations';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';

interface CivicMapProps {
  reports: CivicReport[];
  selectedReport: CivicReport | null;
  onSelectReport: (report: CivicReport | null) => void;
  draftCoords: { lat: number; lng: number };
  onPickLocation: (lat: number, lng: number, resolvedAddress?: string) => void;
  ageMode: AgeMode;
  t: TranslationBundle;
  hasMapsKey: boolean;
}

const STATUS_PIN_COLORS: Record<ReportStatus, { bg: string; border: string; glyph: string }> = {
  submitted: { bg: '#E2A63B', border: '#9A6B16', glyph: '#1C2B39' },
  acknowledged: { bg: '#2F5D8A', border: '#1B3B59', glyph: '#FFFFFF' },
  in_progress: { bg: '#1C2B39', border: '#0F1820', glyph: '#FFFFFF' },
  resolved: { bg: '#3F7D58', border: '#275238', glyph: '#FFFFFF' },
};

interface ReportMarkerProps {
  report: CivicReport;
  isSelected: boolean;
  onSelect: (report: CivicReport, marker: google.maps.marker.AdvancedMarkerElement) => void;
}

const ReportMarkerItem: React.FC<ReportMarkerProps> = ({ report, isSelected, onSelect }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const colors = STATUS_PIN_COLORS[report.status];

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{ lat: report.lat, lng: report.lng }}
      zIndex={isSelected ? 1000 : 10}
      title={`${report.ticketId} — ${report.title}`}
      onClick={() => {
        if (marker) {
          onSelect(report, marker);
        }
      }}
    >
      <Pin
        background={colors.bg}
        borderColor={colors.border}
        glyphColor={colors.glyph}
        scale={isSelected ? 1.2 : 1}
      />
    </AdvancedMarker>
  );
};

export const CivicMap: React.FC<CivicMapProps> = ({
  reports,
  selectedReport,
  onSelectReport,
  draftCoords,
  onPickLocation,
  ageMode,
  t,
  hasMapsKey,
}) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const isLoaded = useApiIsLoaded();
  const loadingStatus = useApiLoadingStatus();

  const [activeMarker, setActiveMarker] = useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [searchText, setSearchText] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { suggestions, resetSession } = useAutocompleteSuggestions(searchText);

  useEffect(() => {
    if (selectedReport && map) {
      map.panTo({ lat: selectedReport.lat, lng: selectedReport.lng });
      if ((map.getZoom() ?? 12) < 14) {
        map.setZoom(15);
      }
    }
  }, [selectedReport, map]);

  useEffect(() => {
    if (loadingStatus === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }, [loadingStatus]);

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      const latLng = ev.detail.latLng;
      if (latLng) {
        onPickLocation(latLng.lat, latLng.lng);
      }
    },
    [onPickLocation]
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
        });
        const loc = place.location;
        if (loc) {
          const lat = loc.lat();
          const lng = loc.lng();
          const label = place.formattedAddress || place.displayName || suggestion.placePrediction.text.text;
          onPickLocation(lat, lng, label);
          if (map) {
            map.panTo({ lat, lng });
            map.setZoom(15);
          }
        }
        setSearchText(suggestion.placePrediction.text.text);
        setShowSuggestions(false);
        resetSession();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      }
    },
    [placesLib, onPickLocation, map, resetSession]
  );

  const recenterToDraft = () => {
    if (map) {
      map.panTo(draftCoords);
      map.setZoom(15);
    }
  };

  return (
    <div className="bg-white border border-[#D8D3C8] rounded-xl overflow-hidden flex flex-col h-full">
      {/* Map Header & Places Search */}
      <div className="p-4 border-b border-[#E6E2D8] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={`font-semibold text-[#1C2B39] ${ageMode === 'senior' ? 'text-xl' : 'text-base'}`}>
              {t.mapTitle}
            </h2>
            <p className={`text-[#6B7280] ${ageMode === 'senior' ? 'text-base' : 'text-xs'}`}>
              {t.mapSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={recenterToDraft}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1C2B39] bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg hover:bg-[#EDE9DF] transition-colors whitespace-nowrap shrink-0"
          >
            <Crosshair className="w-3.5 h-3.5 text-[#2F5D8A]" />
            <span>{draftCoords.lat.toFixed(4)}, {draftCoords.lng.toFixed(4)}</span>
          </button>
        </div>

        {/* Modern Places Autocomplete Search */}
        {hasMapsKey && (
          <div className="relative">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-[#6B7280] absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={searchText}
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setShowSuggestions(true);
                }}
                placeholder={t.searchPlacePlaceholder}
                className={`w-full pl-9 pr-9 bg-[#F7F5F0] border border-[#D8D3C8] rounded-lg text-[#1C2B39] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#2F5D8A] ${
                  ageMode === 'senior' ? 'py-3 text-base' : 'py-2 text-sm'
                }`}
              />
              {searchText && (
                <button
                  type="button"
                  aria-label={t.close}
                  onClick={() => {
                    setSearchText('');
                    resetSession();
                  }}
                  className="absolute right-2.5 p-1 text-[#6B7280] hover:text-[#1C2B39]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#D8D3C8] rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-[#F0ECE1]">
                {suggestions.map((suggestion, idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => void handleSelectSuggestion(suggestion)}
                      className="w-full text-left px-3.5 py-2.5 text-sm text-[#1C2B39] hover:bg-[#F7F5F0] flex items-start gap-2.5 transition-colors"
                    >
                      <MapPin className="w-4 h-4 text-[#2F5D8A] shrink-0 mt-0.5" />
                      <span>{suggestion.placePrediction?.text.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Explicit Height Map Viewport (prevents CF2 collapse) */}
      <div className="relative w-full h-[460px] lg:flex-1 lg:min-h-[500px] bg-[#EDE9DF]">
        {!hasMapsKey ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-2">
            <MapPin className="w-8 h-8 text-[#2F5D8A]" />
            <p className="text-sm font-medium text-[#1C2B39]">{t.mapMissingKey}</p>
            <p className="font-mono text-xs text-[#6B7280]">
              {draftCoords.lat.toFixed(5)}, {draftCoords.lng.toFixed(5)}
            </p>
          </div>
        ) : !isLoaded && loadingStatus !== APILoadingStatus.FAILED ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#6B7280]">
            {t.loadingReports}
          </div>
        ) : (
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={draftCoords}
            defaultZoom={13}
            gestureHandling="greedy"
            onClick={handleMapClick}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
          >
            {/* Draft Report Location Pin */}
            <AdvancedMarker position={draftCoords} zIndex={500} title={t.locationLabel}>
              <div className="flex flex-col items-center">
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-[#1C2B39] text-white rounded shadow-sm mb-1 whitespace-nowrap">
                  New Pin
                </span>
                <div className="w-5 h-5 rounded-full bg-[#2F5D8A] border-2 border-white shadow-md" />
              </div>
            </AdvancedMarker>

            {/* Live Civic Report Markers */}
            {reports.map((report) => (
              <ReportMarkerItem
                key={report.id}
                report={report}
                isSelected={selectedReport?.id === report.id}
                onSelect={(rep, marker) => {
                  onSelectReport(rep);
                  setActiveMarker(marker);
                }}
              />
            ))}

            {/* Anchored InfoWindow */}
            {selectedReport && activeMarker && (
              <InfoWindow
                anchor={activeMarker}
                onCloseClick={() => {
                  onSelectReport(null);
                  setActiveMarker(null);
                }}
              >
                <div className="max-w-[260px] p-1 text-[#1C2B39] space-y-1.5">
                  <div className="font-mono text-xs font-semibold text-[#2F5D8A]">
                    {selectedReport.ticketId}
                  </div>
                  <div className="text-sm font-semibold leading-snug">{selectedReport.title}</div>
                  <div className="text-xs text-[#6B7280]">
                    {t.categories[selectedReport.category]} · {selectedReport.department}
                  </div>
                  <div className="text-xs font-medium">
                    {t.statuses[selectedReport.status]} · {selectedReport.incidentLocation}
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        )}
      </div>

      {/* Color + Text Legend (never hue-only) */}
      <div className="px-4 py-2.5 bg-[#F7F5F0] border-t border-[#E6E2D8] flex flex-wrap items-center justify-between gap-3 text-xs text-[#1C2B39]">
        <div className="flex flex-wrap items-center gap-4">
          {(['submitted', 'acknowledged', 'in_progress', 'resolved'] as ReportStatus[]).map((st) => (
            <span key={st} className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block border border-black/15"
                style={{ backgroundColor: STATUS_PIN_COLORS[st].bg }}
                aria-hidden="true"
              />
              <span>{t.statuses[st]}</span>
            </span>
          ))}
        </div>
        <span className="text-[#6B7280]">{t.clickMapHint}</span>
      </div>
    </div>
  );
};
