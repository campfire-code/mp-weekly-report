// 取数流程：一周（本周 + 上周）的涨粉、累计关注、阅读概况，以及本周发表文章的明细。各部分独立取数，一部分失败不影响其他部分。
import {
  CONTENT_DATA_START, WxError, getArticlesOfDay, getBizSummary, getUserCumulate, getUserSummary, withToken,
  type ArticleStat, type Http, type MpCred,
} from './mp';
import { buildReport, weekPeriods, type RawData, type Report } from './core';

const fatal = (e: unknown) => e instanceof WxError && [40001, 40013, 40125, 40164, 40243, 41001, 41004, 50002, 50004, 50007, 45009].includes(e.code);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function collectReport(http: Http, cred: MpCred, end: string, onStep?: (t: string) => void, signal?: AbortSignal): Promise<Report> {
  const { cur, prev } = weekPeriods(end);
  const errors: RawData['errors'] = {};
  const check = () => { if (signal?.aborted) throw new Error('已停止'); };
  const raw: RawData = { end, users: null, cumulate: null, biz: null, articles: null, errors };
  await withToken(http, cred, async (token) => {
    const part = async <T>(key: keyof RawData['errors'], text: string, fn: () => Promise<T>): Promise<T | null> => {
      check(); onStep?.(text);
      try { return await fn(); } catch (e) {
        // 凭据 / 权限 / 次数类的问题每个部分都会遇到，直接报出；token 过期交给 withToken 重试
        if (fatal(e) || (e instanceof WxError && (e.code === 40014 || e.code === 42001))) throw e;
        errors[key] = msg(e);
        return null;
      }
    };
    raw.users = await part('users', '正在取涨粉数据…', () => getUserSummary(http, token, prev.begin, cur.end));
    raw.cumulate = await part('cumulate', '正在取累计关注数据…', () => getUserCumulate(http, token, cur.begin, cur.end));
    const bizBegin = prev.begin >= CONTENT_DATA_START ? prev.begin : cur.begin;
    if (cur.begin < CONTENT_DATA_START) errors.biz = `官方的阅读数据接口只有 ${CONTENT_DATA_START} 之后的数据，这一周还没有`;
    else raw.biz = await part('biz', '正在取阅读概况…', () => getBizSummary(http, token, bizBegin, cur.end));
    if (raw.biz) {
      const publishDays = raw.biz.filter((d) => d.date >= cur.begin && d.date <= cur.end && d.sent > 0).map((d) => d.date);
      const list: ArticleStat[] = [];
      let failed = false;
      for (let i = 0; i < publishDays.length; i++) {
        const day = publishDays[i];
        const r = await part('articles', `正在取文章明细：${i + 1} / ${publishDays.length}`, () => getArticlesOfDay(http, token, day));
        if (r) list.push(...r); else failed = true;
      }
      raw.articles = failed && !list.length ? null : list;
    }
  });
  if (!raw.users && !raw.cumulate && !raw.biz) throw new Error(`没有取到任何数据：${Object.values(errors)[0] ?? '未知原因'}`);
  return buildReport(raw);
}
