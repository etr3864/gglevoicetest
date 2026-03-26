import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Plus, Trash2, Loader2, Upload, ChevronDown, ChevronUp, Image, Video, FileText, Code } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';

// ─── Types ───────────────────────────────────────────────────────────────────

type HeaderFormat = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
type ButtonType   = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
type Category     = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone_number?: string;
}

interface TemplateForm {
  name: string;
  category: Category;
  language: string;
  headerFormat: HeaderFormat;
  headerText: string;
  headerMediaId: string;
  bodyText: string;
  variableExamples: Record<number, string>;
  footerText: string;
  buttons: TemplateButton[];
}

interface ExistingTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  components: unknown[];
}

interface Props {
  agentId: string;
  initialTemplate: ExistingTemplate | null;
  onClose: (submitted: boolean) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractVariables(text: string): number[] {
  const nums = new Set<number>();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) nums.add(+m[1]);
  return Array.from(nums).sort((a, b) => a - b);
}

function buildComponents(form: TemplateForm): unknown[] {
  const components: unknown[] = [];

  if (form.headerFormat !== 'NONE') {
    if (form.headerFormat === 'TEXT') {
      components.push({ type: 'HEADER', format: 'TEXT', text: form.headerText });
    } else {
      const comp: Record<string, unknown> = { type: 'HEADER', format: form.headerFormat };
      if (form.headerMediaId) comp.example = { header_handle: [form.headerMediaId] };
      components.push(comp);
    }
  }

  const vars = extractVariables(form.bodyText);
  const bodyComp: Record<string, unknown> = { type: 'BODY', text: form.bodyText };
  if (vars.length > 0) {
    bodyComp.example = { body_text: [vars.map(n => form.variableExamples[n] ?? '')] };
  }
  components.push(bodyComp);

  if (form.footerText.trim()) {
    components.push({ type: 'FOOTER', text: form.footerText });
  }

  if (form.buttons.length > 0) {
    components.push({ type: 'BUTTONS', buttons: form.buttons });
  }

  return components;
}

function parseExistingComponents(components: unknown[]): Partial<TemplateForm> {
  const comps = components as { type: string; format?: string; text?: string; buttons?: TemplateButton[]; example?: { body_text?: string[][] } }[];
  const result: Partial<TemplateForm> = { headerFormat: 'NONE', headerText: '', headerMediaId: '', bodyText: '', footerText: '', buttons: [], variableExamples: {} };

  for (const c of comps) {
    if (c.type === 'HEADER') {
      result.headerFormat = (c.format as HeaderFormat) ?? 'TEXT';
      result.headerText = c.text ?? '';
    }
    if (c.type === 'BODY') {
      result.bodyText = c.text ?? '';
      const ex = c.example?.body_text?.[0];
      if (ex) {
        const vars = extractVariables(c.text ?? '');
        const examples: Record<number, string> = {};
        vars.forEach((n, i) => { examples[n] = ex[i] ?? ''; });
        result.variableExamples = examples;
      }
    }
    if (c.type === 'FOOTER') result.footerText = c.text ?? '';
    if (c.type === 'BUTTONS') result.buttons = c.buttons ?? [];
  }
  return result;
}

// ─── Validation ──────────────────────────────────────────────────────────────

interface ValidationErrors {
  name?: string;
  body?: string;
  bodyVars?: string;
  examples?: Record<number, string>;
  footer?: string;
  headerText?: string;
  headerMedia?: string;
  buttons?: Record<number, string>;
  buttonMix?: string;
}

function validate(form: TemplateForm): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!form.name.trim()) {
    errors.name = 'שם חובה';
  } else if (!/^[a-z0-9_]+$/.test(form.name)) {
    errors.name = 'רק אותיות קטנות באנגלית, מספרים ו-_';
  }

  if (!form.bodyText.trim()) {
    errors.body = 'תוכן ההודעה חובה';
  } else if (form.bodyText.length > 1024) {
    errors.body = `${form.bodyText.length}/1024 תווים`;
  }

  const vars = extractVariables(form.bodyText);
  if (vars.length > 0) {
    for (let i = 1; i <= Math.max(...vars); i++) {
      if (!vars.includes(i)) {
        errors.bodyVars = `{{${i}}} חסר — משתנים חייבים להיות רצופים החל מ-1`;
        break;
      }
    }
    const exErrors: Record<number, string> = {};
    for (const n of vars) {
      if (!form.variableExamples[n]?.trim()) exErrors[n] = `חסרה דוגמה ל-{{${n}}}`;
    }
    if (Object.keys(exErrors).length > 0) errors.examples = exErrors;
  }

  if (form.footerText.length > 60) errors.footer = `${form.footerText.length}/60 תווים`;

  if (form.headerFormat === 'TEXT' && form.headerText.length > 60) {
    errors.headerText = `${form.headerText.length}/60 תווים`;
  }
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerFormat) && !form.headerMediaId) {
    errors.headerMedia = 'נדרש להעלות קובץ לדוגמה';
  }

  if (form.buttons.length > 0) {
    const hasQuickReply = form.buttons.some(b => b.type === 'QUICK_REPLY');
    const hasCta = form.buttons.some(b => b.type === 'URL' || b.type === 'PHONE_NUMBER');
    if (hasQuickReply && hasCta) errors.buttonMix = 'לא ניתן לשלב QUICK_REPLY עם כפתורי URL/טלפון';

    const btnErrors: Record<number, string> = {};
    form.buttons.forEach((btn, i) => {
      if (!btn.text.trim()) { btnErrors[i] = 'טקסט חובה'; return; }
      if (btn.type === 'QUICK_REPLY' && btn.text.length > 25) { btnErrors[i] = `${btn.text.length}/25 תווים`; return; }
      if (btn.type === 'URL' && (!btn.url || !/^https?:\/\/.+/.test(btn.url))) { btnErrors[i] = 'כתובת URL לא תקינה'; return; }
      if (btn.type === 'PHONE_NUMBER' && (!btn.phone_number || !/^\+\d{7,15}$/.test(btn.phone_number))) { btnErrors[i] = 'מספר טלפון לא תקין (+...)'; }
    });
    if (Object.keys(btnErrors).length > 0) errors.buttons = btnErrors;
  }

  return errors;
}

function countErrors(errs: ValidationErrors): number {
  let n = 0;
  if (errs.name) n++;
  if (errs.body) n++;
  if (errs.bodyVars) n++;
  if (errs.footer) n++;
  if (errs.headerText) n++;
  if (errs.headerMedia) n++;
  if (errs.buttonMix) n++;
  if (errs.examples) n += Object.keys(errs.examples).length;
  if (errs.buttons) n += Object.keys(errs.buttons).length;
  return n;
}

// ─── Preview ─────────────────────────────────────────────────────────────────

function WhatsappPreview({ form }: { form: TemplateForm }) {
  const vars = extractVariables(form.bodyText);
  const previewBody = vars.reduce(
    (text, n) => text.replace(new RegExp(`\\{\\{${n}\\}\\}`, 'g'), form.variableExamples[n] || `{{${n}}}`),
    form.bodyText,
  );

  const headerIcons: Record<string, React.ReactNode> = {
    IMAGE:    <Image className="w-6 h-6 text-gray-400" />,
    VIDEO:    <Video className="w-6 h-6 text-gray-400" />,
    DOCUMENT: <FileText className="w-6 h-6 text-gray-400" />,
  };

  return (
    <div className="sticky top-4 space-y-3">
      <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">תצוגה מקדימה</p>
      <div className="p-3 rounded-2xl bg-[#dcf8c6] border border-[#b2dfb3] shadow-sm max-w-xs">
        {form.headerFormat !== 'NONE' && (
          <div className="mb-2">
            {form.headerFormat === 'TEXT'
              ? <p className="text-sm font-semibold text-gray-900">{form.headerText || 'כותרת'}</p>
              : (
                <div className="flex items-center justify-center h-20 rounded-lg bg-gray-100 border border-gray-200">
                  {headerIcons[form.headerFormat]}
                </div>
              )
            }
          </div>
        )}

        <p className="text-sm text-gray-900 whitespace-pre-wrap leading-snug">
          {previewBody || <span className="text-gray-400 italic">תוכן ההודעה...</span>}
        </p>

        {form.footerText && (
          <p className="mt-1 text-xs text-gray-500">{form.footerText}</p>
        )}

        {form.buttons.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#b2dfb3] space-y-1">
            {form.buttons.map((btn, i) => (
              <div key={i} className="text-center text-xs font-medium text-[#128C7E] py-1 rounded">
                {btn.text || <span className="text-gray-400 italic">טקסט כפתור</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-[var(--text-tertiary)] text-center">המשתנים מוחלפים בדוגמאות</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const LANGUAGES = [
  { value: 'he', label: 'עברית' },
  { value: 'en_US', label: 'אנגלית (US)' },
];

const CATEGORIES: { value: Category; label: string; desc: string }[] = [
  { value: 'UTILITY',        label: 'שירות',    desc: 'עדכונים, תזכורות, אישורים' },
  { value: 'MARKETING',      label: 'שיווק',    desc: 'מבצעים, הצעות, תוכן פרסומי' },
  { value: 'AUTHENTICATION', label: 'אימות',    desc: 'קודי OTP ואישור זהות' },
];

const defaultForm: TemplateForm = {
  name: '', category: 'UTILITY', language: 'he',
  headerFormat: 'NONE', headerText: '', headerMediaId: '',
  bodyText: '', variableExamples: {},
  footerText: '', buttons: [],
};

export default function TemplateBuilder({ agentId, initialTemplate, onClose }: Props) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showJson, setShowJson] = useState(false);

  const [form, setForm] = useState<TemplateForm>(() => {
    if (!initialTemplate) return defaultForm;
    const parsed = parseExistingComponents(initialTemplate.components);
    return {
      ...defaultForm,
      name: initialTemplate.name,
      category: initialTemplate.category as Category,
      language: initialTemplate.language,
      ...parsed,
    };
  });

  const [touched, setTouched] = useState(false);
  const errors = touched ? validate(form) : {};
  const errorCount = countErrors(errors);

  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function insertVariable() {
    const ta = textareaRef.current;
    const vars = extractVariables(form.bodyText);
    const nextVar = vars.length > 0 ? Math.max(...vars) + 1 : 1;
    const tag = `{{${nextVar}}}`;

    if (ta) {
      const start = ta.selectionStart ?? form.bodyText.length;
      const end = ta.selectionEnd ?? form.bodyText.length;
      const newText = form.bodyText.slice(0, start) + tag + form.bodyText.slice(end);
      update('bodyText', newText);
      setTimeout(() => {
        ta.selectionStart = start + tag.length;
        ta.selectionEnd   = start + tag.length;
        ta.focus();
      }, 0);
    } else {
      update('bodyText', form.bodyText + tag);
    }
  }

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

  const submitMutation = useMutation({
    mutationFn: () => {
      const components = buildComponents(form);
      return api.post(`/agents/${agentId}/whatsapp/templates`, {
        name: form.name,
        language: form.language,
        category: form.category,
        components,
      });
    },
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
    const errs = validate(form);
    if (countErrors(errs) > 0) return;
    submitMutation.mutate();
  }

  const vars = extractVariables(form.bodyText);
  const jsonPreview = JSON.stringify(
    { name: form.name, language: form.language, category: form.category, components: buildComponents(form) },
    null, 2,
  );

  const acceptByFormat: Record<string, string> = {
    IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf',
  };

  const addButton = useCallback(() => {
    if (form.buttons.length >= 3) return;
    update('buttons', [...form.buttons, { type: 'QUICK_REPLY', text: '' }]);
  }, [form.buttons]);

  const removeButton = useCallback((i: number) => {
    update('buttons', form.buttons.filter((_, idx) => idx !== i));
  }, [form.buttons]);

  const updateButton = useCallback((i: number, patch: Partial<TemplateButton>) => {
    update('buttons', form.buttons.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  }, [form.buttons]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Modal header */}
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

            {/* Basic info */}
            <section className="space-y-3">
              <div>
                <Input
                  label="שם התבנית"
                  value={form.name}
                  onChange={e => update('name', e.target.value)}
                  placeholder="appointment_reminder"
                  dir="ltr"
                  disabled={!!initialTemplate}
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
                      onClick={() => update('category', c.value)}
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
                  onChange={e => update('language', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
                  dir="ltr"
                >
                  {LANGUAGES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </section>

            <hr className="border-[var(--border)]" />

            {/* Header */}
            <section className="space-y-3">
              <label className="text-sm font-medium text-[var(--text-primary)]">כותרת (אופציונלי)</label>
              <div className="flex flex-wrap gap-2">
                {(['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as HeaderFormat[]).map(f => (
                  <button
                    key={f}
                    onClick={() => { update('headerFormat', f); update('headerMediaId', ''); }}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      form.headerFormat === f
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50',
                    )}
                  >
                    {{ NONE: 'ללא', TEXT: 'טקסט', IMAGE: 'תמונה', VIDEO: 'וידאו', DOCUMENT: 'מסמך PDF' }[f]}
                  </button>
                ))}
              </div>

              {form.headerFormat === 'TEXT' && (
                <div>
                  <input
                    value={form.headerText}
                    onChange={e => update('headerText', e.target.value)}
                    placeholder="כותרת ההודעה"
                    maxLength={60}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
                  />
                  {errors.headerText && <p className="mt-1 text-xs text-red-600">{errors.headerText}</p>}
                </div>
              )}

              {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerFormat) && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={acceptByFormat[form.headerFormat] ?? '*'}
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleMediaUpload(f); }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingMedia}
                    className="flex items-center gap-2 px-4 py-3 w-full rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)]/50 text-sm text-[var(--text-secondary)] transition-colors"
                  >
                    {uploadingMedia
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Upload className="w-4 h-4" />}
                    {uploadingMedia ? 'מעלה...' : form.headerMediaId ? 'קובץ הועלה ✓ — לחץ להחלפה' : 'לחץ לבחירת קובץ'}
                  </button>
                  {errors.headerMedia && <p className="mt-1 text-xs text-red-600">{errors.headerMedia}</p>}
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    {({ IMAGE: 'JPEG/PNG עד 5MB', VIDEO: 'MP4 עד 16MB', DOCUMENT: 'PDF עד 100MB' } as Record<string, string>)[form.headerFormat]}
                  </p>
                </div>
              )}
            </section>

            <hr className="border-[var(--border)]" />

            {/* Body */}
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
                onChange={e => update('bodyText', e.target.value)}
                rows={5}
                placeholder="שלום {{1}}, תזכורת לפגישתך ב-{{2}}..."
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-tertiary)]"
              />
              <button
                onClick={insertVariable}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                + הוסף משתנה
              </button>
              {errors.body && <p className="text-xs text-red-600">{errors.body}</p>}
              {errors.bodyVars && <p className="text-xs text-red-600">{errors.bodyVars}</p>}

              {/* Variable examples */}
              {vars.length > 0 && (
                <div className="space-y-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">דוגמאות למשתנים (לצורך אישור Meta)</p>
                  {vars.map(n => (
                    <div key={n} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-[var(--text-secondary)] w-14 shrink-0">
                        {`{{${n}}}`}
                      </span>
                      <input
                        value={form.variableExamples[n] ?? ''}
                        onChange={e => update('variableExamples', { ...form.variableExamples, [n]: e.target.value })}
                        placeholder={`דוגמה ל-{{${n}}}`}
                        className={cn(
                          'flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--bg-card)] border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50',
                          errors.examples?.[n] ? 'border-red-400' : 'border-[var(--border)]',
                        )}
                      />
                      {errors.examples?.[n] && (
                        <span className="text-xs text-red-600">{errors.examples[n]}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <hr className="border-[var(--border)]" />

            {/* Footer */}
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
                onChange={e => update('footerText', e.target.value)}
                placeholder="שירות לקוחות"
                maxLength={60}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
              />
              {errors.footer && <p className="text-xs text-red-600">{errors.footer}</p>}
            </section>

            <hr className="border-[var(--border)]" />

            {/* Buttons */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-[var(--text-primary)]">כפתורים (עד 3, אופציונלי)</label>
                {form.buttons.length < 3 && (
                  <button onClick={addButton} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> הוסף כפתור
                  </button>
                )}
              </div>

              {errors.buttonMix && (
                <p className="text-xs text-red-600">{errors.buttonMix}</p>
              )}

              <div className="space-y-2">
                {form.buttons.map((btn, i) => (
                  <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={btn.type}
                        onChange={e => updateButton(i, { type: e.target.value as ButtonType, url: undefined, phone_number: undefined })}
                        className="text-xs px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none"
                        dir="ltr"
                      >
                        <option value="QUICK_REPLY">QUICK_REPLY</option>
                        <option value="URL">URL</option>
                        <option value="PHONE_NUMBER">PHONE_NUMBER</option>
                      </select>
                      <input
                        value={btn.text}
                        onChange={e => updateButton(i, { text: e.target.value })}
                        placeholder="טקסט הכפתור"
                        className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50"
                      />
                      <button onClick={() => removeButton(i)} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {btn.type === 'URL' && (
                      <input
                        value={btn.url ?? ''}
                        onChange={e => updateButton(i, { url: e.target.value })}
                        placeholder="https://example.com"
                        dir="ltr"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50"
                      />
                    )}
                    {btn.type === 'PHONE_NUMBER' && (
                      <input
                        value={btn.phone_number ?? ''}
                        onChange={e => updateButton(i, { phone_number: e.target.value })}
                        placeholder="+972501234567"
                        dir="ltr"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50"
                      />
                    )}
                    {errors.buttons?.[i] && (
                      <p className="text-xs text-red-600">{errors.buttons[i]}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Preview panel */}
          <div className="w-72 shrink-0 overflow-y-auto p-5 space-y-4" dir="rtl">
            <WhatsappPreview form={form} />

            {/* JSON preview toggle */}
            <div>
              <button
                onClick={() => setShowJson(s => !s)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Code className="w-3.5 h-3.5" />
                {showJson ? 'הסתר JSON' : 'הצג JSON'}
                {showJson ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showJson && (
                <pre className="mt-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap" dir="ltr">
                  {jsonPreview}
                </pre>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] shrink-0">
          <button onClick={() => onClose(false)} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            ביטול
          </button>
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending || (touched && errorCount > 0)}
            title={touched && errorCount > 0 ? `יש ${errorCount} בעיות לתיקון` : undefined}
          >
            {submitMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : null}
            {touched && errorCount > 0
              ? `יש ${errorCount} ${errorCount === 1 ? 'בעיה' : 'בעיות'} לתיקון`
              : 'הגש לאישור Meta'}
          </Button>
        </div>
      </div>
    </div>
  );
}
