import { Image, Video, FileText } from 'lucide-react';
import { extractVariables } from './utils';
import type { TemplateForm } from './types';

interface Props {
  form: TemplateForm;
}

const HEADER_ICONS: Record<string, React.ReactNode> = {
  IMAGE:    <Image    className="w-6 h-6 text-gray-400" />,
  VIDEO:    <Video    className="w-6 h-6 text-gray-400" />,
  DOCUMENT: <FileText className="w-6 h-6 text-gray-400" />,
};

export default function WhatsappPreview({ form }: Props) {
  const vars = extractVariables(form.bodyText);
  const previewBody = vars.reduce(
    (text, n) => text.replace(new RegExp(`\\{\\{${n}\\}\\}`, 'g'), form.variableExamples[n] || `{{${n}}}`),
    form.bodyText,
  );

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
                  {HEADER_ICONS[form.headerFormat]}
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
