export type HeaderFormat = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export type ButtonType   = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
export type Category     = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone_number?: string;
}

export interface TemplateForm {
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

export interface ValidationErrors {
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

export interface ExistingTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  components: unknown[];
}
