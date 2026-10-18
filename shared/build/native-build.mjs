/**
 * 原生应用（心情日记本 / 月经记录本 / 每日星笺）的构建与预览工具。
 *
 * 背景：三个应用的核心已经抽到仓库根目录的 `shared/`，源码用 `../shared/...` 引用。
 * 生产产物必须**自包含**：发布目录里不能再依赖兄弟应用的路径，因此构建时：
 * 1. 复制应用自己的静态文件；
 * 2. 把用到的 shared 文件复制到 `dist/shared/`；
 * 3. 复制时重写 import 路径（`../shared/x` → 相对 `dist/shared/x` 的路径）；
 * 4. 产出 `dist/sw-assets.json`，供 Service Worker 使用（只列自身路径，绝不列记录数据）。
 */
import { mkdir, copyFile, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** import/export 语句里带相对路径的形式。 */
const IMPORT_PATTERN = /(\b(?:import|export)\b[^'"()]*?from\s*|\bimport\s*\(\s*)(['"])((?:\.\.?\/)[^'"]*)\2/g;

export function appRoot(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl));
}

/** 目录是否已存在。 */
export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** 收集某个入口的本地模块依赖闭包（只看相对 import/export）。 */
export async function collectLocalClosure(entry, { root }) {
  const seen = new Set();
  const found = [];
  const queue = [path.resolve(root, entry)];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!(await pathExists(file))) continue;
    if (path.extname(file) !== '.js') continue;
    found.push(path.relative(root, file).split(path.sep).join('/'));
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = match[3];
      if (!target.startsWith('.')) continue;
      queue.push(path.resolve(path.dirname(file), target));
    }
  }
  return found.sort();
}

/** 把相对 import 重写成“产物内的真实位置”，保证发布目录自包含。 */
export function rewriteImports(source, { fromRoot, outDir, outFile, prefix = 'shared' }) {
  if (!prefix) throw new Error('rewriteImports 需要 prefix：用于判断哪些路径属于产物内部。');
  const fileDirInDist = path.dirname(path.join(outDir, outFile));
  return source.replace(IMPORT_PATTERN, (whole, head, quote, specifier) => {
    const insideRoot = path.relative(fromRoot, path.resolve(fromRoot, fileDirInDist.slice(outDir.length + 1), specifier)).split(path.sep).join('/');
    // 仓库根下、且属于被搬进产物的目录（shared/）才重写；其它指向应用目录之外的引用原样保留，
    // 由构建末尾的“产物自包含”检查报错提醒，而不是静默产出 404。
    if (!insideRoot.startsWith(`${prefix}/`)) return whole;
    let relative = path.relative(fileDirInDist, path.join(outDir, insideRoot)).split(path.sep).join('/');
    if (!relative.startsWith('.')) relative = `./${relative}`;
    return `${head}${quote}${relative}${quote}`;
  });
}

/**
 * 构建一个原生应用。
 *
 * @param root 应用目录（例如 `period-journal/`）
 * @param options.name 应用名（用于日志）
 * @param options.staticFiles 直接复制的静态文件（含 index.html / 图标 / manifest）
 * @param options.sharedFiles 需要复制进来的 shared 文件（仓库根相对路径）
 * @param options.entryModules 需要扫描依赖闭包的应用内模块（通常 app.js 与 model/core/data）
 */
export async function buildNativeApp(root, { name, staticFiles, sharedFiles, entryModules }) {
  const dist = path.join(root, 'dist');
  await mkdir(dist, { recursive: true });
  await mkdir(path.join(dist, 'shared'), { recursive: true });

  const copied = [];
  for (const file of staticFiles) {
    const from = path.join(root, file);
    if (!(await pathExists(from))) continue;
    await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
    await copyFile(from, path.join(dist, file));
    copied.push(file);
  }

  // shared 文件：复制时重写 import 路径（shared 内部也有相对引用）
  const repoRoot = path.resolve(root, '..');
  const sharedSet = new Set();
  for (const file of sharedFiles) {
    const from = path.join(repoRoot, file);
    if (!(await pathExists(from))) continue;
    sharedSet.add(file);
    const source = await readFile(from, 'utf8');
    const rewritten = rewriteImports(source, {
      fromRoot: repoRoot,
      outDir: dist,
      outFile: file,
      prefix: 'shared',
    });
    const target = path.join(dist, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, rewritten, 'utf8');
  }

  // 应用自身模块：同样重写 import，指向 dist/shared
  for (const module of entryModules) {
    const from = path.join(root, module);
    if (!(await pathExists(from))) continue;
    const source = await readFile(from, 'utf8');
    const rewritten = rewriteImports(source, {
      fromRoot: repoRoot,
      outDir: dist,
      outFile: module,
      prefix: 'shared',
    });
    await writeFile(path.join(dist, module), rewritten, 'utf8');
    if (!copied.includes(module)) copied.push(module);
  }

  // 校验：产物内不得残留指向应用目录之外的相对引用
  const problems = [];
  for (const file of await listFiles(dist)) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(path.join(dist, file), 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[3];
      const resolved = path.resolve(path.dirname(path.join(dist, file)), specifier);
      if (path.relative(dist, resolved).startsWith('..')) problems.push(`${file} → ${specifier}`);
    }
  }
  if (problems.length) {
    throw new Error(`产物仍引用应用目录之外的文件（发布后将 404）：\n  ${problems.join('\n  ')}`);
  }

  const assets = (await listFiles(dist)).map((file) => `./${file.split(path.sep).join('/')}`);
  await writeFile(path.join(dist, 'sw-assets.json'), `${JSON.stringify({ name, assets, generatedAt: null }, null, 2)}\n`, 'utf8');
  console.log(`Built ${name} → ${path.relative(process.cwd(), dist)}（${assets.length} 个文件，含 ${sharedSet.size} 个 shared 文件）`);
  return { dist, assets };
}

async function listFiles(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(path.join(dir, entry.name), relative));
    else result.push(relative);
  }
  return result.sort();
}

/** 预览服务器允许访问的文件白名单：只列应用自己的路径，绝不跨应用读取。 */
export async function distAllowlist(root) {
  const dist = path.join(root, 'dist');
  if (!(await pathExists(dist))) return null;
  const files = await listFiles(dist);
  return new Set(files.map((file) => file.split(path.sep).join('/')));
}

export async function serveNativeApp({ root, name, port, allowlist, spaFallback = 'index.html' }) {
  const { readFile: read } = await import('node:fs/promises');
  const http = await import('node:http');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const requestPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || spaFallback;
      if (!allowlist.has(requestPath)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      const body = await read(path.join(root, 'dist', requestPath));
      response.writeHead(200, {
        'Content-Type': types[path.extname(requestPath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`${name}: http://127.0.0.1:${port}/`));
  return server;
}
