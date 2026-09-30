#!/usr/bin/env node
/**
 * 本机预览服务器 —— **零依赖**的静态文件服务器。
 *
 * ## 为什么不直接 `python3 -m http.server`
 * 能用，但要先 `npm run build` 再切目录，而且它不知道"未构建"这件事该怎么表现。
 * 这个脚本 `npm start` 一步到位：构建 → 起服务 → 打印各页地址。
 *
 * ## 为什么强调"模仿 GitHub Pages 的目录语义"
 * 静态站的坑几乎都在路径解析上：`/trend.html/` 这种带尾斜杠的地址、
 * 目录下的 `index.html` 回落、相对路径相对谁解析 —— 本地用什么服务器预览，
 * 就该和线上**同一个语义**，否则"本地好好的、线上白屏"这类问题查不出来。
 * 所以这里显式实现了两条：
 *   · 目录请求 → 该目录下的 `index.html`
 *   · 找不到 → 404（附一句人话，说明趋势大盘在哪个地址）
 *
 * 刻意**不**做美化 URL（`/trend` → `trend.html`）：GitHub Pages 不做这件事，
 * 本地做了就会掩盖"链接写错了但本地能用"的问题。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite } from './build-site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

/**
 * 把一个 URL 路径解析成 dist 下的真实文件路径。
 * 返回 null 表示"这个地址没有对应的文件"。
 */
export function resolveRequest(distDir, urlPath) {
  let p = decodeURIComponent(String(urlPath).split(/[?#]/)[0]);
  if (!p.startsWith('/')) p = `/${p}`;
  // 归一化并挡住 `..` 穿越：解析后必须仍在 distDir 内
  const target = path.normalize(path.join(distDir, p));
  if (target !== distDir && !target.startsWith(distDir + path.sep)) return null;
  return p.endsWith('/') ? path.join(target, 'index.html') : target;
}

async function main() {
  const { outDir, files } = await buildSite();
  const distDir = path.resolve(outDir);
  const port = Number(process.env.PORT || 8788);

  const server = http.createServer(async (req, res) => {
    const file = resolveRequest(distDir, req.url || '/');
    const notFound = (msg) => {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>404</title>` +
          `<body style="font:15px/1.6 system-ui;padding:40px;max-width:40em">` +
          `<h1 style="font-size:20px">404</h1><p>${msg}</p>` +
          `<p>趋势大盘在 <a href="/trend.html">/trend.html</a>。</p></body>`
      );
    };
    if (!file) return notFound('这个地址越出了站点根目录。');

    try {
      const buf = await fs.readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        // 本地刻意不缓存：改完文件刷新就能看到。
        // ★ 线上**不是**这样：GitHub Pages 会给 HTML 与资源加上自己的缓存头，
        //   所以"本地刷新就变"不代表"线上刷新就变" —— 换部署后看不到新内容的
        //   时候，先怀疑缓存，别怀疑构建（见 docs/deploy.md 排错表）。
        'cache-control': 'no-cache',
      });
      res.end(buf);
    } catch {
      notFound(`没有这个文件：${file.slice(distDir.length) || '/'}`);
    }
  });

  server.listen(port, () => {
    console.log(`\n  本地预览已启动 · http://localhost:${port}`);
    console.log(`  中文入口  /index.html   · 中文大盘 /trend.html`);
    console.log(`  英文入口  /en/          · 英文大盘 /en/trend.html`);
    console.log(`  （产物在 dist/，共 ${files.length} 个文件；改源码后重新跑 npm start）\n`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\n  ✗ ${e.message}\n`);
    process.exitCode = 1;
  });
}
