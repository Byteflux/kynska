// Evaluates Strudel code the way the strudel.cc REPL does, without playing it:
// `$:` labels are stacked, `_$:` mutes, `S$:` solos, all()/each() apply, and
// setcps/setcpm set the tempo.
import { captureConsole, ensureScope, silentRepl } from './scope.ts';

/**
 * What the code is written in: JavaScript (the default, which can still use
 * mondo`...` and tidal`...` inline), or Mondo notation throughout (the REPL's Mondo mode).
 */
export type Language = 'js' | 'mondo';

export type Evaluation = {
  /** The pattern the code produces; absent when evaluation failed. */
  pattern?: any;
  /** Tempo in cycles per second after evaluation (Strudel's default is 0.5). */
  cps: number;
  error?: Error;
  /** What Strudel logged while evaluating. */
  logs: string[];
};

/** The language a file is written in, by its extension: .mondo is Mondo notation. */
export function languageOf(file?: string): Language {
  return file?.endsWith('.mondo') ? 'mondo' : 'js';
}

export async function evaluateCode(code: string, language: Language = 'js'): Promise<Evaluation> {
  const scope = await ensureScope();
  const logs: string[] = [];
  let error: Error | undefined;
  const repl = silentRepl(
    scope,
    (e) => {
      error = e instanceof Error ? e : new Error(String(e));
    },
    language === 'mondo',
  );
  const pattern = await captureConsole(logs, () => repl.evaluate(code, false));
  return { pattern: error ? undefined : pattern, cps: repl.scheduler.cps, error, logs };
}
