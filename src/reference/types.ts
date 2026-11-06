/** One documented Strudel function. */
export type ReferenceEntry = {
  name: string;
  /** JSDoc's full name, e.g. "Pattern.slow" or "Pattern#withQuerySpan"; the docs site looks entries up by it. */
  longname: string;
  /** Other names it can be called by (Strudel's @synonyms and @alias). */
  synonyms: string[];
  /** Categories from Strudel's @tags; empty for functions that have none. */
  tags: string[];
  /** Where it is defined, as "<package>/<file>", e.g. "core/controls". */
  module: string;
  /** Markdown. */
  description: string;
  params: { name: string; types: string[]; description: string; optional: boolean; default?: string }[];
  returns?: string;
  /** Code examples, each a runnable Strudel snippet. */
  examples: string[];
  /** How it can be called in the running engine. */
  callable: { global: boolean; method: boolean };
  source: { path: string; line: number; url: string };
};

export type Reference = {
  schema: 1;
  /** The Strudel commit the reference documents: strudel.json's pin. */
  strudel: { branch: string; commit: string; date: string; repository: string };
  functions: ReferenceEntry[];
  /**
   * Names strudel.cc has in scope from packages Kynska cannot run headlessly
   * (Hydra, MIDI, CSound, ...), mapped to their package; documented or not.
   */
  browserOnly?: Record<string, string>;
};
