// Reads the docs site's navigation (SIDEBAR in website/src/config.ts) without
// running upstream code: strip the TypeScript types, parse, and read the literal.
import { stripTypeScriptTypes } from 'node:module';
import { parse, type Node } from 'acorn';

export type SidebarSection = { title: string; links: { text: string; link: string }[] };

type AnyNode = Node & Record<string, any>;

function literal(node: AnyNode): unknown {
  switch (node.type) {
    case 'ObjectExpression':
      return Object.fromEntries(
        node.properties.map((p: AnyNode) => {
          if (p.type !== 'Property' || p.computed) throw new Error('SIDEBAR: unsupported property');
          const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
          return [key, literal(p.value)];
        }),
      );
    case 'ArrayExpression':
      return node.elements.map((e: AnyNode) => literal(e));
    case 'Literal':
      return node.value;
    case 'TemplateLiteral':
      if (node.expressions.length) throw new Error('SIDEBAR: template with expressions');
      return node.quasis[0].value.cooked;
    default:
      throw new Error(`SIDEBAR: unsupported ${node.type}`);
  }
}

/** The sidebar sections for one language, in order. */
/** stripTypeScriptTypes without Node's "experimental feature" warning on stderr. */
function stripTypes(source: string): string {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
    if (!String(warning).includes('stripTypeScriptTypes')) (emitWarning as any).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return stripTypeScriptTypes(source);
  } finally {
    process.emitWarning = emitWarning;
  }
}

export function readSidebar(configSource: string, language = 'en'): SidebarSection[] {
  const ast = parse(stripTypes(configSource), { ecmaVersion: 'latest', sourceType: 'module' }) as AnyNode;
  for (const statement of ast.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const d of declaration.declarations) {
      if (d.id.name !== 'SIDEBAR') continue;
      const sidebar = literal(d.init) as Record<string, Record<string, { text: string; link: string }[]>>;
      const sections = sidebar[language];
      if (!sections) throw new Error(`SIDEBAR has no "${language}" section`);
      return Object.entries(sections).map(([title, links]) => ({ title, links }));
    }
  }
  throw new Error('no SIDEBAR in config.ts');
}
