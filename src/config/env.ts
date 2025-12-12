import dotenv from 'dotenv';
dotenv.config();

export const config = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    voiceName: process.env.VOICE_NAME || 'Aoede', // Default to stable voice
    model: process.env.GEMINI_MODEL || 'models/gemini-2.5-flash-native-audio-preview-09-2025', // Latest 2.5 Native Audio
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || 'localhost',
    ngrokUrl: process.env.NGROK_URL || '',
  },
  call: {
    targetPhone: process.env.TARGET_PHONE || '',
    customerName: process.env.CUSTOMER_NAME || '',
  }
};
