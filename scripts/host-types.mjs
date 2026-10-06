import { access, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, relative, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOST = '@earendil-works/pi-coding-agent';
const PROVIDED = [HOST, '@earendil-works/pi-ai', '@earendil-works/pi-tui', '@earendil-works/pi-agent-core', 'typebox'];
const manifest = async root => JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

async function hostOnPath() {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const binary = resolve(directory || '.', 'pi');
    try { await access(binary, constants.X_OK); } catch { continue; }
    let cursor = dirname(await realpath(binary));
    while (true) {
      try { if ((await manifest(cursor)).name === HOST) return cursor; } catch {}
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  throw new Error('No se encontró el paquete de Pi en PATH; configura PI_AGENTS_PI_PACKAGE_ROOT.');
}

async function packageAt(name, host) {
  if (name === HOST) return host;
  for (let cursor = host; ; cursor = dirname(cursor)) {
    const candidate = join(cursor, 'node_modules', name);
    try {
      if ((await manifest(candidate)).name === name) return await realpath(candidate);
    } catch {}
    if (dirname(cursor) === cursor) break;
  }
  throw new Error('Pi no proporciona el paquete requerido: ' + name);
}

function typeExport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (typeof value.types === 'string') return value.types;
  for (const condition of ['import', 'node', 'default']) {
    const found = typeExport(value[condition]);
    if (found) return found;
  }
  return undefined;
}

export async function resolveHost({ packageRoot } = {}) {
  let root, meta;
  try {
    root = await realpath(packageRoot ?? process.env.PI_AGENTS_PI_PACKAGE_ROOT ?? await hostOnPath());
    meta = await manifest(root);
    if (meta.name !== HOST) throw new Error('nombre de paquete incorrecto');
  } catch (cause) { throw new Error('No se pudo resolver un paquete Pi válido.', { cause }); }

  const declarations = {};
  const packages = {};
  for (const name of PROVIDED) {
    const directory = await packageAt(name, root);
    const pkg = await manifest(directory);
    packages[name] = { root: directory, version: pkg.version };
    const exports = pkg.exports ?? { '.': { types: pkg.types } };
    const entries = Object.keys(exports).some(key => key.startsWith('.')) ? exports : { '.': exports };
    for (const [key, value] of Object.entries(entries)) {
      const target = typeExport(value) ?? (key === '.' ? pkg.types : pkg.typesVersions?.['*']?.[key.slice(2)]?.[0]);
      if (!target || !key.startsWith('.') || !target.startsWith('./')) continue;
      const absolute = resolve(directory, target);
      if (!absolute.startsWith(directory + '/')) throw new Error('Export de tipos fuera del paquete Pi: ' + name);
      if (!absolute.includes('*')) await access(absolute);
      declarations[name + (key === '.' ? '' : key.slice(1))] = absolute;
    }
    if (!declarations[name]) throw new Error('Pi no publica declaraciones raíz para ' + name);
  }
  return { root, version: meta.version, declarations, packages };
}

export async function generateHostConfig({ root = process.cwd(), outFile = join(root, '.cache/pi-agents/tsconfig.host.json') } = {}) {
  root = resolve(root);
  outFile = resolve(outFile);
  const host = await resolveHost();
  const config = {
    extends: relative(dirname(outFile), join(root, 'tsconfig.json')),
    compilerOptions: {
      paths: Object.fromEntries(Object.entries(host.declarations).map(([key, value]) => [key, [value]])),
      typeRoots: [join(root, 'node_modules/@types')],
    },
  };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(config, null, 2) + '\n');
  return host;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const host = await generateHostConfig();
    console.log('Tipos del host:', JSON.stringify(Object.fromEntries(Object.entries(host.packages).map(([key, value]) => [key, value.version]))));
  } catch (error) {
    console.error(error.message, error.cause?.message ?? '');
    process.exitCode = 1;
  }
}
