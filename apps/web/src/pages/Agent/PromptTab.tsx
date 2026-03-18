import { PhoneOutgoing, PhoneIncoming, Save } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

interface PromptTabProps {
  prompt: string;
  setPrompt: (v: string) => void;
  openingMessage: string;
  setOpeningMessage: (v: string) => void;
  inboundPrompt: string;
  setInboundPrompt: (v: string) => void;
  inboundOpeningMessage: string;
  setInboundOpeningMessage: (v: string) => void;
  onSave: () => void;
  isSaving: boolean;
}

export default function PromptTab({
  prompt, setPrompt, openingMessage, setOpeningMessage,
  inboundPrompt, setInboundPrompt, inboundOpeningMessage, setInboundOpeningMessage,
  onSave, isSaving,
}: PromptTabProps) {
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const charCount = prompt.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Outbound */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <PhoneOutgoing className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">שיחות יוצאות</span>
          </div>
          <Card>
            <div className="p-1">
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <span className={`text-xs ${charCount > 7000 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{charCount} / 8000 תווים &bull; {wordCount} מילים</span>
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">System Prompt</h3>
              </div>
              <div className="px-3 pb-3">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={8000}
                  rows={12}
                  className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                  placeholder="כתוב כאן את ההנחיות לסוכן לשיחות יוצאות..."
                  dir="rtl"
                />
              </div>
            </div>
          </Card>
          <Card>
            <div className="p-1">
              <div className="flex items-center justify-between px-5 pt-4 pb-1">
                <span className="text-xs text-[var(--text-muted)]">{openingMessage.length} / 2000</span>
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">הודעת פתיחה</h3>
              </div>
              <div className="px-3 pb-3">
                <textarea
                  value={openingMessage}
                  onChange={(e) => setOpeningMessage(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                  placeholder='לדוגמה: "Introduce yourself and explain why you are calling."'
                  dir="ltr"
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Inbound */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <PhoneIncoming className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">שיחות נכנסות</span>
            <span className="text-xs text-[var(--text-muted)]">(ריק = fallback ליוצאות)</span>
          </div>
          <Card>
            <div className="p-1">
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <span className={`text-xs ${inboundPrompt.length > 7000 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{inboundPrompt.length} / 8000 תווים</span>
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">System Prompt</h3>
              </div>
              <div className="px-3 pb-3">
                <textarea
                  value={inboundPrompt}
                  onChange={(e) => setInboundPrompt(e.target.value)}
                  maxLength={8000}
                  rows={12}
                  className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                  placeholder="אם ריק, ישתמש ב-System Prompt של שיחות יוצאות..."
                  dir="rtl"
                />
              </div>
            </div>
          </Card>
          <Card>
            <div className="p-1">
              <div className="flex items-center justify-between px-5 pt-4 pb-1">
                <span className="text-xs text-[var(--text-muted)]">{inboundOpeningMessage.length} / 2000</span>
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">הודעת פתיחה</h3>
              </div>
              <div className="px-3 pb-3">
                <textarea
                  value={inboundOpeningMessage}
                  onChange={(e) => setInboundOpeningMessage(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                  placeholder='אם ריק, ישתמש בהודעת הפתיחה של שיחות יוצאות...'
                  dir="ltr"
                />
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={isSaving}>
          <Save className="w-4 h-4" />
          {isSaving ? 'שומר...' : 'שמור'}
        </Button>
      </div>
    </div>
  );
}
