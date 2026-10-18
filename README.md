# 现金流日历

线上地址：https://xibbofish.cn/cashflow/ 。本私人仓库于 2026-10-18 更新至当前本地开发源码，并原样保存当前线上版本 20261010-day-49aed1d。

开发源码包括共享引擎适配、存储保护及其回归测试，尚未随此次 GitHub 更新部署。shared/ 为从 WebPersonal/shared 复制的依赖副本，四个适配文件使用仓库内相对路径；没有变更规则逻辑。

Node.js 24 下执行 npm ci、npm test、npm run build；npm run dev 的基础路径为 /cashflow/。数据保存在浏览器；此仓库不包含真实财务记录、数据库或密钥。

production/cashflow/ 为捕获时的线上原始资源，production/manifest.json 保存大小与 SHA-256。node scripts/verify-production.mjs 检查快照完整性；开发构建可能与旧发布不同。完整网站开发源码位于 [PersonalWebsite](https://github.com/Xibbofish/PersonalWebsite)。同步边界见 docs/SYNC-20261018.md。


## 本地数据互通优化（未部署）

标准单包与 Agent Markdown、整合包提取现金流、导入预览/取消、明确替换、恢复点下载和存储失败保护已实现，金额与周期算法保留。npm test 44 项通过。shared/ 是来自 WebPersonal 的依赖副本，导入路径按独立仓库布局适配。生产快照仍是实际已发布旧版本；详见 docs/TEST_REPORT.md。
