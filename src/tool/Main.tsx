// 公众号数据周报：连接公众号 → 选截止日期 → 生成周报（涨粉、阅读、文章明细、环比）→ 可选 AI 解读 → 复制 / 导出 HTML / Markdown。
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, Loader2, Sparkles } from 'lucide-react';
import type { RunContext } from '../kit/types';
import { defaultOutputDir } from '../kit/platform';
import { llmReady, useSettings } from '../kit/settings';
import { CopyButton } from '../kit/parts';
import { CONTENT_DATA_START, defaultEndDate } from './mp';
import { aiInterpret, fmtNum, fmtRate, kpis, lineSvg, pairBarsSvg, reportHtml, reportMarkdown, type Report } from './core';
import { collectReport } from './flow';
import { SetupPanel, SourceSwitch, useConn } from './Setup';
import './setup.css';
import './tool.css';

type Ctx = Pick<RunContext, 'writeText' | 'join' | 'llm'>;
type Notice = { kind: 'ok' | 'err'; text: string } | null;
export interface DemoState { report: Report; ai?: string; notice?: Notice; end: string }

export function Main({ ctx }: { ctx: Ctx }) {
  const preview = location.pathname.endsWith('preview.html');
  const conn = useConn(preview);
  const settings = useSettings();
  const [setupOpen, setSetupOpen] = useState(false);
  const [end, setEnd] = useState(() => defaultEndDate(Date.now()));
  const [report, setReport] = useState<Report | null>(null);
  const [ai, setAi] = useState('');
  const [busy, setBusy] = useState<'' | 'fetch' | 'ai'>('');
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const stop = useRef<AbortController | null>(null);
  const fail = (e: unknown) => setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });

  useEffect(() => {
    if (!preview) return;
    import('./preview').then(({ demo }) => { setReport(demo.report); setAi(demo.ai ?? ''); setEnd(demo.end); setNotice(demo.notice ?? null); });
  }, [preview]);

  const generate = async () => {
    const ac = new AbortController(); stop.current = ac;
    setBusy('fetch'); setNotice(null); setAi('');
    try {
      const r = await collectReport(conn.http, conn.activeCred, end, setProgress, ac.signal);
      setReport(r);
      const miss = Object.keys(r.errors).length;
      setNotice({ kind: miss ? 'err' : 'ok', text: miss ? `周报已生成，但有 ${miss} 部分没取到，见页面底部说明` : `周报已生成：${r.cur.begin} ~ ${r.cur.end}` });
    } catch (e) { fail(e); }
    setBusy('');
  };
  const runAi = async () => {
    if (!report) return;
    setBusy('ai'); setNotice(null);
    try { setAi(await aiInterpret(report, (m, o) => ctx.llm(m, o))); } catch (e) { fail(e); }
    setBusy('');
  };
  const save = async (ext: 'html' | 'md') => {
    if (!report) return;
    try {
      const p = await ctx.join(await defaultOutputDir('公众号数据周报'), `公众号周报-${report.cur.begin}_${report.cur.end}.${ext}`);
      await ctx.writeText(p, ext === 'html' ? reportHtml(report, ai) : reportMarkdown(report, ai));
      setNotice({ kind: 'ok', text: `已导出：${p}` });
    } catch (e) { fail(e); }
  };

  const k = useMemo(() => (report ? kpis(report) : []), [report]);
  const endErr = end > defaultEndDate(Date.now()) && !preview ? '截止日期最晚是昨天（早上 8 点前最晚是前天）' : !/^\d{4}-\d{2}-\d{2}$/.test(end) ? '请选择日期' : '';
  const idle = busy === '';
  const maxRead = Math.max(1, ...(report?.articles ?? []).map((a) => a.read));
  const hero = k[0];
  const rest = k.slice(1);
  const trend = (c?: string | null) => (c?.startsWith('+') ? 'up' : c?.startsWith('-') ? 'down' : '');
  return (
    <div className="mp-root">
      <aside className="mp-side">
        <div className="mp-side-in">
          <SourceSwitch conn={conn} disabled={!idle} />
          {conn.source === 'demo' && <span className="k-help">示例数据：虚构的公众号和文章，仅用于体验</span>}
          {conn.source === 'mp' && <SetupPanel conn={conn} open={setupOpen || !conn.ready} setOpen={setSetupOpen} onMsg={setNotice} />}
          <div className="k-field">
            <label className="k-label" htmlFor="mp-end">截止日期</label>
            <input id="mp-end" className="k-input" type="date" value={end} max={preview ? undefined : defaultEndDate(Date.now())} onChange={(e) => setEnd(e.target.value)} />
            <span className="k-help">取截止日往前 7 天，和再往前 7 天对比。阅读数据官方只有 {CONTENT_DATA_START} 之后的。</span>
          </div>
          {endErr && <p className="mp-bad">{endErr}</p>}
          <button className="k-btn primary mp-wide" disabled={!idle || !conn.ready || !!endErr} onClick={() => void generate()}>{busy === 'fetch' ? <Loader2 size={15} className="k-spin" /> : <BarChart3 size={15} />}{report ? '重新生成' : '生成周报'}</button>
          {busy === 'fetch' && <div className="mp-progress"><Loader2 size={15} className="k-spin" />{progress || '处理中…'}<button className="k-btn" onClick={() => stop.current?.abort()}>停止</button></div>}
          {report && (
            <div className="mp-out">
              <span className="k-label">导出</span>
              <button className="k-btn primary mp-wide" disabled={!idle} onClick={() => void save('html')}><Download size={15} />导出 HTML 周报</button>
              <button className="k-btn mp-wide" disabled={!idle} onClick={() => void save('md')}><Download size={15} />导出 Markdown</button>
              <CopyButton text={reportMarkdown(report, ai)} label="复制全文" />
              <button className="k-btn mp-wide" disabled={!idle || (!llmReady(settings.llm) && !preview)} onClick={() => void runAi()}>{busy === 'ai' ? <Loader2 size={15} className="k-spin" /> : <Sparkles size={15} />}{ai ? '重新解读' : '让 AI 解读'}</button>
              {!llmReady(settings.llm) && !preview && <p className="mp-bad">还没配置大模型：到本工具的「设置」页填接口地址、密钥和模型名（兼容 OpenAI 接口格式）。</p>}
              <span className="k-help">AI 解读只发送汇总数字和文章标题。</span>
            </div>
          )}
        </div>
      </aside>

      <main className="mp-main">
        {notice && <div className={`k-notice ${notice.kind}`} role="status">{notice.text}</div>}
        {!report && idle && (
          <section className="mp-empty">
            <svg className="mp-art" viewBox="0 0 360 130" role="img" aria-label="两周的公众号数据汇成一页周报">
              <rect x="10" y="30" width="86" height="80" rx="6" fill="var(--chip)" /><rect x="22" y="80" width="10" height="20" fill="var(--muted)" /><rect x="40" y="62" width="10" height="38" fill="var(--muted)" /><rect x="58" y="70" width="10" height="30" fill="var(--muted)" />
              <text x="53" y="24" textAnchor="middle" fontSize="13" fill="var(--muted)">上周</text>
              <rect x="116" y="30" width="86" height="80" rx="6" fill="var(--primary-soft)" /><rect x="128" y="62" width="10" height="38" fill="var(--primary)" /><rect x="146" y="46" width="10" height="54" fill="var(--primary)" /><rect x="164" y="54" width="10" height="46" fill="var(--primary)" />
              <text x="159" y="24" textAnchor="middle" fontSize="13" fill="var(--ink)">本周</text>
              <path d="M214 70h30m-8-8l8 8-8 8" stroke="var(--muted)" strokeWidth="2" fill="none" />
              <rect x="256" y="10" width="94" height="110" rx="6" fill="var(--surface)" stroke="var(--line-strong)" />
              <rect x="266" y="22" width="40" height="8" rx="3" fill="var(--ink)" /><rect x="266" y="40" width="74" height="6" rx="3" fill="var(--chip)" /><rect x="266" y="54" width="74" height="6" rx="3" fill="var(--chip)" /><rect x="266" y="68" width="52" height="6" rx="3" fill="var(--chip)" /><rect x="266" y="90" width="74" height="18" rx="3" fill="var(--primary-soft)" />
            </svg>
            <b>两周的公众号数据，汇成一页带环比的周报</b>
            <span className="k-muted">先在左侧连接公众号（或切到「示例数据」体验），选好截止日期，点「生成周报」。</span>
          </section>
        )}

        {report && (
          <article className="mp-paper">
            <header className="mp-mast">
              <span className="mp-eyebrow">公众号数据周报</span>
              <h2>{report.cur.begin} ~ {report.cur.end}</h2>
              <span className="k-help">对比上一周 {report.prev.begin} ~ {report.prev.end}</span>
            </header>

            {hero && (
              <div className="mp-hero">
                <div className="mp-hero-main">
                  <span>{hero.label}</span>
                  <b className="k-num">{hero.value}</b>
                  <i className={`mp-delta ${trend(hero.change)}`}>{hero.change ? `较上周 ${hero.change}` : hero.note ?? ' '}</i>
                  {hero.change && hero.note && <em>{hero.note}</em>}
                </div>
                <div className="mp-rest">
                  {rest.map((x) => (
                    <div key={x.label} className="mp-kpi"><span>{x.label}</span><b className="k-num">{x.value}</b>
                      <i className={`mp-delta ${trend(x.change)}`}>{x.change ? `较上周 ${x.change}` : x.note ?? ' '}</i>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!report.prevReadable && report.readTotals && <p className="k-help">上一周在 {CONTENT_DATA_START} 之前，阅读数据没有可比的上周。</p>}

            {ai && <section className="mp-sec"><h3>解读</h3><p className="mp-ai">{ai}</p></section>}

            {report.userDays && (
              <section className="mp-sec">
                <h3>每日涨粉<span className="mp-legend"><i className="mp-dot new" />新增<i className="mp-dot cancel" />取关</span></h3>
                <div dangerouslySetInnerHTML={{ __html: pairBarsSvg(report.userDays) }} />
                {report.userDays.some((d) => d.cumulate !== null) && <><span className="k-help">累计关注人数</span><div dangerouslySetInnerHTML={{ __html: lineSvg(report.userDays.map((d) => d.date), report.userDays.map((d) => d.cumulate), 'mp-line-cum', '累计关注人数') }} /></>}
                {report.bySource.length > 0 && (
                  <div className="k-scroll mp-tablebox"><table className="k-table"><thead><tr><th>关注渠道</th><th>新增</th><th>取关</th></tr></thead>
                    <tbody>{report.bySource.map((s) => <tr key={s.source}><td>{s.source}</td><td className="k-num">{s.newUser}</td><td className="k-num">{s.cancelUser}</td></tr>)}</tbody></table></div>
                )}
              </section>
            )}

            {report.readDays && (
              <section className="mp-sec">
                <h3>每日阅读人数</h3><span className="k-help">每天的阅读人数；周合计是每天相加，同一个人不同天阅读会重复计</span>
                <div dangerouslySetInnerHTML={{ __html: lineSvg(report.readDays.map((d) => d.date), report.readDays.map((d) => d.read), 'mp-line-read', '每日阅读人数') }} />
                {report.readSources.length > 0 && <p className="k-help">阅读来源（按天累加）：{report.readSources.map((s) => `${s.scene} ${fmtNum(s.users)}`).join('，')}</p>}
              </section>
            )}

            {report.articles && (
              <section className="mp-sec">
                <h3>本周发表的文章</h3><span className="k-help">按阅读人数排序；指标是发表日至统计日的累计（官方每篇只统计发表后 30 天）</span>
                {report.articles.length === 0 ? <p className="k-muted">本周没有发表文章。</p> : (
                  <ol className="mp-rank">
                    {report.articles.map((a, i) => (
                      <li key={a.msgid} className="mp-art-row">
                        <span className="mp-no k-num">{i + 1}</span>
                        <div className="mp-art-body">
                          <div className="mp-art-t"><b>{a.title}</b><span className="k-muted k-num">{a.publishDate}</span></div>
                          <div className="mp-bar"><i style={{ width: `${(a.read / maxRead) * 100}%` }} /></div>
                          <div className="mp-art-n k-num"><span>阅读 <b>{fmtNum(a.read)}</b></span><span>分享 {a.share}</span><span>在看 {a.zaikan}</span><span>点赞 {a.like}</span><span>留言 {a.comment}</span><span>阅读后关注 {a.readSubscribe}</span><span>读完率 {fmtRate(a.finishRate)}</span></div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {Object.entries(report.errors).map(([key, text]) => <div key={key} className="k-notice err">{({ users: '涨粉数据', cumulate: '累计关注数据', biz: '阅读数据', articles: '文章明细' } as Record<string, string>)[key]}没有取到：{text}</div>)}
          </article>
        )}
      </main>
    </div>
  );
}
