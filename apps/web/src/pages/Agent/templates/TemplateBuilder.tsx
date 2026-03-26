import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Plus, Trash2, Loader2, Upload, ChevronDown, ChevronUp, Code } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useToast } from '../../../components/ui/Toast';
import { cn } from '../../../lib/cn';
import WhatsappPreview from './WhatsappPreview';
import { extractVariables, buildComponents, parseExistingComponents, validate, countErrors } from './utils';
import type { TemplateForm, TemplateButton, ButtonType, HeaderFormat, Category, ExistingTemplate, ValidationErrors } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { value: 'he',    label: 'עברית' },
  { value: 'en_US', label: 'אנגלית (US)' },
];

const CATEGORIES: { value: Category; label: string; desc: string }[] = [
  { value: 'UTILITY',        label: 'שירות', desc: 'עדכונים, תזכורות, אישורים' },
  { value: 'MARKETING',      label: 'שיווק', desc: 'מבצעים, הצעות, תוכן פרסומי' },
  { value: 'AUTHENTICATION', label: 'אימות', desc: 'קודי OTP ואישור זהות' },
];

const HEADER_LABELS: Record<HeaderFormat, string> = {
  NONE: 'ללא', TEXT: 'טקסט', IMAGE: 'תמונה', VIDEO: 'וידאו', DOCUMENT: 'מסמך PDF',
};

const MEDIA_HINTS: Record<string, string> = {
  IMAGE: 'JPEG/PNG עד 5MB', VIDEO: 'MP4 עד 16MB', DOCUMENT: 'PDF עד 100MB',
};

const ACCEPT_BY_FORMAT: Record<string, string> = {
  IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf',
};

const DEFAULT_FORM: TemplateForm = {
  name: '', category: 'UTILITY', language: 'he',
  headerFormat: 'NONE', headerText: '', headerMediaId: '',
  bodyText: '', variableExamples: {},
  footerText: '', buttons: [],
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  agentId: string;
  initialTemplate: ExistingTemplate | null;
  onClose: (submitted: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TemplateBuilder({ agentId, initialTemplate, onClose }: Props) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<TemplateForm>(() => {
    if (!initialTemplate) return DEFAULT_FORM;
    return {
      ...DEFAULT_FORM,
      name: initialTemplate.name,
      category: initialTemplate.category as Category,
      language: initialTemplate.language,
      ...parseExistingComponents(initialTemplate.components),
    };
  });

  const [touched, setTouched]         = useState(false);
  const [showJson, setShowJson]       = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const errors: ValidationErrors = touched ? validate(form) : {};
  const errorCount = countErrors(errors);
  const vars = extractVariables(form.bodyText);

  function update<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  // ─── Variable insertion at cursor ─────────────────────────────────────────

  function insertVariable() {
    const ta = textareaRef.current;
    const nextVar = vars.length > 0 ? Math.max(...vars) + 1 : 1;
    const tag = `{{${nextVar}}}`;

    if (ta) {
      const start = ta.selectionStart ?? form.bodyText.length;
      const end   = ta.selectionEnd   ?? form.bodyText.length;
      update('bodyText', form.bodyText.slice(0, start) + tag + form.bodyText.slice(end));
      setTimeout(() => {
        ta.selectionStart = start + tag.length;
        ta.selectionEnd   = start + tag.length;
        ta.focus();
      }, 0);
    } else {
      update('bodyText', form.bodyText + tag);
    }
  }

  // ─── Media upload ──────────────────────────────────────────────────────────

  async function handleMediaUpload(file: File) {
    setUploadingMedia(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/agents/${agentId}/whatsapp/templates/media`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      update('headerMediaId', res.data.data.mediaId);
      toast('קובץ הועלה בהצלחה', 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'שגיאה בהעלאת קובץ', 'error');
    } finally {
      setUploadingMedia(false);
    }
  }

  // ─── Button helpers ────────────────────────────────────────────────────────

  const addButton = useCallback(() => {
    if (form.buttons.length >= 3) return;
    update('buttons', [...form.buttons, { type: 'QUICK_REPLY' as ButtonType, text: '' }]);
  }, [form.buttons]);

  const removeButton = useCallback((i: number) => {
    update('buttons', form.buttons.filter((_, idx) => idx !== i));
  }, [form.buttons]);

  const updateButton = useCallback((i: number, patch: Partial<TemplateButton>) => {
    update('buttons', form.buttons.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  }, [form.buttons]);

  // ─── Submit ────────────────────────────────────────────────────────────────

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/whatsapp/templates`, {
      name: form.name,
      language: form.language,
      category: form.category,
      components: buildComponents(form),
    }),
    onSuccess: () => {
      toast('התבנית הוגשה לאישור Meta — בדרך כלל 24–72 שעות', 'success');
      onClose(true);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'שגיאה בהגשת התבנית', 'error');
    },
  });

  function handleSubmit() {
    setTouched(true);
    if (countErrors(validate(form)) > 0) return;
    submitMutation.mutate();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {initialTemplate ? 'עריכת תבנית' : 'תבנית חדשה'}
          </h2>
          <button onClick={() => onClose(false)} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">

          {/* Editor */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 border-r border-[var(--border)]" dir="rtl">
            <BasicInfoSection
              form={form} errors={errors}
              onUpdate={update}
              isEditing={!!initialTemplate}
            />
            <hr className="border-[var(--border)]" />
            <HeaderSection
              form={form} errors={errors}
              onUpdate={update}
              onMediaUpload={handleMediaUpload}
              uploadingMedia={uploadingMedia}
              fileInputRef={fileInputRef}
            />
            <hr className="border-[var(--border)]" />
            <BodySection
              form={form} errors={errors} vars={vars}
              onUpdate={update}
              onInsertVariable={insertVariable}
              textareaRef={textareaRef}
            />
            <hr className="border-[var(--border)]" />
            <FooterSection form={form} errors={errors} onUpdate={update} />
            <hr className="border-[var(--border)]" />
            <ButtonsSection
              form={form} errors={errors}
              onAdd={addButton}
              onRemove={removeButton}
              onUpdate={updateButton}
            />
          </div>

          {/* Preview */}
          <div className="w-72 shrink-0 overflow-y-auto p-5 space-y-4" dir="rtl">
            <WhatsappPreview form={form} />
            <JsonPreview form={form} show={showJson} onToggle={() => setShowJson(s => !s)} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] shrink-0">
          <button
            onClick={() => onClose(false)}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            ביטול
          </button>
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending || (touched && errorCount > 0)}
            title={touched && errorCount > 0 ? `יש ${errorCount} בעיות לתיקון` : undefined}
          >
            {submitMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {touched && errorCount > 0
              ? `יש ${errorCount} ${errorCount === 1 ? 'בעיה' : 'בעיות'} לתיקון`
              : 'הגש לאישור Meta'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Section sub-components ───────────────────────────────────────────────────

function BasicInfoSection({
  form, errors, onUpdate, isEditing,
}: {
  form: TemplateForm;
  errors: ValidationErrors;
  onUpdate: <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => void;
  isEditing: boolean;
}) {
  return (
    <section className="space-y-3">
      <div>
        <Input
          label="שם התבנית"
          value={form.name}
          onChange={e => onUpdate('name', e.target.value)}
          placeholder="appointment_reminder"
          dir="ltr"
          disabled={isEditing}
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">רק אותיות קטנות, מספרים ו-_ (לא ניתן לשנות לאחר יצירה)</p>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">קטגוריה</label>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => onUpdate('category', c.value)}
              className={cn(
                'p-2.5 rounded-lg border text-right transition-colors',
                form.category === c.value
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] hover:border-[var(--accent)]/50',
              )}
            >
              <div className="text-xs font-semibold text-[var(--text-primary)]">{c.label}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">שפה</label>
        <select
          value={form.language}
          onChange={e => onUpdate('language', e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
          dir="ltr"
        >
          {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>
    </section>
  );
}

function HeaderSection({
  form, errors, onUpdate, onMediaUpload, uploadingMedia, fileInputRef,
}: {
  form: TemplateForm;
  errors: ValidationErrors;
  onUpdate: <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => void;
  onMediaUpload: (f: File) => void;
  uploadingMedia: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const isMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerFormat);
  return (
    <section className="space-y-3">
      <label className="text-sm font-medium text-[var(--text-primary)]">כותרת (אופציונלי)</label>
      <div className="flex flex-wrap gap-2">
        {(['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as HeaderFormat[]).map(f => (
          <button
            key={f}
            onClick={() => { onUpdate('headerFormat', f); onUpdate('headerMediaId', ''); }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              form.headerFormat === f
                ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50',
            )}
          >
            {HEADER_LABELS[f]}
          </button>
        ))}
      </div>

      {form.headerFormat === 'TEXT' && (
        <div>
          <input
            value={form.headerText}
            onChange={e => onUpdate('headerText', e.target.value)}
            placeholder="כותרת ההודעה"
            maxLength={60}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
          />
          {errors.headerText && <p className="mt-1 text-xs text-red-600">{errors.headerText}</p>}
        </div>
      )}

      {isMedia && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_BY_FORMAT[form.headerFormat] ?? '*'}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onMediaUpload(f); }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingMedia}
            className="flex items-center gap-2 px-4 py-3 w-full rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)]/50 text-sm text-[var(--text-secondary)] transition-colors"
          >
            {uploadingMedia ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploadingMedia ? 'מעלה...' : form.headerMediaId ? 'קובץ הועלה ✓ — לחץ להחלפה' : 'לחץ לבחירת קובץ'}
          </button>
          {errors.headerMedia && <p className="mt-1 text-xs text-red-600">{errors.headerMedia}</p>}
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {(MEDIA_HINTS as Record<string, string>)[form.headerFormat]}
          </p>
        </div>
      )}
    </section>
  );
}

function BodySection({
  form, errors, vars, onUpdate, onInsertVariable, textareaRef,
}: {
  form: TemplateForm;
  errors: ValidationErrors;
  vars: number[];
  onUpdate: <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => void;
  onInsertVariable: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--text-primary)]">תוכן ההודעה *</label>
        <span className={cn('text-xs', form.bodyText.length > 900 ? 'text-red-500 font-medium' : 'text-[var(--text-tertiary)]')}>
          {form.bodyText.length}/1024
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={form.bodyText}
        onChange={e => onUpdate('bodyText', e.target.value)}
        rows={5}
        placeholder="שלום {{1}}, תזכורת לפגישתך ב-{{2}}..."
        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-tertiary)]"
      />
      <button onClick={onInsertVariable} className="text-xs text-[var(--accent)] hover:underline">
        + הוסף משתנה
      </button>
      {errors.body    && <p className="text-xs text-red-600">{errors.body}</p>}
      {errors.bodyVars && <p className="text-xs text-red-600">{errors.bodyVars}</p>}

      {vars.length > 0 && (
        <div className="space-y-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
          <p className="text-xs font-medium text-[var(--text-secondary)]">דוגמאות למשתנים (לצורך אישור Meta)</p>
          {vars.map(n => (
            <div key={n} className="flex items-center gap-2">
              <span className="text-xs font-mono text-[var(--text-secondary)] w-14 shrink-0">{`{{${n}}}`}</span>
              <input
                value={form.variableExamples[n] ?? ''}
                onChange={e => onUpdate('variableExamples', { ...form.variableExamples, [n]: e.target.value })}
                placeholder={`דוגמה ל-{{${n}}}`}
                className={cn(
                  'flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--bg-card)] border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50',
                  errors.examples?.[n] ? 'border-red-400' : 'border-[var(--border)]',
                )}
              />
              {errors.examples?.[n] && <span className="text-xs text-red-600">{errors.examples[n]}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FooterSection({
  form, errors, onUpdate,
}: {
  form: TemplateForm;
  errors: ValidationErrors;
  onUpdate: <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--text-primary)]">כותרת תחתונה (אופציונלי)</label>
        {form.footerText && (
          <span className={cn('text-xs', form.footerText.length > 60 ? 'text-red-500 font-medium' : 'text-[var(--text-tertiary)]')}>
            {form.footerText.length}/60
          </span>
        )}
      </div>
      <input
        value={form.footerText}
        onChange={e => onUpdate('footerText', e.target.value)}
        placeholder="שירות לקוחות"
        maxLength={60}
        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
      />
      {errors.footer && <p className="text-xs text-red-600">{errors.footer}</p>}
    </section>
  );
}

function ButtonsSection({
  form, errors, onAdd, onRemove, onUpdate,
}: {
  form: TemplateForm;
  errors: ValidationErrors;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<TemplateButton>) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--text-primary)]">כפתורים (עד 3, אופציונלי)</label>
        {form.buttons.length < 3 && (
          <button onClick={onAdd} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
            <Plus className="w-3 h-3" /> הוסף כפתור
          </button>
        )}
      </div>

      {errors.buttonMix && <p className="text-xs text-red-600">{errors.buttonMix}</p>}

      <div className="space-y-2">
        {form.buttons.map((btn, i) => (
          <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={btn.type}
                onChange={e => onUpdate(i, { type: e.target.value as ButtonType, url: undefined, phone_number: undefined })}
                className="text-xs px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none"
                dir="ltr"
              >
                <option value="QUICK_REPLY">QUICK_REPLY</option>
                <option value="URL">URL</option>
                <option value="PHONE_NUMBER">PHONE_NUMBER</option>
              </select>
              <input
                value={btn.text}
                onChange={e => onUpdate(i, { text: e.target.value })}
                placeholder="טקסט הכפתור"
                className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50"
              />
              <button onClick={() => onRemove(i)} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {btn.type === 'URL' && (
              <input
                value={btn.url ?? ''}
                onChange={e => onUpdate(i, { url: e.target.value })}
                placeholder="https://example.com"
                dir="ltr"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50"
              />
            )}
            {btn.type === 'PHONE_NUMBER' && (
              <input
                value={btn.phone_number ?? ''}
                onChange={e => onUpdate(i, { phone_number: e.target.value })}
                placeholder="+972501234567"
                dir="ltr"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50"
              />
            )}
            {errors.buttons?.[i] && <p className="text-xs text-red-600">{errors.buttons[i]}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function JsonPreview({ form, show, onToggle }: { form: TemplateForm; show: boolean; onToggle: () => void }) {
  const json = JSON.stringify(
    { name: form.name, language: form.language, category: form.category, components: buildComponents(form) },
    null, 2,
  );
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Code className="w-3.5 h-3.5" />
        {show ? 'הסתר JSON' : 'הצג JSON'}
        {show ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {show && (
        <pre className="mt-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap" dir="ltr">
          {json}
        </pre>
      )}
    </div>
  );
}
