/**
 * 趋势大盘 —— 客户端数据层。
 *
 * ## 为什么全部在浏览器里跑
 * 榜单数据由**浏览器直接请求上游公开接口**，服务端只发静态页。
 * 代价是跨域能否成功由上游决定，所以每个源都必须实测过（见 docs/trend-sources.md）。
 *
 * ## 三条设计约束
 *  1. **一个面板坏了不拖垮整页**：每个面板各自 fetch、各自渲染、各自显示错误。
 *  2. **不静默失败**：拿不到数据时明确说出是哪个源、什么错误，以及部分成功时的
 *     "已取 N/M 页" —— 这个项目的历史教训是"静默降级"最难查。
 *  3. **不猜数据**：源里没有的字段就不显示；不做单位换算。
 *
 * ## 评测榜为什么这么绕（重要）
 * `datasets-server/rows` 有两条硬约束，实测得来：
 *   · 一页最多 100 条（length=500 → 422）；全量 4576 行 = 46 页；
 *   · 分页是**按 eval_name 字母序**，不是按分数 —— 所以"榜"必须自己取全量再排序。
 * 于是这里并发拉 46 页（分批，避免打爆连接），合并后按 Average 降序。
 * 结果写 sessionStorage（TTL 10 分钟），否则每次进页面都要拉 46 次。
 *
 * ## 为什么手写最小 YAML 解析而不引依赖
 * 本站零外部依赖（这是既有约定，见 README）。Aider 的榜是 YAML，但形态极简单 ——
 * 扁平数组、元素是标量映射、没有嵌套/锚点/多行块。所以解析器只需要认识这一种子集。
 * 若上游改用超出该子集的写法，本面板会**明确报错并只影响自己**，不会静默出错值。
 */

import { icon } from './ui.js';
import { t } from './i18n.js';

/**
 * 当前页面的语言。
 *
 * 为什么不从 URL 里现推、而要读 <html lang>：语言在**服务端**就定了（/en/* 是英文），
 * 客户端只需照办。读 lang 保证两边说的是同一件事 —— 若客户端自己推一遍，
 * 一旦规则不同步就会出现"英文页头 + 中文面板"。
 */
export const LOCALE =
  typeof document === 'undefined'
    ? 'zh' // Node（测试/构建脚本）里没有 DOM，按默认语言即可
    : String(document.documentElement.getAttribute('lang') || 'zh').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh';

/** 取当前语言的一条文案（面板全部文案都走这里） */
const L = (key, vars) => t(LOCALE, key, vars);

/* ================================================================== */
/* 小的工具函数                                                        */
/* ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);

/** 把数字格式化成好读的样子；非数字返回 null（调用方据此不显示） */
export function num(v, digits = 2) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** 大数缩写：12345 → 12.3k */
export function compact(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** 转义：模型名/描述来自上游，直接插进 DOM 会把它们的标记当 HTML 执行 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 带缓存的取 JSON。
 * 为什么不用 fetch 的 cache 选项：那是 HTTP 缓存，受上游响应头支配；
 * 我们要的是"这个页面这次会话里别再重复拉 46 页"，所以自己存。
 *
 * ★ 这一版加了一层捕获：`sessionStorage` 这个**属性访问本身**在部分浏览器里会抛
 * SecurityError（Cookie/站点数据被完全拦掉时，例如"阻止所有 Cookie"的 Chrome、
 * 内嵌 WebView、或某些隐私模式）。原来的写法把这个访问放在 try 外面，
 * 于是一个存储策略就能让整页脚本在求值时死掉 —— 而它只是缓存，不该有这种权力。
 * 存储层整体降级为"永远未命中"（每次直接走网络），其余一切照常。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PREFIX = 'trend-panel-cache:';
const cacheKey = (k) => `${CACHE_PREFIX}${k}`;

/** 取/存缓存，任何存储异常都当作"没有缓存"，绝不向外抛 */
function readCache(key, ttl) {
  try {
    const raw = sessionStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < ttl ? v : null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(cacheKey(key), JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* 存不下就算了（配额/隐私模式/存储被禁），不影响本次展示 */
  }
}

/** 清空本页缓存（"刷新数据"按钮用）。返回清掉的条数，便于测试与排错。 */
export function clearCache() {
  let n = 0;
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(CACHE_PREFIX)) {
        sessionStorage.removeItem(k);
        n += 1;
      }
    }
  } catch {
    /* 存储不可用时没有缓存可清 —— 面板本来就每次都走网络 */
  }
  return n;
}

async function cachedJson(key, url, { ttl = CACHE_TTL_MS } = {}) {
  const hit = readCache(key, ttl);
  if (hit !== null) return hit;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const v = await res.json();
  writeCache(key, v);
  return v;
}

/* ================================================================== */
/* 面板骨架                                                            */
/* ================================================================== */

/**
 * 面板容器。
 *
 * 为什么这里要判 `typeof document`：本文件同时被 Node 里的测试 import
 * （测 YAML 解析与分页合并这两段纯逻辑）。顶层直接摸 `document` 会让测试
 * 连模块都加载不了，于是"最容易出错的两段"反而测不到。
 */
const panelsRoot = typeof document === 'undefined' ? null : document.querySelector('#panels');

/** 加载中的骨架：铺几行灰条，让人知道"这里会有内容"以及大致是表格的形状 */
function skeleton(lines = 5) {
  return `<div class="skeleton" aria-hidden="true">${'<span></span>'.repeat(lines)}</div>`;
}

/**
 * 建一个面板并返回它的操作柄。
 * 面板先以"加载中"出现，填好后替换 —— 避免整页空白等最慢的那个源。
 */
function panel({ id, iconName, title, hint }) {
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = `panel-${id}`;
  el.innerHTML = `
    <header class="panel-head">
      <h2><span class="panel-icon">${icon(iconName)}</span>${esc(title)}</h2>
      ${hint ? `<p class="panel-hint">${esc(hint)}</p>` : ''}
    </header>
    <p class="panel-status loading" aria-live="polite">${L('ui.loading')}</p>
    <div class="panel-body">${skeleton()}</div>`;
  panelsRoot.appendChild(el);
  return {
    el,
    status: (text, kind = '') => {
      const p = $('.panel-status', el);
      p.textContent = text;
      // 转圈只在"还在动"的时候出现；拿到结果或报错就停下
      p.className = `panel-status ${kind}${kind ? '' : ' loading'}`;
      p.hidden = !text;
    },
    body: (html) => {
      $('.panel-body', el).innerHTML = html;
    },
  };
}

/** 把一组行的渲染包成表格（列少、行多，表格最省事也最可读） */
export function table(cols, rows, sort = null) {
  if (!rows.length) return `<p class="empty">${L('ui.noData')}</p>`;
  // 每列可以带 `num`（右对齐、等宽数字）与 `cls`（例如 col-2：窄屏收起）。
  // 表头也支持 `html`，用于放图标（纯文本的 label 会被读屏器念出来）。
  const clsOf = (c) => [c.num ? 'num' : '', c.cls || ''].filter(Boolean).join(' ');
  const head = cols
    .map((c, i) => {
      // `sortable: false` 的列不参与排序（例如纯图标列）
      const sortable = c.sortable !== false;
      const active = sort && sort.index === i;
      const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      const k = [clsOf(c), sortable ? 'sortable' : '', active ? 'sorted' : ''].filter(Boolean).join(' ');
      const inner = c.html ?? esc(c.label);
      const attrs = sortable ? ` data-sort="${i}" role="button" tabindex="0" title="${L('ui.sortHint')}"` : '';
      // 排序状态用 aria-sort 播报给读屏器（视觉箭头它们看不到）
      const aria = active ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
      return `<th${k ? ` class="${k}"` : ''}${attrs}${aria}>${inner}${arrow}</th>`;
    })
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => {
            const k = clsOf(c);
            return `<td${k ? ` class="${k}"` : ''}>${c.cell(r)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ================================================================== */
/* 卡片 + 详情层                                                        */
/* ================================================================== */

/**
 * 卡片：一屏只放前 N 个（默认 10），点进去看详情。
 *
 * 为什么卡片和表格都要有（而不是互相取代）：
 *   · 卡片回答"现在最靠前的是谁" —— 数字大、标题大，扫一眼就够，适合手机；
 *   · 表格回答"第 47 名是谁 / 按成本排一下" —— 需要筛选、排序、看全量。
 * 两者解决的不是同一个问题，所以卡片在上、表格在下（表格可折叠）。
 */
export function cardGrid(rows, cfg) {
  if (!rows.length) return `<p class="empty">${L('ui.noData')}</p>`;
  const cards = rows
    .map((r, i) => {
      return (
        `<button class="card" type="button" data-card="${i}">` +
        `<span class="card-rank">${rankBadge(r.__rank ?? i + 1)}</span>` +
        `<span class="card-main">` +
        `<span class="card-title">${cfg.title(r)}</span>` +
        (cfg.value(r) ? `<span class="card-value">${cfg.value(r)}</span>` : '') +
        `</span>` +
        (cfg.meta(r) ? `<span class="card-meta">${cfg.meta(r)}</span>` : '') +
        `</button>`
      );
    })
    .join('');
  return `<div class="cards">${cards}</div>`;
}

/**
 * 详情层：用**原生 `<dialog>`**。
 *
 * 为什么不用自己拼的浮层：原生 dialog 自带三件很难做对的事 ——
 * Esc 关闭、焦点陷阱（Tab 不会跑到背后的页面）、以及 inert 背景
 * （读屏器不会念到背后的内容）。自己实现这三件，通常只做对第一件。
 */
export function openDetail({ title, meta = '', body = '', link = null, linkLabel = '' }) {
  let dlg = document.getElementById('detail');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'detail';
    dlg.className = 'detail';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML =
    '<form method="dialog" class="detail-close-wrap">' +
    `<button class="icon-btn detail-close" type="submit" aria-label="${L('ui.close')}">` +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6L6 18"/></svg></button></form>' +
    `<h2>${title}</h2>` +
    (meta ? `<p class="detail-meta">${meta}</p>` : '') +
    `<div class="detail-body">${body}</div>` +
    (link ? `<p class="detail-link"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(linkLabel || link)} ↗</a></p>` : '');

  // showModal 在极老的浏览器上没有 —— 那种情况下退化成"直接新窗口打开链接"，
  // 总比点了没反应好
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else if (link) window.open(link, '_blank', 'noopener');
}

/** 详情里的一行"标签 / 值" */
export function detailRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="detail-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

/**
 * 把 cols 定义的列转成"详情表"用的一行行。
 * 复用它，是为了详情里的字段与表格里的列**永远一致** ——
 * 否则加了一列却忘了加进详情（或反过来），是最容易发生的漂移。
 */
export function detailFromCols(cols, row) {
  return cols
    .filter((c) => c.label !== '#')
    .map((c) => detailRow(c.label, c.cell(row)))
    .join('');
}

/**
 * 从一行里取用于比较的值。
 * 优先 `col.value(row)`（渲染之外单独给一个取值函数，避免为了排序去解析 HTML），
 * 没有就用 `row[col.field]`。
 */
function cellValue(col, row) {
  return col.value ? col.value(row) : row[col.field];
}

/**
 * 对一批行做「分组过滤 → 文本搜索 → 排序」。
 *
 * 抽成一份纯函数的原因：11 个面板都要这三件事，而数据形态各不相同
 * （模型/应用/数据集/论文/仓库/成绩）。写成一份，规则才不会每个面板一个样 ——
 * 尤其是下面「空值恒排最后」这条，逐处手写必然会有几处漏掉。
 *
 * ★ 空值恒排在最后（无论升序降序）：否则一升序，"缺数据的"会全聚到榜首，
 * 读者看到的就是一个由空值组成的假榜。
 */
export function applyBoardState(rows, cols, state, { searchFields = [], groupField = null } = {}) {
  let out = Array.isArray(rows) ? rows : [];

  if (groupField && state.group && state.group !== '*') {
    out = out.filter((r) => String(r?.[groupField] ?? '') === state.group);
  }

  const q = String(state.q || '').trim().toLowerCase();
  if (q) {
    const fields = searchFields.length ? searchFields : ['id', 'name', 'model', 'title', 'full_name'];
    out = out.filter((r) => fields.some((f) => String(r?.[f] ?? '').toLowerCase().includes(q)));
  }

  if (state.sort && cols[state.sort.index]) {
    const col = cols[state.sort.index];
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = cellValue(col, a);
      const vb = cellValue(col, b);
      const ea = va === null || va === undefined || va === '';
      const eb = vb === null || vb === undefined || vb === '';
      if (ea && eb) return 0;
      if (ea) return 1; // 空的恒在最后
      if (eb) return -1;
      const na = typeof va === 'number' ? va : Number(va);
      const nb = typeof vb === 'number' ? vb : Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }
  return out;
}

/** 过滤控件的 HTML：搜索框 + 可选的分组下拉 */
export function controlsHtml({ q = '', placeholder = L('ui.search'), groups = null, groupLabel = L('ui.allGroups'), group = '*' } = {}) {
  const sel = groups
    ? `<select data-group aria-label="${esc(groupLabel)}"><option value="*">${esc(groupLabel)}</option>` +
      groups
        .map((g) => `<option value="${esc(g.value)}"${g.value === group ? ' selected' : ''}>${esc(g.label)} (${g.count})</option>`)
        .join('') +
      '</select>'
    : '';
  return (
    `<div class="controls">` +
    `<input type="search" data-q value="${esc(q)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">` +
    sel +
    '</div>'
  );
}

/** 从数据里算出分组下拉的选项（按出现次数降序） */
export function groupOptions(rows, field, labelOf = (v) => v) {
  const m = new Map();
  for (const r of rows) {
    const v = String(r?.[field] ?? '').trim();
    if (!v) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, label: labelOf(value) }));
}

/**
 * 挂一个可过滤/可排序的榜到面板上。
 *
 * 状态（搜索词、分组、排序）留在闭包里；每次变化只重画面板 body，
 * 并**重新绑定**事件 —— 因为 DOM 被整块替换了。这是本站统一的榜渲染入口。
 */
function mountBoard(p, cfg) {
  const state = { q: '', group: '*', sort: cfg.defaultSort || null };
  const baseRows = cfg.rows;

  const draw = () => {
    let rows = applyBoardState(baseRows, cfg.cols, state, cfg);
    // transform 在"过滤 + 排序"**之后**套 —— 名次徽章必须按当前显示顺序重算，
    // 否则筛掉一半后序号还停在原始位置上（1,3,7,…）
    if (cfg.transform) rows = cfg.transform(rows);
    const shown = cfg.limit ? rows.slice(0, cfg.limit) : rows;
    const groups = cfg.groupField ? groupOptions(baseRows, cfg.groupField) : null;
    const total = baseRows.length;
    const base = rows.length !== total ? L('ui.countFiltered', { n: rows.length, total }) : L('ui.count', { n: total });
    const note = cfg.note ? `${base} · ${cfg.note}` : base;
    const limit = cfg.cardLimit ?? 10;

    // ── 卡片区：只放前 N 个，点进去看详情 ──
    // 卡片在**过滤/排序之后**取，所以搜索"gemini"时看到的就是命中的那几个。
    const cards = cfg.card ? cardGrid(shown.slice(0, limit), cfg.card) : '';
    const moreCount = rows.length - Math.min(rows.length, limit);
    const cardsHtml = cards
      ? cards +
        (moreCount > 0
          ? `<p class="cards-more">${L('ui.moreInList', { n: moreCount })}</p>`
          : '')
      : '';

    // ── 完整列表：放在折叠区里 ──
    // 为什么表格不删：卡片回答"最靠前的是谁"，表格回答"第 47 名是谁 / 按成本排一下"。
    // 两者不是同一个问题，所以保留，但收起来不占首屏。
    const listHtml = cfg.table === false
      ? ''
      : `<details class="more"${state.open ? ' open' : ''}>` +
        `<summary>${L('ui.fullList', { n: rows.length })}</summary>` +
        controlsHtml({
          q: state.q,
          groups,
          group: state.group,
          placeholder: cfg.placeholder || L('ui.search'),
          groupLabel: cfg.groupLabel || L('ui.allGroups'),
        }) +
        `<p class="board-count">${esc(note)}</p>` +
        table(cfg.cols, shown, state.sort) +
        '</details>';

    p.body((cfg.beforeControls ? cfg.beforeControls() : '') + cardsHtml + listHtml);

    // 卡片点击 → 详情层
    const rowsForCards = shown.slice(0, limit);
    for (const el of p.el.querySelectorAll('[data-card]')) {
      el.addEventListener('click', () => {
        const row = rowsForCards[Number(el.getAttribute('data-card'))];
        if (!row) return;
        openDetail({
          title: cfg.card.title(row),
          meta: cfg.card.meta ? cfg.card.meta(row) : '',
          body: `<dl class="detail-list">${detailFromCols(cfg.cols, row)}</dl>`,
          link: cfg.card.link ? cfg.card.link(row) : null,
          linkLabel: L('ui.openSource'),
        });
      });
    }

    // 折叠区的开合状态记住，重画（比如搜索）时不要把用户的展开动作弹回去
    const det = p.el.querySelector('details.more');
    if (det) det.addEventListener('toggle', () => { state.open = det.open; });
    // 重新绑定（DOM 已换）
    const q = p.el.querySelector('[data-q]');
    if (q) {
      q.addEventListener('input', () => {
        state.q = q.value;
        const pos = q.selectionStart;
        draw();
        // 保持焦点与光标位置，否则每敲一个字都会掉焦点
        const nq = p.el.querySelector('[data-q]');
        if (nq) {
          nq.focus();
          try { nq.setSelectionRange(pos, pos); } catch { /* 该类型不支持就算了 */ }
        }
      });
    }
    const g = p.el.querySelector('[data-group]');
    if (g) g.addEventListener('change', () => { state.group = g.value; draw(); });
    for (const th of p.el.querySelectorAll('th[data-sort]')) {
      const idx = Number(th.getAttribute('data-sort'));
      const toggle = () => {
        const cur = state.sort;
        // 同一列再点一次 → 反向；换一列 → 从降序开始（榜最常要看的是"最大的"）
        state.sort = cur && cur.index === idx
          ? { index: idx, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
          : { index: idx, dir: 'desc' };
        draw();
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
  };

  draw();
}

/**
 * 名次徽章。前三名用奖牌色 —— 这是"榜"最需要的信息，不该让人自己数序号。
 * 颜色之外还有数字本身，所以不依赖颜色单独传达信息（色盲可用）。
 */
export function rankBadge(n) {
  const cls = n <= 3 ? ` r${n}` : '';
  return `<span class="rank${cls}">${n}</span>`;
}

/**
 * 迷你条形图：宽度相对**当前这一批行里的最大值**。
 * 它表达的是"相对高低"，不是绝对刻度 —— 同一张表内可比，跨表不可比。
 * 这对"一眼看出差距"够用，而且不需要坐标轴。
 */
export function bar(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return '';
  const pct = Math.max(2, Math.min(100, (v / m) * 100)); // 最小 2%：0 分也要看得见那一条
  return `<span class="bar" aria-hidden="true"><i style="--w:${pct.toFixed(1)}%"></i></span>`;
}

/** 模型名 → HuggingFace 页面链接（模型名是 [org/name] 形态） */
const hfLink = (id) => `<a href="https://huggingface.co/${encodeURI(id)}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`;

/* ================================================================== */
/* 面板 1-3：HuggingFace 模型榜（趋势 / 喜欢 / 下载）                  */
/* ================================================================== */

const HF_MODELS = 'https://huggingface.co/api/models';

/** 三个排行共用一套渲染，只有 sort 与那"一列关键数字"不同 */
function modelBoardCols(metric) {
  return [
    { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
    { label: L('col.model'), field: 'id', cell: (r) => hfLink(r.id) },
    {
      label: L('col.task'),
      field: 'pipeline_tag',
      cls: 'col-2',
      cell: (r) => (r.pipeline_tag ? `<span class="tag">${esc(r.pipeline_tag)}</span>` : ''),
    },
    {
      // 表头用图标 + 视觉隐藏的文字：图标省地方，文字让读屏器念得出来
      html: `${icon(metric.icon)}<span class="sr-only">${esc(metric.label)}</span>`,
      num: true,
      field: metric.field,
      cell: (r) => `${bar(r[metric.field], metric.max)}${compact(r[metric.field]) ?? '—'}`,
    },
    {
      html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`,
      num: true,
      cls: 'col-2',
      field: 'likes',
      cell: (r) => compact(r.likes) ?? '—',
    },
    {
      html: `${icon('download')}<span class="sr-only">${L('col.downloads')}</span>`,
      num: true,
      cls: 'col-2',
      field: 'downloads',
      cell: (r) => compact(r.downloads) ?? '—',
    },
  ];
}

/** 名次徽章要在**过滤/排序之后**重算，否则筛掉一半后序号还是原始的 */
function withRank(rows) {
  return rows.map((r, i) => ({ ...r, __rank: i + 1 }));
}

async function loadModelBoard({ id, iconName, title, sort, metric, hint }) {
  const p = panel({
    id,
    iconName,
    title,
    hint,
  });
  try {
    const url = `${HF_MODELS}?sort=${sort}&direction=-1&limit=50`;
    const data = await cachedJson(`hf-${sort}`, url);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    p.status('', 'ok');
    const max = Math.max(...data.map((r) => Number(r[metric.field]) || 0), 0);
    mountBoard(p, {
      rows: data,
      cols: modelBoardCols({ ...metric, max }),
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['id'],
      groupField: 'pipeline_tag',
      groupLabel: L('ui.allTasks'),
      placeholder: L('ui.searchModels'),
      // 行本身要带序号：重排后序号得跟着走
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r[metric.field]) ?? '—'}</span> <span class="v-unit">${esc(metric.label)}</span>`,
        meta: (r) =>
          (r.pipeline_tag ? `<span class="tag">${esc(r.pipeline_tag)}</span>` : '') +
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>` +
          `<span class="tag">${icon('download')}${compact(r.downloads) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 4：HuggingFace 开源模型评测榜                                   */
/* ================================================================== */

const EVAL_DS = 'open-llm-leaderboard%2Fcontents';
const EVAL_ENDPOINT = 'https://datasets-server.huggingface.co/rows';
const EVAL_PAGE = 100;
const EVAL_BATCH = 8; // 并发上限：46 个请求一次全发会被浏览器/上游按连接数排队甚至拒绝
const EVAL_TOP = 50;

const evalRowsUrl = (offset) =>
  `${EVAL_ENDPOINT}?dataset=${EVAL_DS}&config=default&split=train&offset=${offset}&length=${EVAL_PAGE}`;

/** 一个原始行 → 我们展示需要的字段；分数缺失的行返回 null（不让空值参与排序） */
export function normalizeEval(row) {
  const model = String(row.fullname || '').trim();
  if (!model) return null;
  const score = parseFloat(row['Average ⬆️']);
  if (!Number.isFinite(score)) return null;
  const f = (k) => {
    const v = parseFloat(row[k]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    model,
    score,
    ifeval: f('IFEval'),
    bbh: f('BBH'),
    math: f('MATH Lvl 5'),
    gpqa: f('GPQA'),
    mmlupro: f('MMLU-PRO'),
    params: f('#Params (B)'),
  };
}

/** 取一页原始成绩；失败返回 null（单页失败不该让整个榜消失） */
async function fetchEvalPage(offset, attempt = 1) {
  try {
    const res = await fetch(evalRowsUrl(offset), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j?.rows)) throw new Error(L('err.noRows'));
    return j;
  } catch (e) {
    // 上游偶发 5xx 很常见，一次重试就能救回一页；仍失败就记一笔，不抛出
    if (attempt < 2) return fetchEvalPage(offset, attempt + 1);
    return null;
  }
}

/**
 * 并发拉全量。
 *
 * 为什么必须先拉第一页：**页数只能在拿到 `num_rows_total` 之后才知道**
 * （46 页这个数字不是写死的，上游加模型时会变）。第一页失败就直接报错 ——
 * 没有总数就无法判断"取了多少比例"，与其显示一个残榜不如明说拿不到。
 */
export async function fetchAllEvalPages(onProgress) {
  const first = await fetchEvalPage(0);
  if (!first) throw new Error(L('err.evalFirst'));

  const total = Number.isFinite(first.num_rows_total) ? first.num_rows_total : null;
  const pageCount = total ? Math.ceil(total / EVAL_PAGE) : 1;
  const rows = [...first.rows.map((x) => x.row)];
  let failed = 0;

  const rest = [];
  for (let o = EVAL_PAGE; o < pageCount * EVAL_PAGE; o += EVAL_PAGE) rest.push(o);

  onProgress?.({ done: 1, total: pageCount, got: rows.length, failed });

  for (let i = 0; i < rest.length; i += EVAL_BATCH) {
    const batch = rest.slice(i, i + EVAL_BATCH);
    const results = await Promise.all(batch.map((o) => fetchEvalPage(o)));
    for (const r of results) {
      if (r) rows.push(...r.rows.map((x) => x.row));
      else failed += 1;
    }
    onProgress?.({ done: 1 + Math.min(i + EVAL_BATCH, rest.length), total: pageCount, got: rows.length, failed });
  }
  return { rows, failed, total, pageCount };
}

function evalBoardCols(max) {
  return [
    { label: '#', sortable: false, cell: (r) => rankBadge(r.rank) },
    { label: L('col.model'), field: 'model', cell: (r) => hfLink(r.model) },
    { label: L('col.avg'), num: true, field: 'score', cell: (r) => `${bar(r.score, max)}${num(r.score, 1) ?? '—'}` },
    // 以下几列在窄屏收起（site.css 的 .col-2）：手机上横向滚 9 列很难用，
    // 优先保证"哪个模型、多少分"这两件事可读
    { label: L('col.params'), num: true, cls: 'col-2', field: 'params', cell: (r) => num(r.params, 1) ?? '—' },
    { label: 'IFEval', num: true, cls: 'col-2', field: 'ifeval', cell: (r) => num(r.ifeval, 1) ?? '—' },
    { label: 'BBH', num: true, cls: 'col-2', field: 'bbh', cell: (r) => num(r.bbh, 1) ?? '—' },
    { label: 'MATH', num: true, cls: 'col-2', field: 'math', cell: (r) => num(r.math, 1) ?? '—' },
    { label: 'GPQA', num: true, cls: 'col-2', field: 'gpqa', cell: (r) => num(r.gpqa, 1) ?? '—' },
    { label: 'MMLU-PRO', num: true, cls: 'col-2', field: 'mmlupro', cell: (r) => num(r.mmlupro, 1) ?? '—' },
  ];
}

/** 评测榜：每次都要按当前顺序重排名次 */
function rankEvalRows(rows) {
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 评测榜的挂载：limit 用 EVAL_TOP，并把"覆盖多少页"这类口径放进说明 */
function mountEvalBoard(p, models, note) {
  mountBoard(p, {
    rows: models,
    cols: evalBoardCols(Math.max(...models.map((r) => r.score), 0)),
    defaultSort: { index: 2, dir: 'desc' },
    limit: EVAL_TOP,
    searchFields: ['model'],
    placeholder: L('ui.searchModels'),
    transform: rankEvalRows,
    note,
    card: {
      title: (r) => esc(r.model),
      value: (r) => `<span class="v-num">${num(r.score, 1)}</span> <span class="v-unit">${L('col.avg')}</span>`,
      meta: (r) =>
        (r.params ? `<span class="tag">${num(r.params, 1)}B</span>` : '') +
        `<span class="tag">IFEval ${num(r.ifeval, 1) ?? '—'}</span>` +
        `<span class="tag">MMLU-PRO ${num(r.mmlupro, 1) ?? '—'}</span>`,
      link: (r) => `https://huggingface.co/${encodeURI(r.model)}`,
    },
  });
}

async function loadEvalBoard() {
  const p = panel({
    id: 'eval',
    iconName: 'trophy',
    title: L('p.eval.title'),
    hint: L('p.eval.hint'),
  });
  // 走 readCache() 而不是直接读 sessionStorage：存储被禁用时要降级成"没有缓存"，
  // 而不是让整块面板崩掉（它只是缓存，不该有这种权力）
  const cached = readCache('eval-board', CACHE_TTL_MS);
  if (Array.isArray(cached) && cached.length) {
    p.status('', 'ok');
    mountEvalBoard(p, cached, L('ui.cached', { n: cached.length }));
    return;
  }

  p.status(L('st.fetchingPages'));
  const seen = new Map(); // 以模型名去重：同一模型可能有多个精度版本，保留分高的那个
  let lastStatus = '';
  try {
    const { rows, failed, pageCount } = await fetchAllEvalPages(({ done, total, got, failed }) => {
      const s = failed
        ? L('st.progressFailed', { got, done, total, failed })
        : L('st.progress', { got, done, total });
      if (s !== lastStatus) {
        lastStatus = s;
        p.status(s);
      }
    });

    for (const row of rows) {
      const m = normalizeEval(row);
      if (!m) continue;
      const prev = seen.get(m.model);
      if (!prev || m.score > prev.score) seen.set(m.model, m);
    }
    const models = [...seen.values()];
    if (!models.length) throw new Error(L('err.noBoard'));

    writeCache('eval-board', models);
    p.status('', failed ? 'warn' : 'ok');
    mountEvalBoard(
      p,
      models,
      failed
        ? L('st.evalDonePartial', { n: models.length, pages: pageCount, failed })
        : L('st.evalDone', { n: models.length, pages: pageCount })
    );
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 5：Aider 编程能力榜（YAML 子集）                                */
/* ================================================================== */

const AIDER_URL =
  'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml';

/**
 * 最小 YAML 子集解析器。
 *
 * 只认识这一种形态（Aider 榜单的实际写法）：
 *   - dirname: xxx
 *     model: Gemini 2.0 Pro
 *     pass_rate_2: 35.6
 *     date: 2025-02-25
 * 即：**扁平的数组，元素是"键: 标量值"**。不支持嵌套、锚点、多行块、行内数组。
 *
 * ## 遇到嵌套必须抛错，而不是继续解析（这条有测试盯着）
 * 一个嵌套映射（`- a:` 换行后跟更深缩进的 `b: 1`）在 YAML 里表示 `{a: {b: 1}}`，
 * 但按本解析器"逐行取 key: value"的写法会**静默拍平**成 `{a: null, b: 1}` ——
 * 键还在、值却挂错了地方，页面上看不出异常。所以这里显式比较缩进：
 * 续行的键缩进若比本元素的键缩进更深，就判定为嵌套并抛错。
 * 宁可这个面板报"上游格式变了"，也不要显示一个悄悄错位的值。
 */
export function parseFlatYamlList(text) {
  const items = [];
  let cur = null;
  let keyIndent = null; // 本元素里键的缩进列（用于识别嵌套）
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*#/.test(raw) || /^\s*$/.test(raw) || /^---\s*$/.test(raw)) continue;

    // 顶层数组元素：以 "- " 开头（"-" 后可以是键、也可以是空）
    const newItem = /^(\s*)-\s*(.*)$/.exec(raw);
    if (newItem) {
      cur = {};
      items.push(cur);
      const indentAfterDash = newItem[1].length + 2; // "- " 占两列
      keyIndent = indentAfterDash;
      const rest = newItem[2].trim();
      if (rest) {
        const kv = /^([^:]+):\s*(.*)$/.exec(rest);
        if (!kv) throw new Error(L('err.yamlNotKV', { line: i + 1, text: raw.trim() }));
        // "- key:" 后面什么都没有 = 值在更深缩进的下一行（嵌套）→ 直接判错
        if (kv[2].trim() === '') {
          throw new Error(L('err.yamlNested', { line: i + 1, key: kv[1].trim() }));
        }
        cur[kv[1].trim()] = scalar(kv[2]);
      }
      continue;
    }

    const kv = /^(\s+)([^:]+):\s*(.*)$/.exec(raw);
    if (kv && cur) {
      // 缩进比本元素的键更深 → 这是嵌套，不是兄弟键
      if (keyIndent !== null && kv[1].length > keyIndent) {
        throw new Error(L('err.yamlIndent', { line: i + 1 }));
      }
      if (kv[3].trim() === '') {
        throw new Error(L('err.yamlNested', { line: i + 1, key: kv[2].trim() }));
      }
      cur[kv[2].trim()] = scalar(kv[3]);
      continue;
    }
    throw new Error(L('err.yamlSubset', { line: i + 1, text: raw.trim().slice(0, 60) }));
  }
  return items;
}

/** 标量转换：去掉引号、识别数字/布尔/null。**不做**日期解析（保持原样字符串） */
function scalar(s) {
  let v = String(s ?? '').trim();
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return v;
}

/**
 * Aider 的榜每个模型有**多行**（同一模型的不同尝试/日期各一行），
 * 取每个模型的最高 pass_rate_2 作为它的成绩。
 */
export function bestAiderRows(entries) {
  const best = new Map();
  for (const e of entries) {
    const model = String(e.model || '').trim();
    const rate = parseFloat(e.pass_rate_2);
    if (!model || !Number.isFinite(rate)) continue;
    const prev = best.get(model);
    if (!prev || rate > prev.rate) best.set(model, { model, rate, date: e.date ?? null });
  }
  return [...best.values()].sort((a, b) => b.rate - a.rate);
}

async function loadAiderBoard() {
  const p = panel({
    id: 'aider',
    iconName: 'code',
    title: L('p.aider.title'),
    hint: L('p.aider.hint'),
  });
  try {
    const res = await fetch(AIDER_URL, { headers: { accept: 'text/plain' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = bestAiderRows(parseFlatYamlList(await res.text()));
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'model', cell: (r) => esc(r.model) },
        { label: L('col.rate'), num: true, field: 'rate', cell: (r) => `${num(r.rate, 1)}%` },
        { label: L('col.date'), field: 'date', cell: (r) => esc(r.date ?? '—') },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['model'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      card: {
        title: (r) => esc(r.model),
        value: (r) => `<span class="v-num">${num(r.rate, 1)}%</span> <span class="v-unit">${L('col.rate')}</span>`,
        meta: (r) => (r.date ? `<span class="tag">${esc(r.date)}</span>` : ''),
      },
    });
  } catch (e) {
    p.status(
      L('st.failed', { msg: e.message }) + (/YAML|行|Line/.test(e.message) ? L('err.yamlChanged') : L('st.rateLimited')),
      'err'
    );
    p.body('');
  }
}

/* ================================================================== */
/* 面板 6：HF Spaces 趋势（AI 应用榜）                                   */
/* ================================================================== */

async function loadSpaces() {
  const p = panel({
    id: 'spaces',
    iconName: 'cube',
    title: L('p.spaces.title'),
    hint: L('p.spaces.hint'),
  });
  try {
    const data = await cachedJson('hf-spaces', `${HF_MODELS.replace('/models', '/spaces')}?sort=trendingScore&direction=-1&limit=50`);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const max = Math.max(...data.map((r) => Number(r.trendingScore) || 0), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows: data,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.app'), field: 'id', cell: (r) => hfLink(r.id).replace('huggingface.co/', 'huggingface.co/spaces/') },
        { label: L('col.sdk'), field: 'sdk', cls: 'col-2', cell: (r) => (r.sdk ? `<span class="tag">${esc(r.sdk)}</span>` : '') },
        {
          html: `${icon('trending')}<span class="sr-only">${L('col.trending')}</span>`,
          num: true,
          field: 'trendingScore',
          cell: (r) => `${bar(r.trendingScore, max)}${compact(r.trendingScore) ?? '—'}`,
        },
        { html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`, num: true, cls: 'col-2', field: 'likes', cell: (r) => compact(r.likes) ?? '—' },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['id'],
      groupField: 'sdk',
      groupLabel: L('ui.allSdks'),
      placeholder: L('ui.searchApps'),
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r.trendingScore) ?? '—'}</span> <span class="v-unit">${L('col.trending')}</span>`,
        meta: (r) =>
          (r.sdk ? `<span class="tag">${esc(r.sdk)}</span>` : '') +
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/spaces/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 7：HF 数据集趋势                                                 */
/* ================================================================== */

async function loadDatasets() {
  const p = panel({
    id: 'datasets',
    iconName: 'layers',
    title: L('p.datasets.title'),
    hint: L('p.spaces.hint'),
  });
  try {
    const data = await cachedJson('hf-datasets', `${HF_MODELS.replace('/models', '/datasets')}?sort=trendingScore&direction=-1&limit=50`);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const max = Math.max(...data.map((r) => Number(r.trendingScore) || 0), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows: data,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.dataset'), field: 'id', cell: (r) => hfLink(r.id).replace('huggingface.co/', 'huggingface.co/datasets/') },
        {
          html: `${icon('trending')}<span class="sr-only">${L('col.trending')}</span>`,
          num: true,
          field: 'trendingScore',
          cell: (r) => `${bar(r.trendingScore, max)}${compact(r.trendingScore) ?? '—'}`,
        },
        { html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`, num: true, cls: 'col-2', field: 'likes', cell: (r) => compact(r.likes) ?? '—' },
        { html: `${icon('download')}<span class="sr-only">${L('col.downloads')}</span>`, num: true, cls: 'col-2', field: 'downloads', cell: (r) => compact(r.downloads) ?? '—' },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['id'],
      placeholder: L('ui.searchDatasets'),
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r.trendingScore) ?? '—'}</span> <span class="v-unit">${L('col.trending')}</span>`,
        meta: (r) =>
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>` +
          `<span class="tag">${icon('download')}${compact(r.downloads) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/datasets/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 8：HF 每日论文（热榜）                                           */
/* ================================================================== */

/** 论文条目 → 展示需要的字段。upvotes 是"热度"信号，缺了就不排它。 */
export function normalizePaper(entry) {
  const p = entry?.paper || {};
  const title = String(p.title || entry?.title || '').trim();
  if (!title) return null;
  const votes = Number(p.upvotes);
  return {
    id: p.id ?? null,
    title,
    votes: Number.isFinite(votes) ? votes : 0,
    date: String(p.publishedAt || entry?.publishedAt || '').slice(0, 10),
    summary: String(p.summary || entry?.summary || '').trim(),
  };
}

export function rankPapers(entries) {
  const seen = new Map();
  for (const e of entries) {
    const r = normalizePaper(e);
    if (!r) continue;
    if (!seen.has(r.title)) seen.set(r.title, r);
  }
  return [...seen.values()].sort((a, b) => b.votes - a.votes);
}

async function loadPapers() {
  const p = panel({
    id: 'papers',
    iconName: 'file',
    title: L('p.papers.title'),
    hint: L('p.papers.hint'),
  });
  try {
    const data = await cachedJson('hf-papers', 'https://huggingface.co/api/daily_papers?limit=50');
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const rows = rankPapers(data);
    if (!rows.length) throw new Error(L('err.noPapers'));
    const max = Math.max(...rows.map((r) => r.votes), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.paper'),
          field: 'title',
          cell: (r) =>
            `<a href="https://huggingface.co/papers/${encodeURIComponent(r.id || '')}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`,
        },
        { label: L('col.date'), cls: 'col-2', field: 'date', cell: (r) => esc(r.date || '—') },
        {
          html: `${icon('heart')}<span class="sr-only">${L('col.votes')}</span>`,
          num: true,
          field: 'votes',
          cell: (r) => `${bar(r.votes, max)}${compact(r.votes) ?? '0'}`,
        },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      limit: 30,
      searchFields: ['title'],
      placeholder: L('ui.searchPapers'),
      transform: withRank,
      card: {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${compact(r.votes) ?? '0'}</span> <span class="v-unit">${L('col.votes')}</span>`,
        meta: (r) => (r.date ? `<span class="tag">${esc(r.date)}</span>` : ''),
        link: (r) => `https://huggingface.co/papers/${encodeURIComponent(r.id || '')}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 9：GitHub 高星 AI 项目（可按时间段 / 语言切换）                   */
/* ================================================================== */

const GH_QUERIES = {
  week: { labelKey: 'col.weekStars', q: 'topic:llm created:>@WEEK@' },
  month: { labelKey: 'col.monthStars', q: 'topic:llm created:>@MONTH@' },
  stars: { labelKey: 'col.totalStars', q: 'topic:llm stars:>1000' },
};

const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/**
 * 只留真正的 AI 仓库并排序。
 * 为什么不用 GitHub 返回的顺序：它的 `sort=stars` 对"本周新增"没有意义
 * （按总星标排，永远是那几个大仓库），而热门榜要看的是**当期**增量。
 * 所以按当期索引排序，并把当期增量与总星标分开显示。
 */
export function rankRepos(items, metricKey) {
  const rows = (items || [])
    .filter((r) => r && typeof r.full_name === 'string')
    .map((r) => ({
      full_name: r.full_name,
      html_url: r.html_url,
      description: String(r.description || '').trim(),
      stars: Number(r.stargazers_count) || 0,
      gained: Number(r[metricKey]) || 0, // 本期新增星标（GitHub 只在带日期条件的搜索里给）
      lang: r.language || null,
      created: String(r.created_at || '').slice(0, 10),
    }));
  // 有当期增量就按增量排，否则退回总星标
  const useGained = rows.some((r) => r.gained > 0);
  return rows.sort((a, b) => (useGained ? b.gained - a.gained : b.stars - a.stars));
}

async function loadRepos(range = 'week') {
  const p = panel({
    id: 'repos',
    iconName: 'star',
    title: L('p.repos.title'),
    hint: L('p.repos.hint'),
  });
  try {
    const q = GH_QUERIES[range].q.replace('@WEEK@', isoDaysAgo(7)).replace('@MONTH@', isoDaysAgo(30));
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
    const data = await cachedJson(`gh-${range}`, url);
    if (!Array.isArray(data?.items)) throw new Error(L('err.noItems'));
    const rows = rankRepos(data.items, 'stargazers_count');
    if (!rows.length) throw new Error(L('err.noRepos'));
    p.status('', 'ok');

    // 时间段切换放在过滤控件之上；切换时只重画这个面板（不重建，避免整列跳动）
    const switchHtml = Object.entries(GH_QUERIES)
      .map(([k, v]) => `<button class="chip${k === range ? ' on' : ''}" data-range="${k}" type="button">${esc(L(v.labelKey))}</button>`)
      .join('');

    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.repo'), field: 'full_name', cell: (r) => `<a href="${esc(r.html_url)}" target="_blank" rel="noopener noreferrer">${esc(r.full_name)}</a>` },
        { label: L('col.lang'), cls: 'col-2', field: 'lang', cell: (r) => (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') },
        { html: `${icon('star')}<span class="sr-only">${L('col.stars')}</span>`, num: true, field: 'stars', cell: (r) => compact(r.stars) ?? '—' },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['full_name', 'description'],
      groupField: 'lang',
      groupLabel: L('ui.allLangs'),
      placeholder: L('ui.searchRepos'),
      transform: withRank,
      card: {
        title: (r) => esc(r.full_name),
        value: (r) => `<span class="v-num">${compact(r.stars) ?? '—'}</span> <span class="v-unit">${L('col.stars')}</span>`,
        meta: (r) =>
          (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') +
          `<span class="tag">${esc(r.created)}</span>`,
        link: (r) => r.html_url,
      },
      beforeControls: () => `<div class="chips" data-chips>${switchHtml}</div>`,
    });

    // 绑定时间段切换（mountBoard 每次重画都会换 DOM，所以在这里绑会随重画失效，
    // 因此挂到面板元素上用事件委托 —— 只绑一次即可）
    p.el.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-range]');
      if (btn) loadRepos(btn.getAttribute('data-range'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }) + L('st.ghLimit'), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 10：最新发布的模型（models.dev，体积大 → 点击才加载）             */
/* ================================================================== */

const MODELS_DEV_URL = 'https://models.dev/api.json';

/**
 * 把 models.dev 的 `provider → models` 嵌套结构摊平成模型数组。
 *
 * 为什么这个源值得单独处理：它是**唯一**带 `release_date` 的源，
 * 所以能做"最新发布"这种别处拿不到的榜。代价是体积 4.8MB，
 * 所以做成点击加载而不是进页面就拉。
 */
export function flattenModelsDev(json) {
  const out = [];
  for (const [pid, prov] of Object.entries(json || {})) {
    for (const [mid, m] of Object.entries(prov?.models || {})) {
      if (!m || !m.id) continue;
      out.push({
        id: m.id,
        name: String(m.name || m.id),
        provider: String(prov.name || pid),
        release: String(m.release_date || ''),
        context: Number(m.limit?.context) || null,
        costIn: Number(m.cost?.input ?? NaN),
        costOut: Number(m.cost?.output ?? NaN),
        reasoning: Boolean(m.reasoning),
        openWeights: Boolean(m.open_weights),
      });
    }
  }
  // 按发布日期降序；没有日期的排在最后（而不是被当成 1970 年排到开头）
  return out.sort((a, b) => {
    if (!a.release && !b.release) return a.name.localeCompare(b.name);
    if (!a.release) return 1;
    if (!b.release) return -1;
    return b.release.localeCompare(a.release);
  });
}

/** 价格格式化：$/百万 token，两位有效数字就够，不堆小数 */
export function fmtCost(v) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return L('ui.free');
  return `$${v < 1 ? v.toFixed(2) : v.toFixed(1)}`;
}

async function loadNewModels() {
  const p = panel({
    id: 'newmodels',
    iconName: 'box',
    title: L('p.newmodels.title'),
    hint: L('p.newmodels.hint'),
  });
  p.status(L('st.bigDataHint'), '');
  p.body(
    `<div class="chips"><button class="btn-ghost" type="button" data-load-models>` +
      `${icon('download')}${L('st.loadModels')}</button></div>`
  );

  const btn = p.el.querySelector('[data-load-models]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    p.status(L('st.loadingBig', { size: '4.8MB' }), 'loading');
    p.body(skeleton(6));
    try {
      const json = await cachedJson('models-dev', MODELS_DEV_URL);
      const rows = flattenModelsDev(json);
      if (!rows.length) throw new Error(L('err.noModels'));
      // 只显示带发布日期的（"最新发布"这个榜的意义所在）
      const dated = rows.filter((r) => r.release);
      p.status('', 'ok');
      mountBoard(p, {
        rows: dated,
        cols: [
          { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
          { label: L('col.model'), field: 'name', cell: (r) => esc(r.name) },
          { label: L('col.provider'), cls: 'col-2', field: 'provider', cell: (r) => `<span class="tag">${esc(r.provider)}</span>` },
          { label: L('col.release'), field: 'release', cell: (r) => esc(r.release) },
          { label: L('col.context'), num: true, cls: 'col-2', field: 'context', cell: (r) => compact(r.context) ?? '—' },
          // 价格排序要把"没价格"的排最后：applyBoardState 已经这么做了（空值恒最后）
          { label: L('col.priceIn'), num: true, cls: 'col-2', field: 'costIn', cell: (r) => fmtCost(r.costIn) },
          { label: L('col.priceOut'), num: true, cls: 'col-2', field: 'costOut', cell: (r) => fmtCost(r.costOut) },
        ],
        defaultSort: { index: 3, dir: 'desc' },
        limit: 40,
        searchFields: ['name', 'provider'],
        groupField: 'provider',
        groupLabel: L('ui.allProviders'),
        placeholder: L('ui.searchModelsProviders'),
        transform: withRank,
        note: L('st.dated', { total: rows.length, dated: dated.length }),
        card: {
          title: (r) => esc(r.name),
          value: (r) => `<span class="v-num">${esc(r.release)}</span> <span class="v-unit">${L('col.release')}</span>`,
          meta: (r) =>
            `<span class="tag">${esc(r.provider)}</span>` +
            `<span class="tag">${compact(r.context) ?? '—'} ${L('col.context')}</span>` +
            `<span class="tag">${L('col.priceIn')} ${fmtCost(r.costIn)}</span>`,
        },
      });
    } catch (e) {
      p.status(L('st.failed', { msg: e.message }), 'err');
      p.body('');
    }
  });
}

/* ================================================================== */
/* 面板 11：SWE-bench（真实代码修复能力）                                */
/* ================================================================== */

/**
 * 数据在 `swe-bench.github.io` 仓库的 `data/leaderboards.json`（经 raw.githubusercontent，
 * CORS `*`）。这个文件 **4MB**，而且它把每个提交的**逐题明细**都塞在同一个文件里
 * （`resolved_instances` / `costs_to_complete` 等长数组）—— 我们只用到汇总字段。
 * 所以处理方式与 models.dev 一样：**点击才加载**，并且只取需要的字段。
 *
 * ★ 量纲坑（已实测确认）：`resolved` 是**已经在 0–100 的百分数**（Verified 子榜最大 79.2，
 * 若按 0–1 比例解释则不可能超过 1）。所以展示时**直接用，不要再 ×100**。
 * 这个坑有测试盯着：见 trend.test.js 的「SWE-bench 的 resolved 不乘 100」。
 */

const SWE_BENCH_URL =
  'https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json';

/** 想要哪个子榜（4MB 里只有 5 个，取名字最直白的那个） */
export const DEFAULT_SWE_BOARD = 'Verified';

/**
 * 从一个子榜里取出排在前面的一批。
 *
 * 去重规则：同一个模型可能**多次提交**（不同日期/不同 agent），榜单站的原始列表是按
 * 提交时间排的，会出现同一个模型占好几行。这里按"模型名"取**最高分**那一次，
 * 因为读者要看的是"这个模型能做到多少"，不是"谁什么时候又交了一次"。
 */
/** 数据里实际有哪些子榜（用于界面上的切换项，顺序按数据本身） */
export function sweBoardNames(boards) {
  return (boards || []).map((b) => String(b?.name || '')).filter(Boolean);
}

export function rankSweBench(boards, boardName = DEFAULT_SWE_BOARD) {
  const board = (boards || []).find((b) => b?.name === boardName) || (boards || [])[0];
  if (!board || !Array.isArray(board.results)) return [];
  const best = new Map();
  for (const r of board.results) {
    // ★ 必须先挡掉 null/undefined/空串再 Number()：
    // `Number(null)` 是 0 且 `Number.isFinite(0)` 为真 —— 直接用 Number 判断会把
    // "没有成绩"的条目当成 **0 分**混进榜里（实测官方数据里确实有 resolved:null 的条目）。
    const raw = r?.resolved;
    if (raw === null || raw === undefined || raw === '') continue;
    const score = Number(raw);
    if (!Number.isFinite(score)) continue; // 非数字同样丢，不参与排名
    const model = String(r.model_display || r.agent || '').trim();
    if (!model) continue;
    const row = {
      model,
      // resolved 已是百分数（0–100），**不做任何换算**
      score,
      date: String(r.date || '').slice(0, 10),
      // 同一个坑：Number(null) === 0，所以要先挡 null/空串
      cost: r.cost === null || r.cost === undefined || r.cost === '' ? null : Number(r.cost),
      org: String(r.model_org || r.agent_org || '').trim(),
    };
    const prev = best.get(model);
    if (!prev || row.score > prev.score) best.set(model, row);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

async function loadSweBench(boardName = DEFAULT_SWE_BOARD) {
  const p = panel({
    id: 'swebench',
    iconName: 'code',
    title: L('p.swebench.title'),
    hint: L('p.swebench.hint'),
  });

  // 未加载：给一个按钮（4MB 不进首屏）
  const showLoadButton = (note) => {
    p.status(note || L('st.bigDataHint'));
    p.body(
      `<div class="chips"><button class="btn-ghost" type="button" data-load-swe>` +
        `${icon('download')}${L('st.loadSwe')}</button></div>`
    );
    p.el.querySelector('[data-load-swe]')?.addEventListener('click', () => run(boardName));
  };

  // 已加载：给子榜切换（5 个子榜）并渲染
  const render = (boards, current) => {
    const names = sweBoardNames(boards);
    const chips = names
      .map((n) => `<button class="chip${n === current ? ' on' : ''}" data-board="${esc(n)}" type="button">${esc(n)}</button>`)
      .join('');
    const rows = rankSweBench(boards, current);
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'model', cell: (r) => esc(r.model) },
        { label: L('col.org'), cls: 'col-2', field: 'org', cell: (r) => (r.org ? `<span class="tag">${esc(r.org)}</span>` : '') },
        // resolved 已是 0–100 的百分数，**不乘 100**
        { label: L('col.score'), num: true, field: 'score', cell: (r) => `${bar(r.score, rows[0].score)}${num(r.score, 1)}%` },
        { label: L('col.cost'), num: true, cls: 'col-2', field: 'cost', cell: (r) => (Number.isFinite(r.cost) ? `$${num(r.cost, 0)}` : '—') },
        { label: L('col.submitted'), cls: 'col-2', field: 'date', cell: (r) => esc(r.date || '—') },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      limit: 40,
      searchFields: ['model', 'org'],
      groupField: 'org',
      groupLabel: L('ui.allOrgs'),
      placeholder: L('ui.searchModelsOrgs'),
      transform: withRank,
      beforeControls: () => `<div class="chips" data-boards>${chips}</div>`,
      note: L('st.board', { name: current }),
      card: {
        title: (r) => esc(r.model),
        value: (r) => `<span class="v-num">${num(r.score, 1)}%</span> <span class="v-unit">${L('col.score')}</span>`,
        meta: (r) =>
          (r.org ? `<span class="tag">${esc(r.org)}</span>` : '') +
          (r.date ? `<span class="tag">${esc(r.date)}</span>` : '') +
          (Number.isFinite(r.cost) ? `<span class="tag">$${num(r.cost, 0)}</span>` : ''),
      },
    });
    // 事件委托：重画会换掉 DOM，挂面板上只绑一次
    p.el.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-board]');
      if (btn) render(boards, btn.getAttribute('data-board'));
    });
  };

  const run = async (which) => {
    p.status(L('st.loadingBig', { size: '4MB' }), 'loading');
    p.body(skeleton(6));
    try {
      const json = await cachedJson('swe-bench', SWE_BENCH_URL);
      const boards = json?.leaderboards;
      if (!Array.isArray(boards)) throw new Error(L('err.noBoards'));
      if (!rankSweBench(boards, which).length) throw new Error(L('err.noBoardRows', { name: which }));
      render(boards, which);
    } catch (e) {
      p.status(L('st.failed', { msg: e.message }), 'err');
      p.body('');
      showLoadButton(L('st.failed', { msg: e.message }) + L('st.retry'));
    }
  };

  showLoadButton();
}

/* ================================================================== */
/* 启动                                                                */
/* ================================================================== */

const BOARDS = [
  () =>
    loadModelBoard({
      id: 'trending',
      iconName: 'trending',
      title: L('p.trending.title'),
      sort: 'trendingScore',
      metric: { label: L('col.trending'), field: 'trendingScore', icon: 'trending' },
      hint: L('p.trending.hint'),
    }),
  () =>
    loadModelBoard({
      id: 'liked',
      iconName: 'heart',
      title: L('p.liked.title'),
      sort: 'likes',
      metric: { label: L('col.likes'), field: 'likes', icon: 'heart' },
      hint: L('p.liked.hint'),
    }),
  () =>
    loadModelBoard({
      id: 'downloaded',
      iconName: 'download',
      title: L('p.downloaded.title'),
      sort: 'downloads',
      metric: { label: L('col.downloads'), field: 'downloads', icon: 'download' },
      hint: L('p.downloaded.hint'),
    }),
  () => loadEvalBoard(),
  () => loadAiderBoard(),
  () => loadSpaces(),
  () => loadDatasets(),
  () => loadPapers(),
  () => loadRepos('week'),
  () => loadNewModels(),
  () => loadSweBench(),
];

/**
 * 清掉本页的缓存并重画全部面板。
 *
 * 为什么要"清缓存"而不是直接 location.reload()：
 * 缓存是 sessionStorage 里的，刷新页面并不会丢掉它 —— 用户点"刷新数据"
 * 却看到一模一样的内容（因为读的还是 10 分钟内的缓存），
 * 会以为按钮坏了。所以必须显式清掉再拉。
 */
function reloadAll() {
  clearCache();
  panelsRoot.innerHTML = '';
  startAll();
}

/** 逐个启动面板（不 await 彼此）：最慢的源不该挡住最快的源 */
function startAll() {
  for (const start of BOARDS) {
    Promise.resolve()
      .then(start)
      .catch((e) => {
        // 兜底：面板构造本身出错也要看得见，不能静默消失
        const el = document.createElement('section');
        el.className = 'panel';
        el.innerHTML = `<p class="panel-status err">${L('err.init', { msg: esc(e.message) })}</p>`;
        panelsRoot.appendChild(el);
      });
  }
}

if (panelsRoot) {
  startAll();

  const refreshBtn = document.getElementById('refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const hint = document.getElementById('refresh-hint');
      refreshBtn.disabled = true;
      if (hint) hint.textContent = L('hero.refreshing');
      reloadAll();
      // 评测榜要拉 46 页、约 8 秒，按钮禁用久一点，避免连点
      setTimeout(() => {
        refreshBtn.disabled = false;
        if (hint) hint.textContent = L('hero.refreshed');
      }, 1200);
    });
  }
}
