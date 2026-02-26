type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export class Logger {
  constructor(private component: string) {}

  debug(msg: string, ctx?: Record<string, unknown>) { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>) { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>) { this.log('warn', msg, ctx); }

  error(msg: string, err?: unknown, ctx?: Record<string, unknown>) {
    const e = err instanceof Error ? err : undefined;
    this.log('error', msg, ctx, e);
  }

  child(sub: string) { return new Logger(`${this.component}:${sub}`); }

  private log(level: LogLevel, msg: string, ctx?: Record<string, unknown>, err?: Error) {
    if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
    const ts = new Date().toISOString();
    const c = ctx ? ` [${Object.entries(ctx).map(([k, v]) => `${k}=${v}`).join(' ')}]` : '';
    const out = `${ts} ${level.toUpperCase().padEnd(5)} [${this.component}] ${msg}${c}`;
    if (err) console.error(out, err.message);
    else console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](out);
  }
}

export const createLogger = (component: string) => new Logger(component);
export const logger = new Logger('app');
