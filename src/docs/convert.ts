// Converts one docs page from MDX to plain Markdown an agent can read: playable
// examples become code blocks, reference embeds become the reference text, and
// interactive widgets become a short note with a link to the live page.
import { posix } from 'node:path';
import { parseExpressionAt, type Node } from 'acorn';
import type { Root, RootContent, PhrasingContent } from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import type { ReferenceIndex } from '../reference/lookup.ts';
import type { ReferenceEntry } from '../reference/types.ts';

export const SITE = 'https://strudel.cc';

export type ConvertOptions = {
  /** The page's path on the site, e.g. "learn/effects". */
  slug: string;
  reference: ReferenceIndex;
  /** Slugs of all pages being generated, so links between them stay local. */
  pages: ReadonlySet<string>;
};

export type ConvertedPage = {
  title: string;
  /** First sentence or so of the page, for indexes. */
  summary: string;
  markdown: string;
  /** Things the conversion could not carry over. */
  warnings: string[];
};

type Jsx = MdxJsxFlowElement | MdxJsxTextElement;
type AnyNode = { type: string; children?: AnyNode[]; [key: string]: any };

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter).use(remarkGfm);
/** Reference descriptions are plain Markdown, where `<` and `{` are just text. */
const markdownParser = unified().use(remarkParse).use(remarkGfm);
const printer = unified().use(remarkStringify, { bullet: '-', fences: true, rule: '-' }).use(remarkGfm);

/** Interactive pieces of the site that have no text equivalent. */
const WIDGETS: Record<string, string> = {
  PitchSlider: 'a pitch slider',
  Colors: 'a colour palette',
  Showcase: 'a video showcase',
  Gamepad: 'a gamepad tester',
  DeviceMotion: 'a device motion tester',
  Claviature: 'a keyboard',
};

type AttributeValue = MdxJsxAttribute['value'] | true;

function attribute(node: Jsx, name: string): AttributeValue | undefined {
  const attr = node.attributes.find((a): a is MdxJsxAttribute => a.type === 'mdxJsxAttribute' && a.name === name);
  if (!attr) return undefined;
  return attr.value === null || attr.value === undefined ? true : attr.value;
}

/** A string attribute, or the value of a static expression ({`...`}, {'...'}, {3}). */
function staticValue(value: AttributeValue | undefined): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  try {
    const node = parseExpressionAt(value.value, 0, { ecmaVersion: 'latest' }) as Node & Record<string, any>;
    if (node.type === 'Literal') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
    if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal') return -node.argument.value;
  } catch {
    // not a plain value
  }
  return undefined;
}

function code(value: string): RootContent {
  return { type: 'code', lang: 'js', value: value.trim() };
}

function paragraph(...children: PhrasingContent[]): RootContent {
  return { type: 'paragraph', children };
}

/** A reference entry as Markdown nodes, the way the site's JsDoc component shows it. */
function referenceNodes(entry: ReferenceEntry, depth: number): RootContent[] {
  const nodes: RootContent[] = [];
  if (depth > 0) nodes.push({ type: 'heading', depth: Math.min(depth, 6) as 1, children: [{ type: 'text', value: entry.name }] });
  if (entry.synonyms.length) {
    nodes.push(paragraph({ type: 'text', value: 'Also called: ' }, ...entry.synonyms.flatMap((s, i): PhrasingContent[] => [
      ...(i ? [{ type: 'text', value: ', ' } as PhrasingContent] : []),
      { type: 'inlineCode', value: s },
    ])));
  }
  nodes.push(...(markdownParser.parse(entry.description).children as RootContent[]));
  if (entry.params.length) {
    nodes.push({
      type: 'list',
      ordered: false,
      spread: false,
      children: entry.params.map((p) => ({
        type: 'listItem' as const,
        spread: false,
        children: [
          {
            type: 'paragraph' as const,
            children: [
              { type: 'inlineCode' as const, value: p.name },
              { type: 'text' as const, value: `${p.types.length ? ` (${p.types.join(' | ')})` : ''}${p.description ? `: ${p.description}` : ''}` },
            ],
          },
        ],
      })),
    });
  }
  nodes.push(...entry.examples.map(code));
  return nodes;
}

/** Rewrites a site link: to another generated page (relative .md), or to the live site. */
function rewriteLink(url: string, options: ConvertOptions): string {
  if (/^(https?:|mailto:|#)/.test(url)) return url;
  const base = new URL(`${SITE}/${options.slug}/`);
  const target = new URL(url, base);
  if (target.origin !== SITE) return target.href;
  const path = target.pathname.replace(/^\/|\/$/g, '');
  if (options.pages.has(path)) {
    const relative = posix.relative(posix.dirname(options.slug), path);
    return `${relative}.md${target.hash}`;
  }
  return target.href;
}

function convertJsx(node: Jsx, options: ConvertOptions, warnings: string[], inline: boolean): AnyNode[] {
  const name = node.name ?? '';
  const children = (node.children ?? []) as AnyNode[];
  const live = `${SITE}/${options.slug}/`;
  switch (name) {
    case 'MiniRepl': {
      if (attribute(node, 'tunes') !== undefined) {
        // A player cycling through the site's example tunes, which are community
        // contributions with their own licences: not carried over.
        const note = { type: 'emphasis', children: [{ type: 'text', value: `The live page plays example tunes here: ` }, { type: 'link', url: live, children: [{ type: 'text', value: live }] }] };
        return [paragraph(note as PhrasingContent)];
      }
      const tune = staticValue(attribute(node, 'tune'));
      if (typeof tune !== 'string') {
        warnings.push('a MiniRepl whose code is not a plain string was left out');
        return [];
      }
      // <MiniRepl mondo ...> holds Mondo notation, not JavaScript.
      return attribute(node, 'mondo') ? [{ type: 'code', lang: 'mondo', value: tune.trim() }] : [code(tune)];
    }
    case 'JsDoc': {
      const fn = staticValue(attribute(node, 'name'));
      const h = staticValue(attribute(node, 'h'));
      const entry = typeof fn === 'string' ? options.reference.find(fn) : undefined;
      if (!entry) {
        warnings.push(`JsDoc "${fn}" is not in the reference (no JSDoc description at this Strudel version), so it was left out`);
        return [];
      }
      return referenceNodes(entry, typeof h === 'number' ? h : 3);
    }
    case 'Box':
      return [{ type: 'blockquote', children }];
    case 'QA':
      return [paragraph({ type: 'strong', children: [{ type: 'text', value: 'Solution:' }] }), ...children];
    case 'a': {
      const href = staticValue(attribute(node, 'href'));
      if (typeof href !== 'string') return children;
      const link = { type: 'link', url: rewriteLink(href, options), children: children.length ? children : [{ type: 'text', value: href }] };
      return inline ? [link] : [paragraph(link as PhrasingContent)];
    }
    case 'img': {
      const src = staticValue(attribute(node, 'src'));
      const alt = staticValue(attribute(node, 'alt'));
      if (typeof src !== 'string') return [];
      const image = { type: 'image', url: new URL(src, live).href, alt: typeof alt === 'string' ? alt : '' };
      return inline ? [image] : [paragraph(image as PhrasingContent)];
    }
    case 'iframe': {
      const src = staticValue(attribute(node, 'src'));
      if (typeof src !== 'string') return [];
      const link = { type: 'link', url: new URL(src, live).href, children: [{ type: 'text', value: 'Embedded media' }] };
      return inline ? [link] : [paragraph(link as PhrasingContent)];
    }
    case 'br':
      return inline ? [{ type: 'break' }] : [];
    case 'summary':
      return inline ? [{ type: 'strong', children }] : [paragraph({ type: 'strong', children } as PhrasingContent)];
    default: {
      if (WIDGETS[name]) {
        const note = { type: 'emphasis', children: [{ type: 'text', value: `The live page has ${WIDGETS[name]} here: ` }, { type: 'link', url: live, children: [{ type: 'text', value: live }] }] };
        return inline ? [note] : [paragraph(note as PhrasingContent)];
      }
      if (/^[a-z]/.test(name)) return children; // plain HTML wrappers (div, span, figure, details)
      warnings.push(`unknown component <${name}> was unwrapped`);
      return children;
    }
  }
}

function transform(nodes: AnyNode[], options: ConvertOptions, warnings: string[]): AnyNode[] {
  const out: AnyNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'mdxjsEsm':
      case 'mdxFlowExpression':
      case 'mdxTextExpression':
      case 'yaml':
        break; // imports, exports, {comments} and {expressions}, frontmatter
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement':
        out.push(...transform(convertJsx(node as Jsx, options, warnings, node.type === 'mdxJsxTextElement'), options, warnings));
        break;
      default: {
        if (node.type === 'link' || node.type === 'definition') node.url = rewriteLink(node.url, options);
        if (node.type === 'image') node.url = new URL(node.url, `${SITE}/${options.slug}/`).href;
        if (node.children) node.children = transform(node.children, options, warnings);
        out.push(node);
      }
    }
  }
  return out;
}

function frontmatter(source: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => /^([A-Za-z]+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '').trim()]),
  );
}

function plainText(node: AnyNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  return (node.children ?? []).map(plainText).join('');
}

export function convertPage(source: string, options: ConvertOptions): ConvertedPage {
  const warnings: string[] = [];
  const tree = parser.parse(source) as Root;
  const children = transform(tree.children as AnyNode[], options, warnings) as RootContent[];
  const meta = frontmatter(source);
  const firstHeading = children.find((n) => n.type === 'heading') as AnyNode | undefined;
  const title = meta.title || (firstHeading ? plainText(firstHeading) : options.slug);
  // The first real paragraph: not one of the notes this converter adds for widgets.
  const isNote = (n: AnyNode) => n.children?.length === 1 && n.children[0].type === 'emphasis';
  const firstParagraph = children.find(
    (n) => n.type === 'paragraph' && !isNote(n as AnyNode) && plainText(n as AnyNode).trim().length > 20,
  ) as AnyNode | undefined;
  const text = firstParagraph ? plainText(firstParagraph).replace(/\s+/g, ' ').trim() : '';
  const sentence = /^.*?[.!?](\s|$)/.exec(text)?.[0].trim() ?? text;
  const summary = sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}...` : sentence;
  // Pages start with their own "# Title"; add one when they do not.
  if (!(firstHeading && firstHeading.depth === 1 && children.indexOf(firstHeading as RootContent) === 0)) {
    children.unshift({ type: 'heading', depth: 1, children: [{ type: 'text', value: title }] });
  }
  const markdown = printer.stringify({ type: 'root', children } as Root);
  return { title, summary, markdown, warnings };
}
