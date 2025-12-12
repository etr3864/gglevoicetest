import fs from 'fs';
import path from 'path';

export class ConversationLogger {
  private logPath: string;
  private stream: fs.WriteStream | null = null;
  private lastSpeaker: string = '';
  private buffer: string = '';
  private writeTimeout: NodeJS.Timeout | null = null;

  constructor(phoneNumber: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `call_${timestamp}_${phoneNumber.replace(/\+/g, '')}.txt`;
    this.logPath = path.join(process.cwd(), 'logs', filename);
    
    if (!fs.existsSync(path.join(process.cwd(), 'logs'))) {
        fs.mkdirSync(path.join(process.cwd(), 'logs'));
    }

    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
    // Removed system initialization log
  }

  log(speaker: string, text: string) {
    if (!this.stream || !text.trim()) return;

    // If speaker changed, flush buffer and start new line
    if (this.lastSpeaker && this.lastSpeaker !== speaker) {
        this.flush();
    }

    this.lastSpeaker = speaker;
    this.buffer += text; // Append text

    // Debounce write to avoid fragmented lines
    if (this.writeTimeout) clearTimeout(this.writeTimeout);
    this.writeTimeout = setTimeout(() => this.flush(), 1000);
  }

  private flush() {
    if (!this.buffer.trim()) return;
    
    // Clean up undefined/null strings if they appear
    let cleanText = this.buffer.replace(/undefined/g, '').trim();
    if (!cleanText) return;

    // Format: SPEAKER: Text
    const line = `${this.lastSpeaker}: ${cleanText}\n`;
    
    if (this.stream) {
        this.stream.write(line);
    }
    
    this.buffer = '';
    // We keep lastSpeaker to allow appending more text from same speaker until timeout
  }

  // Changed to only log to console, NOT to file
  logSystem(text: string) {
    console.log(`[SYSTEM]: ${text}`); 
  }

  close() {
    this.flush();
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
