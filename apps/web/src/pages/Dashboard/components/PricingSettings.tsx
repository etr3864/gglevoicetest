import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import api from '../../../lib/api';

interface PricingConfig {
  geminiAudioInputPer1M: number;
  geminiAudioOutputPer1M: number;
  geminiTextInputPer1M: number;
  geminiTextOutputPer1M: number;
  geminiSummaryPer1M: number;
  embeddingPer1M: number;
  telnyxCallPerMin: number;
  telnyxRecordingPerMin: number;
  deepgramPerSec: number;
  usdToIls: number;
}

const FIELDS: { key: keyof PricingConfig; label: string; unit: string }[] = [
  { key: 'geminiAudioInputPer1M', label: 'Gemini Audio Input', unit: '$ / 1M tokens' },
  { key: 'geminiAudioOutputPer1M', label: 'Gemini Audio Output', unit: '$ / 1M tokens' },
  { key: 'geminiTextInputPer1M', label: 'Gemini Text Input', unit: '$ / 1M tokens' },
  { key: 'geminiTextOutputPer1M', label: 'Gemini Text Output', unit: '$ / 1M tokens' },
  { key: 'geminiSummaryPer1M', label: 'Gemini Summary (blended)', unit: '$ / 1M tokens' },
  { key: 'embeddingPer1M', label: 'Embedding (Vertex AI)', unit: '$ / 1M tokens' },
  { key: 'telnyxCallPerMin', label: 'Telnyx שיחות', unit: '$ / דקה' },
  { key: 'telnyxRecordingPerMin', label: 'Telnyx הקלטות', unit: '$ / דקה' },
  { key: 'deepgramPerSec', label: 'Deepgram', unit: '$ / שנייה' },
  { key: 'usdToIls', label: 'שער דולר-שקל', unit: '₪ / $' },
];

export function PricingSettings() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['pricing-config'],
    queryFn: () => api.get<{ data: PricingConfig }>('/dashboard/pricing').then((r) => r.data.data),
    enabled: open,
  });

  const [form, setForm] = useState<PricingConfig | null>(null);
  useEffect(() => { if (config) setForm(config); }, [config]);

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (data: PricingConfig) => api.put('/dashboard/pricing', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pricing-config'] });
      queryClient.invalidateQueries({ queryKey: ['super-admin-dashboard'] });
    },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <Settings className="w-4 h-4" />
        הגדרות תמחור
      </button>
    );
  }

  if (isLoading || !form) {
    return (
      <div className="flex items-center gap-2 py-4 text-[var(--text-muted)]">
        <Loader2 className="w-4 h-4 animate-spin" />
        טוען הגדרות...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(false)} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          סגור
        </button>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">הגדרות תמחור</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FIELDS.map(({ key, label, unit }) => (
          <div key={key}>
            <label className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="any"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: parseFloat(e.target.value) || 0 })}
                className="flex-1 px-3 py-1.5 rounded-lg border text-sm border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                dir="ltr"
              />
              <span className="text-xs text-[var(--text-muted)] shrink-0">{unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-start">
        <Button size="sm" onClick={() => save(form)} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שמור'}
        </Button>
      </div>
    </div>
  );
}
