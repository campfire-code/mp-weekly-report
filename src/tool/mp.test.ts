// 公众号接口层：地址、错误码、token 缓存、日期切分、按官方字段格式（录制样例）解析。不访问网络。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  WxError, addDays, clearTokenCache, daysBetween, defaultEndDate, getArticlesOfDay, getBizSummary, getToken, getUserCumulate, getUserSummary, ipFromErrmsg, parseWx, splitRange, urls, withToken, type Http,
} from './mp';

beforeEach(() => clearTokenCache());
const reply = (obj: object): ReturnType<Http> => Promise.resolve({ status: 200, text: async () => JSON.stringify(obj) });

describe('地址与错误码', () => {
  it('接口地址与官方文档一致', () => {
    expect(urls.token('wx1', 'a&b')).toBe('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wx1&secret=a%26b');
    expect(urls.userSummary('T')).toBe('https://api.weixin.qq.com/datacube/getusersummary?access_token=T');
    expect(urls.userCumulate('T')).toBe('https://api.weixin.qq.com/datacube/getusercumulate?access_token=T');
    expect(urls.bizSummary('T')).toBe('https://api.weixin.qq.com/datacube/getbizsummary?access_token=T');
    expect(urls.articleDetail('T')).toBe('https://api.weixin.qq.com/datacube/getarticletotaldetail?access_token=T');
  });
  it('errcode 非 0 抛出中文提示', () => {
    expect(() => parseWx(200, '{"errcode":61501,"errmsg":"date range error"}')).toThrow('日期跨度超过接口限制');
    expect(() => parseWx(200, '{"errcode":61503,"errmsg":"data not ready"}')).toThrow('8 点以后');
    expect(() => parseWx(200, '{"errcode":48001,"errmsg":"api unauthorized"}')).toThrow(/已认证/);
    expect(() => parseWx(200, '{"errcode":99999,"errmsg":"boom rid: abc"}')).toThrow('微信接口返回错误 99999：boom');
    expect(() => parseWx(502, '<html>')).toThrow('无法识别');
  });
  it('40164 提示加 IP 白名单并带上 IP', () => {
    try { parseWx(200, '{"errcode":40164,"errmsg":"invalid ip 1.2.3.4, not in whitelist rid: x"}'); } catch (e) {
      expect(e).toBeInstanceOf(WxError);
      expect((e as Error).message).toContain('API IP 白名单');
      expect((e as Error).message).toContain('1.2.3.4');
    }
    expect(ipFromErrmsg('nothing')).toBeNull();
  });
});

describe('日期', () => {
  it('加减天数、天数差', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
  });
  it('北京时间 8 点前默认截止到前天，8 点后到昨天', () => {
    expect(defaultEndDate(Date.UTC(2026, 9, 22, 23, 59))).toBe('2026-10-21'); // 北京 10-23 07:59
    expect(defaultEndDate(Date.UTC(2026, 9, 23, 0, 0))).toBe('2026-10-22'); // 北京 10-23 08:00
  });
  it('切段不超过最大天数、不重叠', () => {
    expect(splitRange('2026-10-01', '2026-10-14', 7)).toEqual([{ begin: '2026-10-01', end: '2026-10-07' }, { begin: '2026-10-08', end: '2026-10-14' }]);
    expect(splitRange('2026-10-01', '2026-10-10', 7)).toEqual([{ begin: '2026-10-01', end: '2026-10-07' }, { begin: '2026-10-08', end: '2026-10-10' }]);
    expect(splitRange('2026-10-01', '2026-10-01', 7)).toHaveLength(1);
  });
});

describe('token', () => {
  it('缓存；过期（40014）自动换新重试一次', async () => {
    let tokens = 0;
    let first = true;
    const http: Http = (url) => {
      if (url.includes('/cgi-bin/token')) return reply({ access_token: `T${++tokens}`, expires_in: 7200 });
      if (first) { first = false; return reply({ errcode: 40014, errmsg: 'invalid access_token' }); }
      return reply({ list: [{ ref_date: '2026-10-18', cumulate_user: 5 }] });
    };
    const cred = { appId: 'wx1', appSecret: 's' };
    const r = await withToken(http, cred, (t) => getUserCumulate(http, t, '2026-10-18', '2026-10-18'));
    expect(r).toEqual([{ date: '2026-10-18', cumulate: 5 }]);
    expect(tokens).toBe(2);
    await getToken(http, cred);
    expect(tokens).toBe(2);
    await expect(getToken(http, { appId: '', appSecret: '' })).rejects.toThrow('还没有填写');
  });
});

/** 按官方文档示例格式录制的应答 */
describe('按官方字段解析', () => {
  it('getusersummary 按 7 天分段请求并合并', async () => {
    const bodies: { begin_date: string; end_date: string }[] = [];
    const http: Http = (_u, init) => {
      const b = JSON.parse(init!.body as string);
      bodies.push(b);
      return reply({ list: [{ ref_date: b.begin_date, user_source: 30, new_user: 3, cancel_user: 1 }] });
    };
    const r = await getUserSummary(http, 'T', '2026-10-05', '2026-10-18');
    expect(bodies).toEqual([{ begin_date: '2026-10-05', end_date: '2026-10-11' }, { begin_date: '2026-10-12', end_date: '2026-10-18' }]);
    expect(r).toEqual([{ date: '2026-10-05', source: 30, newUser: 3, cancelUser: 1 }, { date: '2026-10-12', source: 30, newUser: 3, cancelUser: 1 }]);
  });
  it('getbizsummary', async () => {
    const http: Http = () => reply({ is_delay: false, list: [{ ref_date: '2026-10-18', detail: { read_user: 120, read_user_source: [{ scene_desc: '全部', user_count: 120 }, { scene_desc: '朋友圈', user_count: 30 }], share_user: 6, zaikan_user: 3, like_user: 4, comment_count: 1, collection_user: 2, redirect_ori_page_user: 0, send_page_count: 1 } }] });
    const r = await getBizSummary(http, 'T', '2026-10-18', '2026-10-18');
    expect(r[0]).toMatchObject({ date: '2026-10-18', read: 120, share: 6, zaikan: 3, like: 4, comment: 1, collection: 2, sent: 1 });
    expect(r[0].sources).toEqual([{ scene: '全部', users: 120 }, { scene: '朋友圈', users: 30 }]);
  });
  it('getarticletotaldetail 每篇取统计日期最晚的一条（累计值）', async () => {
    const http: Http = (_u, init) => {
      expect(JSON.parse(init!.body as string)).toEqual({ begin_date: '2026-10-15', end_date: '2026-10-15' });
      return reply({ is_delay: false, list: [{ ref_date: '2026-10-15', msgid: '12003_1', publish_type: 0, title: '示例文章', content_url: 'http://mp.weixin.qq.com/s?__biz=x', detail_list: [
        { stat_date: '2026-10-17', read_user: 90, share_user: 5, read_finish_rate: 0.5 },
        { stat_date: '2026-10-16', read_user: 60, share_user: 3 },
        { stat_date: '2026-10-18', read_user: 100, share_user: 7, zaikan_user: 2, like_user: 3, comment_count: 1, collection_user: 1, read_subscribe_user: 4, read_avg_activetime: 1.5 },
      ] }] });
    };
    const [a] = await getArticlesOfDay(http, 'T', '2026-10-15');
    expect(a).toMatchObject({ msgid: '12003_1', title: '示例文章', statDate: '2026-10-18', read: 100, share: 7, zaikan: 2, like: 3, comment: 1, readSubscribe: 4, avgMinutes: 1.5, finishRate: null });
  });
  it('没有数据时返回空数组', async () => {
    expect(await getArticlesOfDay(() => reply({ errcode: 0 }), 'T', '2026-10-15')).toEqual([]);
    expect(await getBizSummary(() => reply({ errcode: 0 }), 'T', '2026-10-15', '2026-10-15')).toEqual([]);
  });
});
