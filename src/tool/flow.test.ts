// 取数流程：模拟公众号数据接口（校验日期跨度），不访问网络。
import { beforeEach, describe, expect, it } from 'vitest';
import { collectReport } from './flow';
import { MOCK_CRED, createMockMp } from './mock';
import { clearTokenCache, type Http } from './mp';

beforeEach(() => clearTokenCache());
const END = '2026-10-18';

describe('生成周报', () => {
  it('按接口限制分段取数：用户数据 7 天、概况 30 天、文章每个发文日 1 天', async () => {
    const m = createMockMp('2026-10-19');
    const r = await collectReport(m.http, MOCK_CRED, END);
    const by = (p: string) => m.calls.filter((c) => c.url.includes(p));
    expect(by('getusersummary')).toHaveLength(2);
    expect(by('getusercumulate')).toHaveLength(1);
    expect(by('getbizsummary')).toHaveLength(1);
    expect(by('getbizsummary')[0].body).toEqual({ begin_date: '2026-10-05', end_date: '2026-10-18' });
    const published = r.readDays!.filter((d) => d.sent > 0).length;
    expect(published).toBeGreaterThan(0);
    expect(by('getarticletotaldetail')).toHaveLength(published);
    expect(r.articles).toHaveLength(published);
    expect(r.errors).toEqual({});
    expect(r.userTotals!.newUser).toBeGreaterThan(0);
    expect(r.cumulateEnd).toBeGreaterThan(10000);
  });
  it('相同日期生成的周报完全一致', async () => {
    const a = await collectReport(createMockMp('2026-10-19').http, MOCK_CRED, END);
    const b = await collectReport(createMockMp('2026-10-19').http, MOCK_CRED, END);
    expect(a).toEqual(b);
  });
  it('一部分取数失败不影响其他部分', async () => {
    const m = createMockMp('2026-10-19');
    const http: Http = (url, init) => url.includes('getbizsummary') ? Promise.resolve({ status: 200, text: async () => '{"errcode":61503,"errmsg":"data not ready"}' }) : m.http(url, init);
    const r = await collectReport(http, MOCK_CRED, END);
    expect(r.errors.biz).toContain('8 点以后');
    expect(r.readDays).toBeNull();
    expect(r.articles).toBeNull();
    expect(r.userDays).toHaveLength(7);
  });
  it('截止日期太新（数据未生成）时每部分都失败，给出明确错误', async () => {
    const m = createMockMp('2026-10-19');
    await expect(collectReport(m.http, MOCK_CRED, '2026-10-19')).rejects.toThrow('没有取到任何数据');
  });
  it('阅读数据早于 2025-11-01 的周只出涨粉部分，并说明原因', async () => {
    const m = createMockMp('2025-11-20');
    const r = await collectReport(m.http, MOCK_CRED, '2025-11-05');
    expect(r.userDays).toHaveLength(7);
    expect(r.readDays).toBeNull();
    expect(r.errors.biz).toContain('2025-11-01');
    expect(m.calls.some((c) => c.url.includes('getbizsummary'))).toBe(false);
  });
  it('凭据错误、没有权限直接报出，不退化成空报告', async () => {
    const m = createMockMp('2026-10-19');
    await expect(collectReport(m.http, { appId: 'wxbad', appSecret: 'x' }, END)).rejects.toThrow(/AppID 不对/);
    await expect(collectReport(m.http, { appId: MOCK_CRED.appId, appSecret: 'x' }, END)).rejects.toThrow(/AppSecret/);
    const denied: Http = (url) => Promise.resolve({ status: 200, text: async () => url.includes('/cgi-bin/token') ? '{"access_token":"T","expires_in":7200}' : '{"errcode":48001,"errmsg":"api unauthorized"}' });
    await expect(collectReport(denied, MOCK_CRED, END)).rejects.toThrow(/已认证/);
  });
  it('可以中途停止', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(collectReport(createMockMp('2026-10-19').http, MOCK_CRED, END, undefined, ac.signal)).rejects.toThrow('已停止');
  });
});
