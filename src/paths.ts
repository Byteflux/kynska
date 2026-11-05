import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Kynska checkout. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Fetched upstream sources and intermediate files. Git-ignored. */
export const CACHE_DIR = join(ROOT, '.cache');
/** Generated outputs. Git-ignored. */
export const OUT_DIR = join(ROOT, 'out');
/** The function reference built by `kynska reference build`. */
export const REFERENCE_FILE = join(OUT_DIR, 'reference.json');
/** Which Strudel release Kynska builds against. */
export const PIN_FILE = join(ROOT, 'strudel.json');
