// JSDoc plugin for Strudel's custom block tags. Loaded by jsdoc (CommonJS).
//   @synonyms a, b   other names the function is registered under
//   @tags x, y       categories, e.g. "filter, lfo, superdough"
// Both are stored as string arrays on the doclet under kynska-specific keys.
const split = (value) =>
  String(value)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

exports.defineTags = function (dictionary) {
  dictionary.defineTag('synonyms', {
    mustHaveValue: true,
    onTagged(doclet, tag) {
      doclet.kynskaSynonyms = [...(doclet.kynskaSynonyms ?? []), ...split(tag.value)];
    },
  });
  dictionary.defineTag('tags', {
    mustHaveValue: true,
    onTagged(doclet, tag) {
      doclet.kynskaTags = [...(doclet.kynskaTags ?? []), ...split(tag.value)];
    },
  });
};
