// 模拟的公众号数据接口：没有认证公众号时用来体验和测试。按官方文档的字段格式应答，数据全部是虚构的示例；
// 同一个 seed 生成的数据完全相同。会像真接口一样校验日期跨度（用户数据 7 天、概况 30 天、文章明细 1 天、2025-11-01 之前无效）。
import { API, CONTENT_DATA_START, addDays, daysBetween, type Http } from './mp';

export const MOCK_CRED = { appId: 'wx_demo_account', appSecret: 'demo-secret' };
const SOURCES = [1, 17, 30, 57, 0];
const TITLES = ['示例：秋季上新清单', '示例：会员日活动规则说明', '示例：门店故事——一杯咖啡的一天', '示例：十月常见问题解答', '示例：周末市集预告', '示例：新品试喝招募'];
const SCENES = ['公众号消息', '聊天会话', '朋友圈', '公众号主页', '其他', '推荐', '搜一搜'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export interface MockMp { http: Http; calls: { url: string; body?: { begin_date: string; end_date: string } }[] }

/** today：模拟「今天」（yyyy-MM-dd），之后的日期取不到（61503）；每周二、周五、周日发文 */
export function createMockMp(today: string, opts: { seed?: number } = {}): MockMp {
  const seed = opts.seed ?? 11;
  const calls: MockMp['calls'] = [];
  const ok = (data: object) => ({ status: 200, text: async () => JSON.stringify({ errcode: 0, errmsg: 'ok', ...data }) });
  const err = (errcode: number, errmsg: string) => ({ status: 200, text: async () => JSON.stringify({ errcode, errmsg }) });
  const dayRand = (d: string, salt: number) => rng(seed * 1009 + hash(d) + salt);
  const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const publishes = (d: string) => [0, 2, 5].includes(weekday(d)) && d >= CONTENT_DATA_START;
  const cum = (d: string) => 12000 + daysBetween('2026-01-01', d) * 9 + Math.floor(dayRand(d, 3)() * 6);
  const articleOf = (d: string) => {
    const r = dayRand(d, 50);
    const base = 180 + Math.floor(r() * 900);
    return { title: TITLES[hash(d) % TITLES.length], base };
  };

  const http: Http = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const path = url.slice(API.length).split('?')[0];
    const u = new URL(url);
    if (path === '/cgi-bin/token') {
      if (u.searchParams.get('appid') !== MOCK_CRED.appId) return err(40013, 'invalid appid');
      if (u.searchParams.get('secret') !== MOCK_CRED.appSecret) return err(40125, 'invalid appsecret');
      return ok({ access_token: 'MOCK_MP_TOKEN', expires_in: 7200 });
    }
    if (!path.startsWith('/datacube/')) return { status: 404, text: async () => 'not found' };
    const b = body as { begin_date: string; end_date: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.begin_date ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(b?.end_date ?? '')) return err(61500, 'date format error');
    const span = daysBetween(b.begin_date, b.end_date) + 1;
    const max = { '/datacube/getusersummary': 7, '/datacube/getusercumulate': 7, '/datacube/getbizsummary': 30, '/datacube/getarticletotaldetail': 1 }[path];
    if (!max) return { status: 404, text: async () => 'not found' };
    if (span < 1 || span > max) return err(61501, 'date range error');
    if (b.end_date >= today) return err(61503, 'data not ready');
    if (path.includes('article') || path.includes('biz')) if (b.begin_date < CONTENT_DATA_START) return err(61501, 'date range error');
    const days = Array.from({ length: span }, (_, i) => addDays(b.begin_date, i));
    switch (path) {
      case '/datacube/getusersummary':
        return ok({ list: days.flatMap((d) => SOURCES.map((s, si) => { const r = dayRand(d, s + 1); return { ref_date: d, user_source: s, new_user: Math.floor(r() * (si === 0 ? 14 : si === 1 ? 6 : 4)), cancel_user: Math.floor(r() * (si === 0 ? 6 : 2)) }; }).filter((x) => x.new_user || x.cancel_user)) });
      case '/datacube/getusercumulate':
        return ok({ list: days.map((d) => ({ ref_date: d, cumulate_user: cum(d) })) });
      case '/datacube/getbizsummary':
        return ok({
          is_delay: false,
          list: days.map((d) => {
            const r = dayRand(d, 9);
            const sent = publishes(d) ? 1 : 0;
            const read = Math.floor(120 + r() * 380 + sent * 300);
            const parts = SCENES.map((scene) => ({ scene_desc: scene, user_count: Math.floor(read * (scene === '公众号消息' ? 0.4 : scene === '朋友圈' ? 0.2 : 0.07)) }));
            return { ref_date: d, detail: { read_user: read, read_user_source: [{ scene_desc: '全部', user_count: read }, ...parts], share_user: Math.floor(read * 0.05), zaikan_user: Math.floor(read * 0.03), like_user: Math.floor(read * 0.04), comment_count: Math.floor(r() * 5), collection_user: Math.floor(read * 0.02), redirect_ori_page_user: 0, send_page_count: sent } };
          }),
        });
      case '/datacube/getarticletotaldetail': {
        const d = b.begin_date;
        if (!publishes(d)) return ok({ list: [], is_delay: false });
        const a = articleOf(d);
        const last = addDays(today, -1);
        const detail_list = Array.from({ length: Math.min(30, daysBetween(d, last) + 1) }, (_, i) => {
          const f = Math.min(1, (i + 1) / 3);
          const read = Math.floor(a.base * f);
          return { stat_date: addDays(d, i), read_user: read, read_user_source: [{ scene_desc: '全部', user_count: read }, { scene_desc: '公众号消息', user_count: Math.floor(read * 0.45) }, { scene_desc: '朋友圈', user_count: Math.floor(read * 0.2) }], share_user: Math.floor(read * 0.06), zaikan_user: Math.floor(read * 0.03), like_user: Math.floor(read * 0.04), comment_count: Math.floor(read / 150), collection_user: Math.floor(read * 0.02), praise_money: 0, read_subscribe_user: Math.floor(read * 0.012), read_delivery_rate: 0.8, read_finish_rate: 0.46, read_avg_activetime: 1.4, read_jump_position: [] };
        });
        return ok({ is_delay: false, list: [{ ref_date: d, msgid: `${hash(d) % 100000}_1`, publish_type: 0, title: a.title, content_url: `https://mp.weixin.qq.com/s/demo-${d}`, detail_list }] });
      }
    }
    return { status: 404, text: async () => 'not found' };
  };
  return { http, calls };
}
