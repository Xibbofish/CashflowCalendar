/**
 * Service Worker 生成器。
 *
 * 模板要求（docs/TECHNICAL.md §8）：
 * - 只缓存应用自带的页面外壳与脚本，**绝不缓存记录数据**；
 * - 只处理自己路径下的请求，跨源或其他路径一律不拦截；
 * - 资源清单来自构建产物（`sw-assets.json`），因此新增 shared 文件不会漏缓存；
 * - 清单里出现 404 时不让整个 install 失败（否则离线外壳永远装不上）。
 */

/**
 * @param appName 缓存名后缀（例如 `period-journal`）
 * @param assets 需要预缓存的相对路径（`./...`）
 */
export function renderServiceWorker(appName, assets) {
  const list = [...new Set(['./', './index.html', ...assets])];
  return `/* 由 shared/build/service-worker.mjs 生成：请勿手工编辑，改模板后重新构建。 */
const CACHE = '${appName}-shell-v1';
const ASSETS = ${JSON.stringify(list, null, 2)};
const ALLOWED = new Set(ASSETS.map((asset) => new URL(asset, self.location.href).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 单个资源缺失不应让整个外壳安装失败
      .then((cache) => Promise.all(ASSETS.map((asset) => cache.add(asset).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('${appName}-shell-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // 只处理应用自己的外壳文件：记录数据、接口请求、其它路径都不经过缓存
  if (!ALLOWED.has(url.pathname)) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached
      || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
`;
}

/**
 * 产物里**不该**被删除的文件（审计用）：静态外壳 + 依赖脚本 + 图标 + 清单 + 资源索引。
 *
 * 用途：构建后核对产物清单，确认没有把记录数据、旧版本文件或跨应用文件带进发布包。
 */
export function shellAssetsFromDist(assets) {
  // `sw-assets.json` 只是构建产物清单，不需要预缓存
  return assets.filter((asset) => asset !== './sw-assets.json');
}

/** 审计：产物里出现即视为异常的文件（记录数据、备份、临时文件）。 */
export function unexpectedArtifacts(assets) {
  return assets.filter((asset) => /\.(json|bak|tmp|log)$/.test(asset) && asset !== './manifest.webmanifest' && asset !== './sw-assets.json');
}
