// 周报汇总、环比、图表、导出、AI 解读。
import { describe, expect, it } from 'vitest';
import { aiInterpret, aiMessages, buildReport, fmtPct, kpis, lineSvg, pairBarsSvg, pct, reportHtml, reportMarkdown, weekPeriods, type RawData } from './core';
import type { ArticleStat, BizDay, UserRow } from './mp';

const END = '2026-10-18';
const { cur, prev } = weekPeriods(END);
const days = (p: { begin: string }) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${p.begin}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10));
const users: UserRow[] = [
  ...days(cur).flatMap((d) => [{ date: d, source: 30, newUser: 4, cancelUser: 1 }, { date: d, source: 1, newUser: 2, cancelUser: 0 }]),
  ...days(prev).map((d) => ({ date: d, source: 30, newUser: 3, cancelUser: 1 })),
];
const bizDay = (date: string, read: number, sent = 0): BizDay => ({ date, read, share: 5, zaikan: 1, like: 2, comment: 1, collection: 1, redirectOri: 0, sent, sources: [{ scene: '全部', users: read }, { scene: '朋友圈', users: 10 }] });
const biz = [...days(prev).map((d) => bizDay(d, 100)), ...days(cur).map((d, i) => bizDay(d, 150, i === 2 ? 1 : 0))];
const art = (p: Partial<ArticleStat>): ArticleStat => ({ publishDate: '2026-10-14', msgid: '1_1', title: '示例文章', url: '', statDate: END, read: 10, share: 0, zaikan: 0, like: 0, comment: 0, collection: 0, praiseCents: 0, readSubscribe: 0, finishRate: null, avgMinutes: null, sources: [], ...p });
const raw = (p: Partial<RawData> = {}): RawData => ({ end: END, users, cumulate: days(cur).map((d, i) => ({ date: d, cumulate: 1000 + i * 10 })), biz, articles: [art({ title: 'B', read: 5 }), art({ title: 'A<script>', read: 50, msgid: '2_1' })], errors: {}, ...p });

describe('周期与环比', () => {
  it('本周 7 天、上周 7 天不重叠', () => {
    expect(cur).toEqual({ begin: '2026-10-12', end: '2026-10-18' });
    expect(prev).toEqual({ begin: '2026-10-05', end: '2026-10-11' });
  });
  it('pct 与格式', () => {
    expect(pct(150, 100)).toBe(50);
    expect(pct(50, 100)).toBe(-50);
    expect(pct(5, 0)).toBeNull();
    expect(fmtPct(50)).toBe('+50%');
    expect(fmtPct(-3.5)).toBe('-3.5%');
    expect(fmtPct(null)).toBe('—');
  });
});

describe('汇总', () => {
  const r = buildReport(raw());
  it('涨粉合计、净增、环比、累计与渠道', () => {
    expect(r.userTotals).toEqual({ newUser: 42, cancelUser: 7, net: 35 });
    expect(r.userPrev).toEqual({ newUser: 21, cancelUser: 7, net: 14 });
    expect(r.cumulateEnd).toBe(1060);
    expect(r.userDays).toHaveLength(7);
    expect(r.userDays![0]).toMatchObject({ date: '2026-10-12', newUser: 6, cancelUser: 1, net: 5, cumulate: 1000 });
    expect(r.bySource.map((s) => [s.source, s.newUser])).toEqual([['扫描二维码', 28], ['公众号搜索', 14]]);
  });
  it('阅读合计、环比、来源不含「全部」、文章按阅读排序', () => {
    expect(r.readTotals).toMatchObject({ read: 1050, sent: 1 });
    expect(r.readPrev).toMatchObject({ read: 700, sent: 0 });
    expect(r.readSources).toEqual([{ scene: '朋友圈', users: 70 }]);
    expect(r.articles!.map((a) => a.title)).toEqual(['A<script>', 'B']);
    const k = kpis(r);
    expect(k.find((x) => x.label === '净增关注')).toMatchObject({ value: '35', change: '+150%' });
    expect(k.find((x) => x.label.startsWith('阅读人数'))).toMatchObject({ value: '1,050', change: '+50%' });
  });
  it('缺少的天补零；某部分取数失败时该部分为空，其余照常', () => {
    const partial = buildReport(raw({ biz: [bizDay('2026-10-14', 80)], users: null, articles: null, errors: { users: '失败了' } }));
    expect(partial.userDays).toBeNull();
    expect(partial.readDays!.map((d) => d.read)).toEqual([0, 0, 80, 0, 0, 0, 0]);
    expect(partial.errors.users).toBe('失败了');
    expect(kpis(partial).every((x) => !x.label.includes('关注'))).toBe(true);
  });
  it('上周早于 2025-11-01 时阅读数据不做环比', () => {
    const early = buildReport({ ...raw(), end: '2025-11-10', users: null, cumulate: null, biz: biz.map((b) => ({ ...b, date: b.date.replace('2026-10', '2025-11') })), articles: [] });
    expect(early.prevReadable).toBe(false);
    expect(early.readPrev).toBeNull();
  });
});

describe('图表与导出', () => {
  const r = buildReport(raw());
  it('SVG：柱数 = 天数 × 2；折线遇到 null 断开', () => {
    expect((pairBarsSvg(r.userDays!).match(/<rect /g) ?? []).length).toBe(14);
    const s = lineSvg(['2026-10-12', '2026-10-13', '2026-10-14'], [1, null, 3], 'mp-line-read', '测试');
    expect((s.match(/<circle /g) ?? []).length).toBe(2);
    expect((s.match(/M/g) ?? []).length).toBe(2);
    expect(lineSvg(['a', 'b'], [null, null], 'x', 'y')).not.toContain('<path');
  });
  it('Markdown 含各节与说明', () => {
    const md = reportMarkdown(r, '解读正文');
    expect(md).toContain('# 公众号数据周报 2026-10-12 ~ 2026-10-18');
    expect(md).toContain('## 解读\n\n解读正文');
    expect(md).toContain('| 净增关注 | 35（新增 42，取关 7） | +150% |');
    expect(md).toContain('| 2026-10-12 | 6 | 1 | 5 | 1000 |');
    expect(md).toContain('同一个人在不同天阅读会重复计算');
  });
  it('HTML 单文件：转义标题、无外链脚本', () => {
    const html = reportHtml(r);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('A&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/src="http/);
    expect(html).toContain('<svg');
  });
  it('取数失败的部分在导出里有说明', () => {
    const md = reportMarkdown(buildReport(raw({ users: null, errors: { users: '没权限' } })));
    expect(md).toContain('涨粉数据没有取到：没权限');
  });
});

describe('AI 解读', () => {
  const r = buildReport(raw());
  it('提示词只含汇总数字和文章标题，不含凭据', () => {
    const text = aiMessages(r).map((m) => m.content).join('\n');
    expect(text).toContain('"net":35');
    expect(text).toContain('A<script>');
    expect(text).not.toMatch(/wx[0-9a-z_]{6,}|secret|access_token/i);
  });
  it('用假的大模型函数返回解读；空返回报错', async () => {
    const seen: string[] = [];
    expect(await aiInterpret(r, async (m) => { seen.push(m[1].content); return '  解读  '; })).toBe('解读');
    expect(seen[0]).toContain('2026-10-12~2026-10-18');
    await expect(aiInterpret(r, async () => ' ')).rejects.toThrow('没有返回内容');
  });
});
