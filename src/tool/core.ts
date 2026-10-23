// 周报的纯函数：把接口数据汇总成周报、环比、图表（SVG 字符串）、Markdown / HTML 导出、AI 解读提示词。不依赖界面和网络。
import { CONTENT_DATA_START, addDays, type ArticleStat, type BizDay, type CumRow, type SourceCount, type UserRow } from './mp';

/** getusersummary 的 user_source 取值（官方文档） */
export const USER_SOURCES: Record<number, string> = {
  0: '其他合计', 1: '公众号搜索', 17: '名片分享', 30: '扫描二维码', 57: '文章内账号名称', 100: '微信广告', 161: '他人转载', 149: '小程序关注', 200: '视频号', 201: '直播',
};
export const sourceName = (s: number) => USER_SOURCES[s] ?? `其他渠道（${s}）`;

export interface Period { begin: string; end: string }
export const weekPeriods = (end: string): { cur: Period; prev: Period } => ({ cur: { begin: addDays(end, -6), end }, prev: { begin: addDays(end, -13), end: addDays(end, -7) } });

export interface RawData {
  end: string;
  /** 本周 + 上周的用户增减 */
  users: UserRow[] | null;
  cumulate: CumRow[] | null;
  biz: BizDay[] | null;
  articles: ArticleStat[] | null;
  /** 各部分取数失败的原因；没失败的不出现 */
  errors: Partial<Record<'users' | 'cumulate' | 'biz' | 'articles', string>>;
}

export interface UserDay { date: string; newUser: number; cancelUser: number; net: number; cumulate: number | null }
export interface Totals { newUser: number; cancelUser: number; net: number }
export interface ReadTotals { read: number; share: number; zaikan: number; like: number; comment: number; collection: number; sent: number }
export interface Report {
  cur: Period;
  prev: Period;
  /** 上周的内容数据是否可比（接口数据从 2025-11-01 起） */
  prevReadable: boolean;
  userDays: UserDay[] | null;
  userTotals: Totals | null;
  userPrev: Totals | null;
  cumulateEnd: number | null;
  bySource: { source: string; newUser: number; cancelUser: number }[];
  readDays: BizDay[] | null;
  readTotals: ReadTotals | null;
  readPrev: ReadTotals | null;
  readSources: SourceCount[];
  articles: ArticleStat[] | null;
  errors: RawData['errors'];
}

const dates = (p: Period) => Array.from({ length: 7 }, (_, i) => addDays(p.begin, i));
const inP = (d: string, p: Period) => d >= p.begin && d <= p.end;

function userTotals(rows: UserRow[], p: Period): Totals {
  const r = rows.filter((x) => inP(x.date, p));
  const newUser = r.reduce((a, x) => a + x.newUser, 0);
  const cancelUser = r.reduce((a, x) => a + x.cancelUser, 0);
  return { newUser, cancelUser, net: newUser - cancelUser };
}
function readTotals(days: BizDay[], p: Period): ReadTotals {
  const r = days.filter((x) => inP(x.date, p));
  const sum = (k: keyof Pick<BizDay, 'read' | 'share' | 'zaikan' | 'like' | 'comment' | 'collection' | 'sent'>) => r.reduce((a, x) => a + x[k], 0);
  return { read: sum('read'), share: sum('share'), zaikan: sum('zaikan'), like: sum('like'), comment: sum('comment'), collection: sum('collection'), sent: sum('sent') };
}

export function buildReport(raw: RawData): Report {
  const { cur, prev } = weekPeriods(raw.end);
  const prevReadable = prev.begin >= CONTENT_DATA_START;
  const cumMap = new Map((raw.cumulate ?? []).map((c) => [c.date, c.cumulate]));
  const userDays = raw.users
    ? dates(cur).map((d) => {
        const r = raw.users!.filter((x) => x.date === d);
        const newUser = r.reduce((a, x) => a + x.newUser, 0);
        const cancelUser = r.reduce((a, x) => a + x.cancelUser, 0);
        return { date: d, newUser, cancelUser, net: newUser - cancelUser, cumulate: cumMap.get(d) ?? null };
      })
    : null;
  const bySrc = new Map<number, { newUser: number; cancelUser: number }>();
  for (const x of (raw.users ?? []).filter((x) => inP(x.date, cur))) {
    const o = bySrc.get(x.source) ?? { newUser: 0, cancelUser: 0 };
    o.newUser += x.newUser; o.cancelUser += x.cancelUser;
    bySrc.set(x.source, o);
  }
  const readDays = raw.biz ? dates(cur).map((d) => raw.biz!.find((x) => x.date === d) ?? { date: d, read: 0, share: 0, zaikan: 0, like: 0, comment: 0, collection: 0, redirectOri: 0, sent: 0, sources: [] }) : null;
  const srcMap = new Map<string, number>();
  for (const d of readDays ?? []) for (const s of d.sources) if (s.scene !== '全部') srcMap.set(s.scene, (srcMap.get(s.scene) ?? 0) + s.users);
  return {
    cur, prev, prevReadable,
    userDays,
    userTotals: raw.users ? userTotals(raw.users, cur) : null,
    userPrev: raw.users ? userTotals(raw.users, prev) : null,
    cumulateEnd: cumMap.get(cur.end) ?? null,
    bySource: [...bySrc].map(([s, v]) => ({ source: sourceName(s), ...v })).sort((a, b) => b.newUser - a.newUser),
    readDays,
    readTotals: raw.biz ? readTotals(raw.biz, cur) : null,
    readPrev: raw.biz && prevReadable ? readTotals(raw.biz, prev) : null,
    readSources: [...srcMap].map(([scene, users]) => ({ scene, users })).sort((a, b) => b.users - a.users),
    articles: raw.articles ? [...raw.articles].sort((a, b) => b.read - a.read || a.title.localeCompare(b.title)) : null,
    errors: raw.errors,
  };
}

/** 环比：上周为 0 时无法算百分比，返回 null */
export function pct(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}
export const fmtPct = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p}%`);
export const fmtNum = (v: number) => v.toLocaleString('en-US');
export const fmtRate = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

// ---------- 图表（SVG 字符串，类名由页面 / 导出的 HTML 各自定义颜色） ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export { esc as escapeHtml };
const W = 640, H = 150, PAD = 28;

/** 每天「新增 / 取关」成对柱状图 */
export function pairBarsSvg(days: UserDay[]): string {
  const max = Math.max(1, ...days.flatMap((d) => [d.newUser, d.cancelUser]));
  const slot = (W - PAD) / days.length;
  const bw = Math.min(26, slot / 3);
  const y = (v: number) => H - (v / max) * (H - 18);
  let s = `<svg class="mp-svg" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="每日新增与取关关注人数">`;
  s += `<line class="mp-grid" x1="${PAD}" y1="${H}" x2="${W}" y2="${H}"/><text class="mp-axis" x="0" y="12">${max}</text>`;
  days.forEach((d, i) => {
    const x = PAD + i * slot + slot / 2;
    s += `<rect class="mp-new" x="${(x - bw - 1).toFixed(1)}" y="${y(d.newUser).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - y(d.newUser)).toFixed(1)}" rx="2"><title>${d.date} 新增 ${d.newUser}</title></rect>`;
    s += `<rect class="mp-cancel" x="${(x + 1).toFixed(1)}" y="${y(d.cancelUser).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - y(d.cancelUser)).toFixed(1)}" rx="2"><title>${d.date} 取关 ${d.cancelUser}</title></rect>`;
    s += `<text class="mp-axis" x="${x.toFixed(1)}" y="${H + 15}" text-anchor="middle">${d.date.slice(5)}</text>`;
  });
  return s + '</svg>';
}

/** 折线图：values 与 labels 等长，null 的点断开 */
export function lineSvg(labels: string[], values: (number | null)[], cls: string, aria: string): string {
  const nums = values.filter((v): v is number => v !== null);
  const max = Math.max(1, ...nums);
  const min = nums.length ? Math.min(...nums) : 0;
  const lo = min === max ? 0 : Math.max(0, min - (max - min) * 0.2);
  const step = (W - PAD - 16) / Math.max(1, labels.length - 1);
  const px = (i: number) => PAD + 8 + i * step;
  const py = (v: number) => H - 6 - ((v - lo) / (max - lo || 1)) * (H - 28);
  let s = `<svg class="mp-svg" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="${esc(aria)}">`;
  s += `<line class="mp-grid" x1="${PAD}" y1="${H}" x2="${W}" y2="${H}"/><text class="mp-axis" x="0" y="12">${fmtNum(max)}</text>`;
  let path = '';
  values.forEach((v, i) => { if (v === null) return; path += `${path && values[i - 1] !== null && values[i - 1] !== undefined ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`; });
  if (path) s += `<path class="${cls}" d="${path}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  values.forEach((v, i) => {
    if (v !== null) s += `<circle class="${cls}-dot" cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3.5"><title>${labels[i]}：${fmtNum(v)}</title></circle>`;
    s += `<text class="mp-axis" x="${px(i).toFixed(1)}" y="${H + 15}" text-anchor="middle">${labels[i].slice(5)}</text>`;
  });
  return s + '</svg>';
}

// ---------- 导出 ----------

export interface Kpi { label: string; value: string; change: string | null; note?: string }
export function kpis(r: Report): Kpi[] {
  const out: Kpi[] = [];
  if (r.userTotals) {
    out.push({ label: '净增关注', value: fmtNum(r.userTotals.net), change: r.userPrev ? fmtPct(pct(r.userTotals.net, r.userPrev.net)) : null, note: `新增 ${r.userTotals.newUser}，取关 ${r.userTotals.cancelUser}` });
    if (r.cumulateEnd !== null) out.push({ label: '累计关注', value: fmtNum(r.cumulateEnd), change: null });
  }
  if (r.readTotals) {
    const p = r.readPrev;
    out.push({ label: '阅读人数（按天累加）', value: fmtNum(r.readTotals.read), change: p ? fmtPct(pct(r.readTotals.read, p.read)) : null });
    out.push({ label: '分享人数（按天累加）', value: fmtNum(r.readTotals.share), change: p ? fmtPct(pct(r.readTotals.share, p.share)) : null });
    out.push({ label: '发表篇数', value: fmtNum(r.readTotals.sent), change: p ? fmtPct(pct(r.readTotals.sent, p.sent)) : null });
  }
  return out;
}

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function reportMarkdown(r: Report, ai?: string): string {
  const L: string[] = [`# 公众号数据周报 ${r.cur.begin} ~ ${r.cur.end}`, ''];
  L.push('> 数据来自微信公众平台官方数据接口；阅读 / 分享人数为每天的人数相加，同一个人在不同天阅读会重复计算。', '');
  if (ai) L.push('## 解读', '', ai.trim(), '');
  const k = kpis(r);
  if (k.length) {
    L.push('## 核心指标', '', `| 指标 | 本周 | 较上周（${r.prev.begin} ~ ${r.prev.end}） |`, '|---|---|---|');
    for (const x of k) L.push(`| ${x.label} | ${x.value}${x.note ? `（${x.note}）` : ''} | ${x.change ?? '—'} |`);
    L.push('');
  }
  if (r.userDays) {
    L.push('## 每日涨粉', '', '| 日期 | 新增 | 取关 | 净增 | 累计 |', '|---|---|---|---|---|');
    for (const d of r.userDays) L.push(`| ${d.date} | ${d.newUser} | ${d.cancelUser} | ${d.net} | ${d.cumulate ?? '—'} |`);
    L.push('');
    if (r.bySource.length) { L.push('## 关注渠道', '', '| 渠道 | 新增 | 取关 |', '|---|---|---|'); for (const s of r.bySource) L.push(`| ${s.source} | ${s.newUser} | ${s.cancelUser} |`); L.push(''); }
  }
  if (r.readDays) {
    L.push('## 每日阅读', '', '| 日期 | 阅读人数 | 分享人数 | 在看 | 点赞 | 留言 | 收藏 | 发表篇数 |', '|---|---|---|---|---|---|---|---|');
    for (const d of r.readDays) L.push(`| ${d.date} | ${d.read} | ${d.share} | ${d.zaikan} | ${d.like} | ${d.comment} | ${d.collection} | ${d.sent} |`);
    L.push('');
  }
  if (r.articles?.length) {
    L.push('## 本周发表的文章（按阅读人数）', '', '| 文章 | 发表日 | 阅读人数 | 分享 | 在看 | 点赞 | 留言 | 阅读后关注 |', '|---|---|---|---|---|---|---|---|');
    for (const a of r.articles) L.push(`| ${mdCell(a.title)} | ${a.publishDate} | ${a.read} | ${a.share} | ${a.zaikan} | ${a.like} | ${a.comment} | ${a.readSubscribe} |`);
    L.push('', '文章指标为发表日至统计日期的累计（官方每篇只统计发表后 30 天）。', '');
  }
  for (const [k2, v] of Object.entries(r.errors)) L.push(`> 注意：${({ users: '涨粉数据', cumulate: '累计关注数据', biz: '阅读数据', articles: '文章明细' } as Record<string, string>)[k2]}没有取到：${v}`);
  return L.join('\n') + '\n';
}

const CSS = `:root{--ink:#1d2430;--muted:#667085;--line:#e4e7ec;--bg:#f7f6f4;--card:#fff;--new:#0f766e;--cancel:#c2410c;--read:#be123c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 18px 56px}h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:28px 0 10px}
.sub{color:var(--muted);font-size:.9rem}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:14px}.kpi span{display:block;color:var(--muted);font-size:.85rem}.kpi b{font-size:1.6rem}.kpi i{font-style:normal;font-size:.85rem;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted);font-weight:600}td.n{font-variant-numeric:tabular-nums}
.mp-svg{width:100%;height:auto}.mp-new{fill:var(--new)}.mp-cancel{fill:var(--cancel)}.mp-grid{stroke:var(--line)}.mp-axis{fill:var(--muted);font-size:11px}
.mp-line-cum{stroke:var(--new)}.mp-line-cum-dot{fill:var(--new)}.mp-line-read{stroke:var(--read)}.mp-line-read-dot{fill:var(--read)}
.ai{white-space:pre-wrap}.warn{color:#8a5300;background:#fbefd9;border-radius:8px;padding:8px 12px;margin-top:10px;font-size:.9rem}.legend{font-size:.85rem;color:var(--muted)}
@media(prefers-color-scheme:dark){:root{--ink:#e7e9ee;--muted:#9aa3b2;--line:#2b3340;--bg:#14181f;--card:#1b212b;--new:#4fd1c5;--cancel:#fb923c;--read:#fb7185}}`;

/** 单文件 HTML 周报，离线可看，可直接发给同事（内容均为本机生成，没有外链） */
export function reportHtml(r: Report, ai?: string): string {
  const k = kpis(r);
  const h: string[] = [];
  h.push(`<h1>公众号数据周报</h1><div class="sub">${r.cur.begin} ~ ${r.cur.end}（对比 ${r.prev.begin} ~ ${r.prev.end}） · 数据来自微信公众平台官方数据接口</div>`);
  if (ai) h.push(`<h2>解读</h2><div class="card ai">${esc(ai.trim())}</div>`);
  if (k.length) h.push(`<div class="kpis">${k.map((x) => `<div class="card kpi"><span>${esc(x.label)}</span><b>${esc(x.value)}</b> <i>${x.change ? `较上周 ${esc(x.change)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</i></div>`).join('')}</div>`);
  if (r.userDays) {
    h.push(`<h2>每日涨粉</h2><div class="card">${pairBarsSvg(r.userDays)}<div class="legend">深绿：新增关注　橙：取消关注</div>`);
    if (r.userDays.some((d) => d.cumulate !== null)) h.push(lineSvg(r.userDays.map((d) => d.date), r.userDays.map((d) => d.cumulate), 'mp-line-cum', '累计关注人数'), '<div class="legend">累计关注人数</div>');
    h.push('</div>');
    if (r.bySource.length) h.push(`<h2>关注渠道</h2><div class="card"><table><tr><th>渠道</th><th>新增</th><th>取关</th></tr>${r.bySource.map((s) => `<tr><td>${esc(s.source)}</td><td class="n">${s.newUser}</td><td class="n">${s.cancelUser}</td></tr>`).join('')}</table></div>`);
  }
  if (r.readDays) h.push(`<h2>每日阅读人数</h2><div class="card">${lineSvg(r.readDays.map((d) => d.date), r.readDays.map((d) => d.read), 'mp-line-read', '每日阅读人数')}</div>`);
  if (r.readSources.length) h.push(`<h2>阅读来源（按天累加）</h2><div class="card"><table><tr><th>来源</th><th>人数</th></tr>${r.readSources.map((s) => `<tr><td>${esc(s.scene)}</td><td class="n">${s.users}</td></tr>`).join('')}</table></div>`);
  if (r.articles?.length) h.push(`<h2>本周发表的文章</h2><div class="card"><table><tr><th>文章</th><th>发表日</th><th>阅读人数</th><th>分享</th><th>在看</th><th>点赞</th><th>留言</th><th>阅读后关注</th></tr>${r.articles.map((a) => `<tr><td>${a.url ? `<a href="${esc(a.url)}">${esc(a.title)}</a>` : esc(a.title)}</td><td class="n">${a.publishDate}</td><td class="n">${a.read}</td><td class="n">${a.share}</td><td class="n">${a.zaikan}</td><td class="n">${a.like}</td><td class="n">${a.comment}</td><td class="n">${a.readSubscribe}</td></tr>`).join('')}</table><div class="legend">文章指标为发表日至统计日期的累计，官方每篇只统计发表后 30 天。</div></div>`);
  for (const [k2, v] of Object.entries(r.errors)) h.push(`<div class="warn">${({ users: '涨粉数据', cumulate: '累计关注数据', biz: '阅读数据', articles: '文章明细' } as Record<string, string>)[k2]}没有取到：${esc(v ?? '')}</div>`);
  h.push('<p class="legend">阅读 / 分享人数为每天的人数相加，同一个人在不同天阅读会重复计算。</p>');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公众号数据周报 ${r.cur.begin} ~ ${r.cur.end}</title><style>${CSS}</style></head><body><main>${h.join('')}</main></body></html>`;
}

// ---------- AI 解读 ----------

export type Chat = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[], opts?: { json?: boolean; temperature?: number }) => Promise<string>;

/** 只把汇总数字和文章标题发给用户自己配置的大模型，不发 AppID / AppSecret / 链接 */
export function aiMessages(r: Report): { role: 'system' | 'user'; content: string }[] {
  const data = {
    本周: `${r.cur.begin}~${r.cur.end}`, 上周: r.prevReadable ? `${r.prev.begin}~${r.prev.end}` : '无可比数据',
    涨粉: r.userTotals ? { ...r.userTotals, 上周: r.userPrev, 累计关注: r.cumulateEnd, 渠道: r.bySource.slice(0, 6) } : '未取到',
    阅读: r.readTotals ? { ...r.readTotals, 上周: r.readPrev, 来源: r.readSources.slice(0, 6) } : '未取到',
    文章: (r.articles ?? []).slice(0, 8).map((a) => ({ 标题: a.title, 阅读人数: a.read, 分享: a.share, 在看: a.zaikan, 点赞: a.like, 留言: a.comment, 阅读后关注: a.readSubscribe })),
  };
  return [
    { role: 'system', content: '你是公众号运营分析助手。只根据给出的数据写周报解读，用简体中文，不编造数据里没有的数字或原因；原因只能写成「可能」的推测并说明依据。输出 3 段：本周概况、亮点与问题、下周建议（每条建议要对应到数据）。总字数 400 字以内，不使用 Markdown 标题符号。' },
    { role: 'user', content: `这是公众号一周的数据（JSON）。阅读/分享人数是每天人数相加。请写周报解读。\n${JSON.stringify(data)}` },
  ];
}

export async function aiInterpret(r: Report, chat: Chat): Promise<string> {
  const t = (await chat(aiMessages(r), { temperature: 0.4 })).trim();
  if (!t) throw new Error('大模型没有返回内容，请检查设置页的接口地址、密钥和模型名');
  return t;
}
