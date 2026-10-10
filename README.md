# 现金流日历

线上地址：https://xibbofish.cn/cashflow/ 。此私人仓库在 2026-10-10 同步到当前已部署源码提交 49aed1d87cdd17df6d390ed4db20c3f533d3546a，线上版本 20261010-day-49aed1d。

保留现金流计算、模拟计划、周期次数、Markdown 导出、分析筛选与跨天刷新。数据只在浏览器 localStorage 中，GitHub 不保存用户财务记录。

## 本地运行

使用 Node.js 24，npm ci 后运行 npm run dev；应用基础路径为 /cashflow/。npm test 运行 23 项测试，npm run build 生成 dist/。构建后运行 node scripts/verify-production.mjs 验证产物。

production/cashflow/ 是服务器当前发布文件的原样快照，production/manifest.json 保存版本和 SHA-256。当前 index.html、JS、CSS 三个文件与源码重建逐字节一致；保留的七个旧资源用于已有浏览器缓存，它们不属于当前源码构建。release.json 保存原部署提交和发布包摘要。

工作区后续尚未部署的存储保护和共享核心适配修改没有混入此同步。其他六个站点应用位于 [PersonalWebsite](https://github.com/Xibbofish/PersonalWebsite)。本次保留原仓库历史，普通提交推送默认分支，不改变线上网站。
