export const GEMINI_MODEL = 'gemini-live-2.5-flash-native-audio';

export const CONTEXT_REFRESH_TOKEN_THRESHOLD = 20_000;

export const DEFAULT_VOICE = 'Aoede';


export interface VoiceOption {
  id: string;
  label: string;
  gender: 'female' | 'male';
  description: string;
}

export const VOICES: VoiceOption[] = [
  { id: 'Aoede',         label: 'Aoede',         gender: 'female', description: 'רגועה, טבעית ונעימה' },
  { id: 'Kore',          label: 'Kore',          gender: 'female', description: 'תקיפה, חזקה ונחושה' },
  { id: 'Leda',          label: 'Leda',          gender: 'female', description: 'צעירה, אנרגטית ורעננה' },
  { id: 'Zephyr',        label: 'Zephyr',        gender: 'female', description: 'בהירה וקלילה' },
  { id: 'Umbriel',       label: 'Umbriel',       gender: 'female', description: 'נינוחה ורגועה' },
  { id: 'Despina',       label: 'Despina',       gender: 'female', description: 'חדה ודינמית' },
  { id: 'Erinome',       label: 'Erinome',       gender: 'female', description: 'ברורה ונקייה' },
  { id: 'Pulcherrima',   label: 'Pulcherrima',   gender: 'female', description: 'נלהבת וישירה' },
  { id: 'Autonoe',       label: 'Autonoe',       gender: 'female', description: 'בהירה ואופטימית' },
  { id: 'Laomedeia',     label: 'Laomedeia',     gender: 'female', description: 'עליזה ומלאת חיים' },
  { id: 'Callirrhoe',    label: 'Callirrhoe',    gender: 'female', description: 'נינוחה וקלת דעת' },
  { id: 'Puck',          label: 'Puck',          gender: 'male',   description: 'עליז, חיובי ותוסס' },
  { id: 'Charon',        label: 'Charon',        gender: 'male',   description: 'מידעי, רגוע ומקצועי' },
  { id: 'Fenrir',        label: 'Fenrir',        gender: 'male',   description: 'נלהב, נמרץ ומלא אנרגיה' },
  { id: 'Orus',          label: 'Orus',          gender: 'male',   description: 'עמוק ויציב' },
  { id: 'Enceladus',     label: 'Enceladus',     gender: 'male',   description: 'שקט ומרגיע' },
  { id: 'Iapetus',       label: 'Iapetus',       gender: 'male',   description: 'ברור ומדויק' },
  { id: 'Algieba',       label: 'Algieba',       gender: 'male',   description: 'חלק ורהוט' },
  { id: 'Achernar',      label: 'Achernar',      gender: 'male',   description: 'רך ועמוק' },
  { id: 'Alnilam',       label: 'Alnilam',       gender: 'male',   description: 'תקיף ונחוש' },
  { id: 'Schedar',       label: 'Schedar',       gender: 'male',   description: 'יציב ובטוח' },
  { id: 'Gacrux',        label: 'Gacrux',        gender: 'male',   description: 'בוגר ורציני' },
  { id: 'Achird',        label: 'Achird',        gender: 'male',   description: 'חברותי וקליל' },
  { id: 'Algenib',       label: 'Algenib',       gender: 'male',   description: 'גרגרני ואותנטי' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi', gender: 'male',   description: 'קז\'ואל ויומיומי' },
  { id: 'Sadaltager',    label: 'Sadaltager',    gender: 'male',   description: 'בקיא ומשכיל' },
  { id: 'Sadachbia',     label: 'Sadachbia',     gender: 'male',   description: 'חי ומלא רוח' },
  { id: 'Rasalgethi',    label: 'Rasalgethi',    gender: 'male',   description: 'מידעי ואמין' },
  { id: 'Vindemiatrix',  label: 'Vindemiatrix',  gender: 'male',   description: 'עדין ועדין' },
  { id: 'Sulafat',       label: 'Sulafat',       gender: 'male',   description: 'חמים ונעים' },
];
