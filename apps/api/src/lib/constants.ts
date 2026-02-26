export const GEMINI_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

export const DEFAULT_VOICE = 'Aoede';


export interface VoiceOption {
  id: string;
  label: string;
  gender: 'female' | 'male';
  description: string;
}

export const VOICES: VoiceOption[] = [
  { id: 'Aoede',       label: 'Aoede',       gender: 'female', description: 'רגועה, טבעית ונעימה' },
  { id: 'Kore',        label: 'Kore',        gender: 'female', description: 'תקיפה, חזקה ונחושה' },
  { id: 'Leda',        label: 'Leda',        gender: 'female', description: 'צעירה, אנרגטית ורעננה' },
  { id: 'Zephyr',      label: 'Zephyr',      gender: 'female', description: 'בהירה וקלילה' },
  { id: 'Umbriel',     label: 'Umbriel',     gender: 'female', description: 'רכה ומלטפת' },
  { id: 'Despina',     label: 'Despina',     gender: 'female', description: 'חדה ודינמית' },
  { id: 'Erinome',     label: 'Erinome',     gender: 'female', description: 'רכה ומזמינה' },
  { id: 'Pulcherrima', label: 'Pulcherrima', gender: 'female', description: 'אלגנטית ומעודנת' },
  { id: 'Puck',        label: 'Puck',        gender: 'male',   description: 'עליז, חיובי ותוסס' },
  { id: 'Charon',      label: 'Charon',      gender: 'male',   description: 'מידעי, רגוע ומקצועי' },
  { id: 'Fenrir',      label: 'Fenrir',      gender: 'male',   description: 'נלהב, נמרץ ומלא אנרגיה' },
  { id: 'Orus',        label: 'Orus',        gender: 'male',   description: 'עמוק ויציב' },
  { id: 'Enceladus',   label: 'Enceladus',   gender: 'male',   description: 'שקט ומרגיע' },
  { id: 'Iapetus',     label: 'Iapetus',     gender: 'male',   description: 'ברור ומדויק' },
  { id: 'Algieba',     label: 'Algieba',     gender: 'male',   description: 'חם וידידותי' },
  { id: 'Achernar',    label: 'Achernar',    gender: 'male',   description: 'עמוק וסמכותי' },
  { id: 'Alnilam',     label: 'Alnilam',     gender: 'male',   description: 'ברור ונקי' },
  { id: 'Schedar',     label: 'Schedar',     gender: 'male',   description: 'יציב ובטוח' },
  { id: 'Gacrux',      label: 'Gacrux',      gender: 'male',   description: 'בוגר ורציני' },
  { id: 'Achird',      label: 'Achird',      gender: 'male',   description: 'חברותי וקליל' },
];
