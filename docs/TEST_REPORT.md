# 本轮本地测试报告

日期：2026-10-18。范围为五板块门户、兼容数据协议第一批接入（现金流/生活日历）、九应用返回导航与实测缺陷修复。没有部署。本报告区分纯函数、浏览器与历史证据，不合并重复测试数。

## 自动化结果

| 范围 | 命令/证据 | 结果 |
| --- | --- | --- |
| 公共核心及标准数据协议 | `npm --prefix shared test` | 38 项通过，含版本/日期/依赖、旧格式、恢复点及清空保护 |
| 生活日历与公共核心 | `npm --prefix life-calendar test` | 73 项通过（包含 shared，不应与上一行重复累计） |
| 现金流 | `npm --prefix xibbofish/cashflow test` | 44 项通过，含 6 项预览/恢复/失败/并发保护测试 |
| 心情/月经/星笺/六爻/塔罗/人像 | `evidence/baseline/test-*.log` | 分别 4 / 7 / 6 / 29 / 55 / 35 项通过 |
| 门户及适用应用构建 | 门户、现金流、生活日历、心情、月经、星笺、人像各自 build | 通过；六爻、静观为无构建静态应用 |
| 门户路由与视口 | `evidence/portal/results.json`、同目录检查脚本 | 14 路由 × 4 视口共 56 项初验；补审查后的工具筛选/菜单检查见 `final-filter-check.json` |
| 旧应用返回导航 | `evidence/navigation/results.json`、`actions.json` | 7 应用 × 4 视口；7 次真实链接跳转与 2 项草稿保护通过 |
| 财务与整合工作台导航 | `evidence/finance-navigation/results.json` | 2 应用 × 4 视口通过，设置深链接与数据中心可用 |
| 跨应用实际文件传输 | `node scripts/test-data-transfer.cjs` | 12 项通过；无 pageerror、无对外 HTTP 请求、无 HTTP 写出；详见 `evidence/data-transfer/node-results.json` |

浏览器基线另包含线上首页与九个子应用共 40 个视口上下文。它证明当时页面可读取及基本布局情况，不等同于业务全回归。

## 关键数据保证的证据

- 现金流选择标准包只生成预览，取消或未知未来版本不改变主存储。
- 确认后先保存导入前恢复点，再替换主键；恢复点或主键配额失败不假报成功，不覆盖原主数据。
- 生活日历恢复点在写入锁内完成并发及修订检查后创建；等锁期间发生外部更改时，旧恢复点也不会被覆盖。
- 单包进入整合版仅替换所选现金流模块，心情/身体/星笺、工作台总结与布局不变。
- 独立导出、整合包和整合版提取的现金流 payload 完全等价；整包回独立版会明确说明被忽略的模块与 workspace。
- Agent Markdown 包含字段词典、计算口径与原始结构化记录；脱敏稿提示日期/金额等仍敏感且不可无损恢复。
- 明确清空时同步移除主记录和新增恢复点，避免清空后仍留有旧私人记录。
- 六爻只修上下卦名称字段展示；财务平线改为“持平”，原金额/周期计算核心未重写。

## 复跑

Node.js 24，在根目录执行：

```powershell
npm --prefix shared ci
npm --prefix shared test
npm --prefix life-calendar ci
npm --prefix life-calendar test
npm --prefix life-calendar run build
npm --prefix xibbofish/cashflow ci
npm --prefix xibbofish/cashflow test
npm --prefix xibbofish/cashflow run build
npm --prefix xibbofish/portal ci
npm --prefix xibbofish/portal run build
node scripts/transfer-fixtures.mjs
node scripts/preview-webpersonal.mjs
```

另一终端执行 `node scripts/test-data-transfer.cjs`。浏览器脚本当前使用本机 bundled Playwright 与 Chrome；可设置 PLAYWRIGHT_PATH，浏览器路径见脚本。只用生成的虚构 fixtures、全新 BrowserContext，不使用日常浏览器 profile。其它独立应用修改后需按各自 package.json 先 build。

## 限制及本次范围

- 标准协议支持四个领域模块；新标准包/Agent Markdown 的独立 UI 本批先接现金流与生活日历。心情/月经/星笺的旧格式互导保留，尚未为三个独立页面增加新的标准包按钮。塔罗/六爻未强行迁入统一存储。
- 不做实时跨应用共享，也没有跨设备云同步。现金流的同步存储检查以及不支持 Web Locks 的环境仍有多标签极小竞争窗口；两键恢复点不是数据库事务。
- 未做真实手机、完整屏幕阅读器、全站 WCAG 2.2 AA 符合性或全部旧应用每个业务流程的重新验收；详见 UX_AUDIT 的覆盖矩阵。
- 本轮网络断言仅针对已操作的数据传输路径，不能外推所有页面。未开放在线账户服务或联系表单。
- 现金流 lint 无错误，仍有一条既有保存副作用相关 React 警告；已去除未使用常量与渲染期间 ref 读取告警，没有借机改写保存语义。
- Python Playwright 依赖下载因本机代理失败，未采用该实验脚本；最终验收使用工作区已有 Node Playwright + Chrome，失败尝试另有记录。中途 Edge 文件读取/进程关闭及测试选择器问题已在传输证据 README 如实记录。

本次测试均不接触真实个人记录。生产可用性仍须在用户要求发布后，按发布检查清单核对当前线上版本并验收。
