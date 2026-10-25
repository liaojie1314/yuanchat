/**
 * MSW Node 服务 — 与 handlers 同源收敛导出。
 *
 * @description
 * msw 只在 shared / web / desktop 的 devDependencies 里，@yuanchat/ui 没有：
 * ui 的用例若直接 `import "msw/node"`，pnpm 严格 node_modules 下解析不到。
 * 把 setupServer 收敛到数据（handlers）所在的包里导出，调用方只依赖
 * @yuanchat/shared/mocks/server —— 即 MSW 官方文档同款的 server.js 模式。
 */
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/** 预装配好全部 REST handlers 的 Node 端 MSW 服务，用例里自行 listen/close */
export const server = setupServer(...handlers);
