# 2026-10-18 同步验证

验证在从 GitHub 新克隆的工作副本内进行，没有修改或部署线上网站。

| 验证对象 | 结果 | 测试项数（如适用） |
| --- | --- | --- |
| portal | 通过 | — |
| portrait-studio | 通过 | 35 |
| cashflow-standalone | 通过 | 38 |
| mood-journal | 通过 | 4 |
| period-journal | 通过 | 7 |
| zodiac-journal | 通过 | 6 |
| tarot | 通过 | 55 |
| liuyao | 通过 | 29 |
| classics | 通过 | — |
| production-personal | 通过 | — |
| production-cashflow | 通过 | — |
| cashflow-monorepo | 通过 | 38 |
| life-calendar | 通过 | 52 |
| shared 公共模块 | 通过 | 17 |
| 主站 SQLite 在线备份及本地复核 | integrity_check = ok | — |
| 完整服务器归档 | 下载 SHA-256 与服务器一致 | — |
| Git 暂存内容扫描 | 未发现所检查的密钥/凭据模式与私人数据库文件 | — |

## 为可移植恢复做的修正

- shared/package.json 声明已有 date-fns 依赖，并增加锁文件；npm test 使用明确的测试文件通配符。
- life-calendar/package-lock.json 改为正常注册表依赖，消除 ../xibbofish/cashflow/node_modules 链接；重新 npm ci、测试和构建均通过。使用原有兼容依赖锁作为基准，未变更业务逻辑。
- CashflowCalendar 包含 shared/ 的同步副本，四个适配文件的导入改为仓库内相对路径；38 项测试和构建通过。
- 六爻保留来源说明；塔罗保留此前审阅的部署构建脚本。

231 个网站生产文件通过清单校验，现金流独立仓库的 11 个生产文件也通过。经典内容验证 99 篇/节在两种分页尺寸下拼接无漏字。

本次没有重新执行完整交互浏览器验收，也没有声称开发产物与旧线上资源一致。生产快照用于原样恢复；源码用于继续开发。服务器 SSH/TLS 私钥、配置和数据库未加入 Git；本地完整备份另有恢复说明。
