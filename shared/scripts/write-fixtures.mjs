/**
 * 生成 life-calendar/fixtures/*.json 黄金文件。
 *
 * 这些 JSON 是**虚构样例**，用于：
 * - 人工检查旧格式与统一格式的字段结构；
 * - 兼容矩阵文档（docs/COMPATIBILITY.md）里的字段对照；
 * - 需要真实文件才能验证的路径（大小限制、中文文件名、原始数据下载）。
 *
 * 生成方式：`node shared/scripts/write-fixtures.mjs`（唯一来源是 shared/fixtures/index.js）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_NOW,
  FIXTURE_TODAY_ISO,
  cashflowFixture,
  cashflowFixtureConflicts,
  corruptFixtureSample,
  futureEnvelopeFixture,
  futureLegacyFixture,
  lifeFixture,
  moodFixture,
  moodFixtureRemap,
  periodFixture,
  periodFixtureConflicts,
  stressFixture,
  unifiedFixture,
  unknownFieldFixture,
  zodiacFixture,
  zodiacFixtureConflicts,
} from '../fixtures/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(repoRoot, 'life-calendar', 'fixtures');

/** 文件名 → 内容。文件名以模块开头，便于对照兼容矩阵。 */
const files = {
  'mood-legacy.json': moodFixture(),
  'mood-legacy-remap.json': moodFixtureRemap(),
  'period-legacy.json': periodFixture(),
  'period-legacy-conflicts.json': periodFixtureConflicts(),
  'zodiac-legacy.json': zodiacFixture(),
  'zodiac-legacy-conflicts.json': zodiacFixtureConflicts(),
  'cashflow-legacy.json': cashflowFixture(),
  'cashflow-legacy-conflicts.json': cashflowFixtureConflicts(),
  'unified-backup.json': unifiedFixture({ revision: 7 }),
  'unified-life.json': lifeFixture(),
  'future-envelope.json': futureEnvelopeFixture(),
  'future-legacy.json': futureLegacyFixture(),
  'unknown-field.json': unknownFieldFixture(),
  'stress-large.json': stressFixture(),
};

const notes = {
  generatedBy: 'shared/scripts/write-fixtures.mjs',
  referenceDate: FIXTURE_NOW,
  referenceTimestamp: FIXTURE_TODAY_ISO,
  fictional: true,
  note: '全部为虚构数据，不含任何真实个人记录；请勿手工修改这些 JSON，改 shared/fixtures/index.js 后重新生成。',
};

await mkdir(outDir, { recursive: true });
for (const [name, value] of Object.entries(files)) {
  await writeFile(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// 损坏样例不是合法 JSON，单独写出原样字节
const corrupt = corruptFixtureSample();
await writeFile(path.join(outDir, 'corrupt-raw.json'), typeof corrupt === 'string' ? corrupt : JSON.stringify(corrupt), 'utf8');
await writeFile(path.join(outDir, 'README.md'), `${[
  '# 虚构样例文件',
  '',
  '这些文件由 `shared/scripts/write-fixtures.mjs` 生成，唯一来源是 `shared/fixtures/index.js`。',
  '重新生成：在仓库根目录运行 `node shared/scripts/write-fixtures.mjs`。',
  '',
  '| 文件 | 用途 |',
  '| --- | --- |',
  '| `mood-legacy.json` | 心情日记本旧备份（`version: 1`），含空正文与多标签记录 |',
  '| `mood-legacy-remap.json` | 同名标签、外部 ID 被占用时的重映射样例 |',
  '| `period-legacy.json` | 月经记录本旧备份（进行中记录 + 每日感受） |',
  '| `period-legacy-conflicts.json` | 区间重叠、同日每日记录不同内容的冲突样例 |',
  '| `zodiac-legacy.json` | 星笺旧备份（含收藏快照与感想） |',
  '| `zodiac-legacy-conflicts.json` | 同一天快照与感想都不同的冲突样例 |',
  '| `cashflow-legacy.json` | 现金流旧备份（永久周期、零金额、冲红、模拟、历史跳过） |',
  '| `cashflow-legacy-conflicts.json` | 初始余额差异、同 ID 跨集合不一致样例 |',
  '| `unified-backup.json` | 统一完整备份（含隐藏模块、总结、设置） |',
  '| `unified-life.json` | 统一专属内容（当天总结与每日标签） |',
  '| `future-envelope.json` | 未来版本统一备份：必须只读，不得覆盖 |',
  '| `future-legacy.json` | 未来版本旧备份：必须拒绝读取 |',
  '| `unknown-field.json` | 含未知字段：必须拒绝，不得静默丢弃 |',
  '| `stress-large.json` | 大批量样例：用于检查性能与上限 |',
  '| `corrupt-raw.json` | 损坏的原始字符串：用于验证“保留原始数据 + 只读恢复” |',
  '',
  '所有内容均为虚构，用于本地验证与人工核对。',
  '',
].join('\n')}\n`, 'utf8');

console.log(`已生成 ${Object.keys(files).length + 2} 个虚构样例到 life-calendar/fixtures/`);
