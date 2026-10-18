/**
 * 旧路径 re-export：现金流引擎的唯一手工维护来源在 shared/modules/cashflow/engine.js。
 *
 * 保留该文件是为了让原应用源码与既有测试继续可用；不要在本地新增或修改算法。
 * 新增逻辑一律写 shared/，然后在这里 re-export。
 */
export * from '../shared/modules/cashflow/engine.js';
