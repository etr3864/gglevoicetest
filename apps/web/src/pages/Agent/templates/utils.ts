import type { TemplateForm, TemplateButton, HeaderFormat, ValidationErrors } from './types';

// ─── Variable helpers ─────────────────────────────────────────────────────────

export function extractVariables(text: string): number[] {
  const nums = new Set<number>();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) nums.add(+m[1]);
  return Array.from(nums).sort((a, b) => a - b);
}

// ─── JSON builder ─────────────────────────────────────────────────────────────

export function buildComponents(form: TemplateForm): unknown[] {
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

// ─── Parse existing template components back into form state ──────────────────

export function parseExistingComponents(components: unknown[]): Partial<TemplateForm> {
  type RawComp = { type: string; format?: string; text?: string; buttons?: TemplateButton[]; example?: { body_text?: string[][] } };
  const comps = components as RawComp[];
  const result: Partial<TemplateForm> = {
    headerFormat: 'NONE', headerText: '', headerMediaId: '',
    bodyText: '', footerText: '', buttons: [], variableExamples: {},
  };

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

// ─── Validation ───────────────────────────────────────────────────────────────

export function validate(form: TemplateForm): ValidationErrors {
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
    const hasQuickReply = form.buttons.some((b: TemplateButton) => b.type === 'QUICK_REPLY');
    const hasCta = form.buttons.some((b: TemplateButton) => b.type === 'URL' || b.type === 'PHONE_NUMBER');
    if (hasQuickReply && hasCta) errors.buttonMix = 'לא ניתן לשלב QUICK_REPLY עם כפתורי URL/טלפון';

    const btnErrors: Record<number, string> = {};
    form.buttons.forEach((btn: TemplateButton, i: number) => {
      if (!btn.text.trim()) { btnErrors[i] = 'טקסט חובה'; return; }
      if (btn.type === 'QUICK_REPLY' && btn.text.length > 25) { btnErrors[i] = `${btn.text.length}/25 תווים`; return; }
      if (btn.type === 'URL' && (!btn.url || !/^https?:\/\/.+/.test(btn.url))) { btnErrors[i] = 'כתובת URL לא תקינה'; return; }
      if (btn.type === 'PHONE_NUMBER' && (!btn.phone_number || !/^\+\d{7,15}$/.test(btn.phone_number))) { btnErrors[i] = 'מספר טלפון לא תקין (+...)'; }
    });
    if (Object.keys(btnErrors).length > 0) errors.buttons = btnErrors;
  }

  return errors;
}

export function countErrors(errs: ValidationErrors): number {
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
