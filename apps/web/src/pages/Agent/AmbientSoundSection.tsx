import { useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';

type AmbientSoundType = 'NONE' | 'OFFICE' | 'CAFE' | 'RESTAURANT' | 'CITY' | 'PEOPLE_TALKING';

const AMBIENT_OPTIONS: { value: AmbientSoundType; label: string; previewKey?: string }[] = [
  { value: 'NONE', label: 'ללא רעש רקע' },
  { value: 'OFFICE', label: 'משרד', previewKey: 'office' },
  { value: 'CAFE', label: 'בית קפה', previewKey: 'cafe' },
  { value: 'RESTAURANT', label: 'מסעדה', previewKey: 'restaurant' },
  { value: 'CITY', label: 'עירוני', previewKey: 'city' },
  { value: 'PEOPLE_TALKING', label: 'אנשים מדברים (השתמש בזהירות)', previewKey: 'people_talking' },
];

interface AmbientSoundSectionProps {
  agentId: string;
  soundType: AmbientSoundType;
  volume: number;
  onTypeChange: (type: AmbientSoundType) => void;
  onVolumeChange: (volume: number) => void;
}

export default function AmbientSoundSection({
  agentId,
  soundType,
  volume,
  onTypeChange,
  onVolumeChange,
}: AmbientSoundSectionProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const apiBase = import.meta.env.VITE_API_URL || '';

  function stopPreview() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  }

  function playPreview() {
    stopPreview();

    const selected = AMBIENT_OPTIONS.find((o) => o.value === soundType);
    if (!selected?.previewKey) return;

    const tokens = localStorage.getItem('auth_tokens');
    const accessToken = tokens ? JSON.parse(tokens).accessToken : '';

    const audio = new Audio();
    audio.src = `${apiBase}/agents/${agentId}/ambient/preview/${selected.previewKey}`;

    // Axios-intercepted auth doesn't apply to Audio — attach token via fetch + blob URL
    fetch(`${apiBase}/agents/${agentId}/ambient/preview/${selected.previewKey}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        audioRef.current = a;
        a.onended = () => { URL.revokeObjectURL(url); stopPreview(); };
        a.onerror = () => { URL.revokeObjectURL(url); stopPreview(); };
        a.play();
        setIsPlaying(true);
      })
      .catch(() => setIsPlaying(false));
  }

  const volumePct = Math.round(volume * 100 * 10) / 10;
  const canPreview = soundType !== 'NONE';

  return (
    <Card>
      <div className="px-5 pt-4 pb-2">
        <h3 className="font-semibold text-[var(--text-primary)]">רעש רקע</h3>
      </div>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">סוג</label>
          <select
            value={soundType}
            onChange={(e) => { stopPreview(); onTypeChange(e.target.value as AmbientSoundType); }}
            className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
            dir="rtl"
          >
            {AMBIENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {soundType !== 'NONE' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[var(--text-muted)]">{volumePct}%</span>
                <label className="text-sm font-medium text-[var(--text-secondary)]">עוצמת רעש הרקע</label>
              </div>
              <input
                type="range"
                min={0}
                max={0.2}
                step={0.005}
                value={volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
                <span>שקט</span>
                <span>20%</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isPlaying ? (
                <button
                  onClick={stopPreview}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Square className="w-3 h-3" />
                  עצור תצוגה מקדימה
                </button>
              ) : (
                <button
                  onClick={playPreview}
                  disabled={!canPreview}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
                >
                  <Play className="w-3 h-3" />
                  נגן תצוגה מקדימה
                </button>
              )}
              <span className="text-xs text-[var(--text-muted)]">~5 שניות · ambient בלבד</span>
            </div>
          </>
        )}

        <p className="text-xs text-[var(--text-muted)]">
          השינויים חלים על שיחות חדשות בלבד
        </p>
      </CardContent>
    </Card>
  );
}
