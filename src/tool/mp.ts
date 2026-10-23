// 微信公众号数据统计接口（域名 api.weixin.qq.com）。接口地址、参数与限制核对自微信开发者文档（developers.weixin.qq.com/doc/service/api/wedata/…），2026-10-23：
//   GET  /cgi-bin/token?grant_type=client_credential&appid=APPID&secret=APPSECRET     获取 access_token，有效期 7200 秒
//   POST /datacube/getusersummary?access_token=    {begin_date,end_date} 最长 7 天；list[{ref_date,user_source,new_user,cancel_user}]
//   POST /datacube/getusercumulate?access_token=   {begin_date,end_date} 最长 7 天；list[{ref_date,cumulate_user}]
//   POST /datacube/getbizsummary?access_token=     {begin_date,end_date} 最长 30 天，数据从 2025-11-01 起；list[{ref_date,detail{read_user,share_user,zaikan_user,like_user,comment_count,collection_user,redirect_ori_page_user,send_page_count,read_user_source[]}}]
//   POST /datacube/getarticletotaldetail?access_token=  {begin_date,end_date} 只支持查 1 天（两个日期相同），数据从 2025-11-01 起；
//        list[{ref_date,msgid,title,content_url,detail_list[{stat_date,read_user,share_user,…}]}]，detail_list 里各指标是发表日到 stat_date 的累计，每篇只统计发表后 30 天
// 以上接口：必须在服务器端调用；公众号 / 服务号均「仅认证」的账号可调用；end_date 最大为昨天；每天 8 点后才能取到前一天的数据。
// 旧的 getarticlesummary / getarticletotal 官方已标注停止维护，本工具不用。
// 请求的构造与响应的解析都是纯函数；真正发请求的 http 函数从外面传入，测试里用录制格式的应答代替。

export const API = 'https://api.weixin.qq.com';
const q = (t: string) => `access_token=${encodeURIComponent(t)}`;
export const urls = {
  token: (appId: string, secret: string) => `${API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`,
  userSummary: (t: string) => `${API}/datacube/getusersummary?${q(t)}`,
  userCumulate: (t: string) => `${API}/datacube/getusercumulate?${q(t)}`,
  bizSummary: (t: string) => `${API}/datacube/getbizsummary?${q(t)}`,
  articleDetail: (t: string) => `${API}/datacube/getarticletotaldetail?${q(t)}`,
};

/** 错误码 → 中文提示。只收录在官方文档里核对过含义的错误码（获取 access_token 页、各数据接口页、全局返回码） */
const ERRORS: Record<number, string> = {
  [-1]: '微信服务器繁忙，请稍后再试',
  40001: 'AppSecret 不对，或 access_token 已失效。请核对 AppSecret，并确认 AppID 与 AppSecret 属于同一个公众号',
  40013: 'AppID 不对，请检查是否填错（注意大小写和多余空格）',
  40014: 'access_token 不合法或已过期，请重试',
  40125: 'AppSecret 不合法，请检查是否复制完整；忘记了只能在微信开发者平台重置',
  40164: '本机公网 IP 不在公众号的 IP 白名单里',
  40243: 'AppSecret 已被冻结，请到微信开发者平台「我的业务 → 该公众号 → 开发密钥」解冻',
  41001: '缺少 access_token 参数',
  41004: '缺少 AppSecret',
  42001: 'access_token 已过期，请重试',
  45009: '今天的接口调用次数已用完，请明天再试',
  48001: '这个公众号没有调用该接口的权限。数据统计接口只开放给已认证的公众号 / 服务号，请在公众号后台「设置与开发 → 开发接口管理」确认接口权限',
  50002: '公众号受限，可能已被冻结或注销',
  50004: '该公众号被禁止使用 access_token 接口',
  50007: '公众号已冻结',
  61500: '日期格式错误',
  61501: '日期跨度超过接口限制',
  61503: '指定日期的数据还没有生成，请 8 点以后再取前一天的数据',
};

export class WxError extends Error {
  constructor(public code: number, public raw: string, message: string) {
    super(message);
  }
}

/** 白名单报错里通常带着微信看到的本机 IP，取出来方便用户直接复制 */
export function ipFromErrmsg(errmsg: string): string | null {
  return errmsg.match(/invalid ip\s+([0-9a-fA-F.:]+)/i)?.[1]?.replace(/,$/, '') ?? null;
}

export function wxErrorText(code: number, errmsg = ''): string {
  const base = ERRORS[code];
  if (code === 40164) {
    const ip = ipFromErrmsg(errmsg);
    return `${base}${ip ? `（微信看到的 IP 是 ${ip}）` : ''}。请打开「微信开发者平台（developers.weixin.qq.com/platform）→ 扫码登录 → 我的业务 → 选择这个公众号」，在「API IP 白名单」里加入这个 IP，保存后几分钟再试`;
  }
  const short = errmsg.replace(/\s*rid:.*$/, '').replace(/,?\s*more details at \S+/, '').trim();
  return base ? `${base}（错误码 ${code}）` : `微信接口返回错误 ${code}${short ? `：${short}` : ''}`;
}

export function parseWx<T>(status: number, text: string): T {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new WxError(status, text, `微信接口返回了无法识别的内容（HTTP ${status}）`);
  }
  const code = typeof data.errcode === 'number' ? data.errcode : 0;
  if (code !== 0) throw new WxError(code, String(data.errmsg ?? ''), wxErrorText(code, String(data.errmsg ?? '')));
  if (status >= 400) throw new WxError(status, text, `微信接口请求失败（HTTP ${status}）`);
  return data as T;
}

export interface HttpResponse { status: number; text(): Promise<string> }
export type Http = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export async function call<T>(http: Http, url: string, body?: unknown): Promise<T> {
  const res = await http(url, body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return parseWx<T>(res.status, await res.text());
}

export interface MpCred { appId: string; appSecret: string }
export const CRED_KEY = 'mp-weekly.cred';
export const credReady = (c: MpCred) => Boolean(c.appId.trim() && c.appSecret.trim());

/** access_token 缓存：有效期 7200 秒，提前 10 分钟换新；按 AppID + AppSecret 区分 */
const tokenCache = new Map<string, { token: string; expireAt: number }>();
export const clearTokenCache = () => tokenCache.clear();

export async function getToken(http: Http, cred: MpCred, now = Date.now()): Promise<string> {
  const appId = cred.appId.trim();
  const secret = cred.appSecret.trim();
  if (!appId || !secret) throw new Error('还没有填写公众号 AppID 和 AppSecret');
  const key = `${appId}\n${secret}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expireAt - 600_000 > now) return hit.token;
  const r = await call<{ access_token: string; expires_in: number }>(http, urls.token(appId, secret));
  tokenCache.set(key, { token: r.access_token, expireAt: now + r.expires_in * 1000 });
  return r.access_token;
}

/** 带 token 调用；token 失效（40014 / 42001）时自动换新重试一次 */
export async function withToken<T>(http: Http, cred: MpCred, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await getToken(http, cred));
  } catch (e) {
    if (e instanceof WxError && (e.code === 40014 || e.code === 42001)) {
      clearTokenCache();
      return fn(await getToken(http, cred));
    }
    throw e;
  }
}

// ---------- 日期（全部按北京时间的 yyyy-MM-dd） ----------

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
/** 官方：每天 8 点后才能取前一天的数据。北京时间 8 点前，默认截止到前天 */
export function defaultEndDate(now: number): string {
  const bj = new Date(now + 8 * 3600_000);
  return addDays(bj.toISOString().slice(0, 10), bj.getUTCHours() >= 8 ? -1 : -2);
}
/** 把 [begin,end] 切成每段最多 max 天 */
export function splitRange(begin: string, end: string, max: number): { begin: string; end: string }[] {
  const out: { begin: string; end: string }[] = [];
  for (let b = begin; b <= end; b = addDays(b, max)) out.push({ begin: b, end: addDays(b, max - 1) < end ? addDays(b, max - 1) : end });
  return out;
}
/** 新版「发表内容」接口的数据从这一天起有效 */
export const CONTENT_DATA_START = '2025-11-01';

// ---------- 接口 ----------

export interface UserRow { date: string; source: number; newUser: number; cancelUser: number }
export interface CumRow { date: string; cumulate: number }
export interface SourceCount { scene: string; users: number }
export interface BizDay {
  date: string; read: number; share: number; zaikan: number; like: number; comment: number; collection: number; redirectOri: number; sent: number; sources: SourceCount[];
}
export interface ArticleStat {
  publishDate: string; msgid: string; title: string; url: string; statDate: string; read: number; share: number; zaikan: number; like: number; comment: number;
  collection: number; praiseCents: number; readSubscribe: number; finishRate: number | null; avgMinutes: number | null; sources: SourceCount[];
}

type Raw = Record<string, unknown>;
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const src = (v: unknown): SourceCount[] => (Array.isArray(v) ? v : []).map((x: Raw) => ({ scene: String(x.scene_desc ?? ''), users: n(x.user_count) }));

export async function getUserSummary(http: Http, token: string, begin: string, end: string): Promise<UserRow[]> {
  const out: UserRow[] = [];
  for (const r of splitRange(begin, end, 7)) {
    const res = await call<{ list?: Raw[] }>(http, urls.userSummary(token), { begin_date: r.begin, end_date: r.end });
    out.push(...(res.list ?? []).map((x) => ({ date: String(x.ref_date), source: n(x.user_source), newUser: n(x.new_user), cancelUser: n(x.cancel_user) })));
  }
  return out;
}

export async function getUserCumulate(http: Http, token: string, begin: string, end: string): Promise<CumRow[]> {
  const out: CumRow[] = [];
  for (const r of splitRange(begin, end, 7)) {
    const res = await call<{ list?: Raw[] }>(http, urls.userCumulate(token), { begin_date: r.begin, end_date: r.end });
    out.push(...(res.list ?? []).map((x) => ({ date: String(x.ref_date), cumulate: n(x.cumulate_user) })));
  }
  return out;
}

export async function getBizSummary(http: Http, token: string, begin: string, end: string): Promise<BizDay[]> {
  const out: BizDay[] = [];
  for (const r of splitRange(begin, end, 30)) {
    const res = await call<{ list?: { ref_date: string; detail?: Raw }[] }>(http, urls.bizSummary(token), { begin_date: r.begin, end_date: r.end });
    out.push(...(res.list ?? []).map((x) => {
      const d = x.detail ?? {};
      return { date: String(x.ref_date), read: n(d.read_user), share: n(d.share_user), zaikan: n(d.zaikan_user), like: n(d.like_user), comment: n(d.comment_count), collection: n(d.collection_user), redirectOri: n(d.redirect_ori_page_user), sent: n(d.send_page_count), sources: src(d.read_user_source) };
    }));
  }
  return out;
}

/** 某一天发表的文章；每篇取 detail_list 里统计日期最晚的一条（累计值） */
export async function getArticlesOfDay(http: Http, token: string, date: string): Promise<ArticleStat[]> {
  const res = await call<{ list?: Raw[] }>(http, urls.articleDetail(token), { begin_date: date, end_date: date });
  return (res.list ?? []).map((a) => {
    const details = (Array.isArray(a.detail_list) ? a.detail_list : []) as Raw[];
    const last = details.reduce<Raw | null>((m, d) => (!m || String(d.stat_date) > String(m.stat_date) ? d : m), null) ?? {};
    return {
      publishDate: String(a.ref_date ?? date), msgid: String(a.msgid ?? ''), title: String(a.title ?? ''), url: String(a.content_url ?? ''), statDate: String(last.stat_date ?? ''),
      read: n(last.read_user), share: n(last.share_user), zaikan: n(last.zaikan_user), like: n(last.like_user), comment: n(last.comment_count), collection: n(last.collection_user),
      praiseCents: n(last.praise_money), readSubscribe: n(last.read_subscribe_user),
      finishRate: typeof last.read_finish_rate === 'number' ? last.read_finish_rate : null, avgMinutes: typeof last.read_avg_activetime === 'number' ? last.read_avg_activetime : null,
      sources: src(last.read_user_source),
    };
  });
}
