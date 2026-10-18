# 本地工具标准数据协议 v1

实施日期：2026-10-18。仅本地实现，未部署。实现位置为现有 shared/compatibility/personal-data.js，复用 MODULE_REGISTRY、严格领域校验及原导入预览/单键提交，不另设存储层。

## 数据包

```json
{
  "format": "xibbofish.personal-data",
  "formatVersion": "1.0.0",
  "exportedAt": "2026-10-18T08:00:00.000Z",
  "producer": { "app": "cashflow", "appVersion": "optional" },
  "modules": {
    "cashflow": {
      "schemaVersion": 1,
      "data": { "schemaVersion": 1, "initialBalance": 0, "events": [], "simulationEvents": [] },
      "dependencies": []
    }
  }
}
```

formatVersion 管传输协议，schemaVersion 管模块领域。v1 只接受精确 1.0.0/整数 1；未知字段、未来版本、未知模块、无模块、非法/重复记录 ID、缺失或自身依赖均拒绝。dependencies 是同包必须存在的模块 ID 数组；四个现有模块无跨模块引用，正常导出均为空。将来增加真实跨模块引用需先定义并校验记录级关系，不能仅靠此数组宣称支持。

同模块单包/整包的 {schemaVersion,data,dependencies} 内容相同。data 完整保留原领域结构：现金流初始余额、事件源、模拟源；心情 entries/tags；经期 periods/daily；星笺 sign/saved/cardSnapshot。不会压扁成统一 records。

整包默认带 workspace：原生活日历 envelope 除 modules 外的所有字段（format、schemaVersion、revision、updatedAt、settings、life、provenance）。只有四模块齐全时允许 workspace，且用原 validateEnvelope 全量验证。这样隐藏模块、总结、独立生活标签、设置、历史来源不会静默丢失。提取单模块明确不含工作台内容；模块包缺 workspace 导入不触及工作台。导入仍产生新的 revision、updatedAt、来源记录，这是新提交的审计语义，不照搬旧修订号。

## 公共 API

以下均为纯函数、无网络/存储副作用。返回对象由 UI 自行 JSON.stringify、命名和下载，Markdown 返回字符串。

- validatePersonalData(input, {today?}) -> 已严格校验的包对象。
- exportPersonalData(envelope, {moduleIds?, includeWorkspace?, producer?, now?, today?}) -> 包对象。默认四模块+workspace；子集默认不含 workspace。
- exportModulePackage(moduleId, domainData, options) -> 单模块包对象。
- extractModulePackage(package, moduleId, options) -> 单模块包；若有无法保留的跨模块依赖明确拒绝。
- combinePersonalData(packages, options) -> 整合包；重复模块明确拒绝，不能静默选择来源。
- personalDataToLegacy(package, moduleId, options) -> 对应独立旧应用可读的 JSON 对象。先校验整包再提取，其他模块不恢复；UI必须说明被忽略模块及 workspace。
- exportAgentMarkdown(package, {redact?: boolean, today?}) -> 字段词典、模型关联、计算规则、来源/日期/币种限制、完整 fenced JSON、隐私和恢复提示。

now 支持 Date 或 ISO 字符串；需要历史日期限制时显式传 today（YYYY-MM-DD）。标准包识别返回 format='personal-data'，交给现有 readImportFile/createImportPreview/commitImport 路径即可，不能直接写本机存储。

## 计算和隐私

本次保持现金流原有浮点金额/原币种单位、带符号金额、周期次数、永久周期、月末/闰年、跳过日期、真实/模拟算法；不擅自转成分，不推断未存储的币种。日期为本地日历字符串，时间戳为 ISO；原模型没有时区元数据，不能反推历史设备时区。

Markdown 默认包含原始 JSON。可选 redact 会遮盖文本正文/备注/名称等字段，但金额、日期、ID 等仍敏感，明确不能匿名化、不可无损恢复；完整恢复请保留 JSON 包。Markdown 不是机器恢复入口。

## 导入保护及测试

先解析/版本/领域全量校验，再预览各模块新增/相同/冲突；未解决冲突拒绝提交，跳过模块保留本机值；完整替换需 UI 二次确认。调用者修改已规范化的对象后也会再次校验领域数据。复用原 life-calendar:v1 单键一次写入，存储满时旧字符串保留，预览修订过期不提交。跨独立应用存储没有事务或实时共享承诺。

shared/tests/personal-data.test.mjs 使用虚构 fixtures 自动覆盖 DATA-01~12 的协议适用项；DATA-09 是纯协议网络 spy/静态验证，不能替代浏览器整应用网络审计。UI可见行为由对应应用集成回归验证。

## 二次审查补强（2026-10-18）

协议版本按数值 SemVer 判断未来版本，不使用字符串词典序；非法标记仍拒绝。包导出时间及 workspace.updatedAt 必须是真实日历日期且包含时区的 ISO 时间，拒绝 Date.parse 会自动进位的 2 月 30 日或 24:00。workspace 字段全部必填，provenance 缺失不能默认清空。producer 字符串和依赖列表增加长度上限。JSON 中 __proto__ 等未知键同样拒绝。

导入选择必须保留依赖闭包：若选中模块声明依赖另一模块，不允许把其依赖设为 skip。四个现有模块默认没有依赖。

生活日历恢复点 life-calendar:import-recovery:v1 在浏览器写入锁内、并发基线/修订及候选全量校验完成后保存，再写主键。恢复点失败则主键不写；主键配额失败仍保留原主键；等待锁时外部更改使提交拒绝且不会覆盖旧恢复点。两键不是浏览器数据库事务；不支持 Web Locks 的浏览器仍有已披露多标签极小并发窗口。恢复点只保留最近一次导入前状态，可下载标准完整旧备份，不是无限历史。
