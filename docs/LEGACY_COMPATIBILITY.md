# 旧格式兼容表

2026-10-18，本地实现，未部署。唯一领域逻辑仍在 shared/modules 和兼容注册表。

| 输入/输出 | 结构与版本 | 支持情况 |
|---|---|---|
| 原现金流 JSON | initialBalance/events/simulationEvents，无顶层版本 | 保留原读写；标准包经 personalDataToLegacy 安全转换可供独立版读取 |
| 原心情 JSON | version:1,entries,tags | 原严格读写保持 |
| 原经期 JSON | version:1,periods,daily | 原严格读写保持；today 检查不接受未来经期 |
| 原星笺 JSON | schemaVersion:1,sign,saved | 原严格读写保持，收藏 cardSnapshot 不被内容库更新改写 |
| 原生活日历 JSON | format:life-calendar,schemaVersion:1 | 原完整备份读写保持（含隐藏数据、生活总结/标签、设置、来源） |
| 标准单包/整包 | format:xibbofish.personal-data,formatVersion:1.0.0 | 生活日历同一导入预览路径读取；四模块领域结构不变 |
| Agent Markdown | 可读词典、计算说明、原始 JSON | 导出供阅读分析；不新增 Markdown 机器恢复承诺；原现金流旧 Markdown 导出未删除 |

## 安全边界

旧字段和关键值不迁移：保留正负/零金额、永久计划 occurrenceCount、历史 skippedDates、模拟标记。验证禁止以默认补全掩盖坏数据。单模块导入不重置其他模块、生活总结或布局；整包 workspace 只在完整四模块包中合法。合并沿用稳定 ID 和显式冲突处理，重复备份不会无声生成副本；重复模块包组合拒绝。

新标准导出是新增入口，原 exportUnifiedBackup/exportModuleLegacy/readModuleLegacy/writeModuleLegacy 都保留。标准包提取为旧现金流结构时，只恢复 cashflow，其他模块/工作台必须由 UI 明确提示不导入。不要直接把标准包交给旧应用的宽松默认补全逻辑。

已规范化对象会在规划时重校验领域数据，普通 __normalized 字段不能伪造内部标记。预览期不写入；落盘前再次全量校验并检查 revision；单键失败不返回伪成功、不破坏旧字符串。

## 验证

npm test --prefix shared：标准包和核心回归。

npm test --prefix life-calendar：生活日历原有冻结引擎/导入/存储/门面回归 + shared 测试。使用合成 fixtures，不读取真实浏览器记录。

浏览器 UI 的下载、二次确认、错误可见性以及全应用网络请求，须在集成后单独实测；协议纯函数测试不等于全站已验收。
