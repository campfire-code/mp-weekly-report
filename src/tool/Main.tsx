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
  return (
    <div className="mp-root">
      <div className="mp-top">
        <SourceSwitch conn={conn} disabled={!idle} />
        {conn.source === 'demo' && <span className="k-help">示例数据：虚构的公众号和文章，仅用于体验</span>}
      </div>
      {conn.source === 'mp' && <SetupPanel conn={conn} open={setupOpen || !conn.ready} setOpen={setSetupOpen} onMsg={setNotice} />}
      {notice && <div className={`k-notice ${notice.kind}`} role="status">{notice.text}</div>}

      <section className="k-panel mp-card">
        <div className="mp-hd">
          <b>周报范围</b>
          <label className="mp-date">截止到<input className="k-input" type="date" value={end} max={preview ? undefined : defaultEndDate(Date.now())} onChange={(e) => setEnd(e.target.value)} aria-label="截止日期" /></label>
          <span className="k-help">取截止日往前 7 天，和再往前 7 天对比（阅读数据官方只有 {CONTENT_DATA_START} 之后的）</span>
          <span className="mp-grow" />
          <button className="k-btn primary" disabled={!idle || !conn.ready || !!endErr} onClick={() => void generate()}>{busy === 'fetch' ? <Loader2 size={15} className="k-spin" /> : <BarChart3 size={15} />}{report ? '重新生成' : '生成周报'}</button>
        </div>
        {endErr && <p className="mp-bad">{endErr}</p>}
        {busy === 'fetch' && <div className="mp-progress"><Loader2 size={15} className="k-spin" />{progress || '处理中…'}<button className="k-btn" onClick={() => stop.current?.abort()}>停止</button></div>}
      </section>

      {report && (
        <>
          <section className="k-panel mp-card">
            <div className="mp-hd">
              <b>{report.cur.begin} ~ {report.cur.end}</b><span className="k-help">对比 {report.prev.begin} ~ {report.prev.end}</span><span className="mp-grow" />
              <button className="k-btn" disabled={!idle} onClick={() => void save('md')}><Download size={15} />Markdown</button>
              <button className="k-btn primary" disabled={!idle} onClick={() => void save('html')}><Download size={15} />导出 HTML 周报</button>
              <CopyButton text={reportMarkdown(report, ai)} label="复制全文" />
            </div>
            <div className="mp-kpis">
              {k.map((x) => (
                <div key={x.label} className="mp-kpi"><span>{x.label}</span><b className="k-num">{x.value}</b>
                  <i className={x.change?.startsWith('+') ? 'up' : x.change?.startsWith('-') ? 'down' : ''}>{x.change ? `较上周 ${x.change}` : x.note ?? ' '}</i>
                  {x.change && x.note && <i>{x.note}</i>}
                </div>
              ))}
            </div>
            {!report.prevReadable && report.readTotals && <p className="k-help">上一周在 {CONTENT_DATA_START} 之前，阅读数据没有可比的上周。</p>}
          </section>

          {report.userDays && (
            <section className="k-panel mp-card">
              <div className="mp-hd"><b>每日涨粉</b><span className="mp-legend"><i className="mp-dot new" />新增<i className="mp-dot cancel" />取关</span></div>
              <div dangerouslySetInnerHTML={{ __html: pairBarsSvg(report.userDays) }} />
              {report.userDays.some((d) => d.cumulate !== null) && <><span className="k-help">累计关注人数</span><div dangerouslySetInnerHTML={{ __html: lineSvg(report.userDays.map((d) => d.date), report.userDays.map((d) => d.cumulate), 'mp-line-cum', '累计关注人数') }} /></>}
              {report.bySource.length > 0 && (
                <div className="k-scroll mp-tablebox"><table className="k-table"><thead><tr><th>关注渠道</th><th>新增</th><th>取关</th></tr></thead>
                  <tbody>{report.bySource.map((s) => <tr key={s.source}><td>{s.source}</td><td className="k-num">{s.newUser}</td><td className="k-num">{s.cancelUser}</td></tr>)}</tbody></table></div>
              )}
            </section>
          )}

          {report.readDays && (
            <section className="k-panel mp-card">
              <div className="mp-hd"><b>每日阅读人数</b><span className="k-help">每天的阅读人数；周合计是每天相加，同一个人不同天阅读会重复计</span></div>
              <div dangerouslySetInnerHTML={{ __html: lineSvg(report.readDays.map((d) => d.date), report.readDays.map((d) => d.read), 'mp-line-read', '每日阅读人数') }} />
              {report.readSources.length > 0 && <p className="k-help">阅读来源（按天累加）：{report.readSources.map((s) => `${s.scene} ${fmtNum(s.users)}`).join('，')}</p>}
            </section>
          )}

          <section className="k-panel mp-card">
            <div className="mp-hd"><b>AI 解读</b><span className="k-help">可选。只把汇总数字和文章标题发给你在设置页配置的大模型</span><span className="mp-grow" />
              <button className="k-btn" disabled={!idle || (!llmReady(settings.llm) && !preview)} onClick={() => void runAi()}>{busy === 'ai' ? <Loader2 size={15} className="k-spin" /> : <Sparkles size={15} />}{ai ? '重新解读' : '让 AI 解读'}</button></div>
            {!llmReady(settings.llm) && !preview && <p className="mp-bad">还没配置大模型：到本工具的「设置」页填接口地址、密钥和模型名（兼容 OpenAI 接口格式）。</p>}
            {ai && <p className="mp-ai">{ai}</p>}
          </section>

          {report.articles && (
            <section className="k-panel mp-card">
              <div className="mp-hd"><b>本周发表的文章</b><span className="k-help">按阅读人数排序；指标是发表日至统计日的累计（官方每篇只统计发表后 30 天）</span></div>
              {report.articles.length === 0 ? <p className="k-muted">本周没有发表文章。</p> : (
                <div className="k-scroll mp-tablebox"><table className="k-table">
                  <thead><tr><th>文章</th><th>发表日</th><th>阅读人数</th><th>分享</th><th>在看</th><th>点赞</th><th>留言</th><th>阅读后关注</th><th>读完率</th></tr></thead>
                  <tbody>{report.articles.map((a) => <tr key={a.msgid}><td className="mp-title">{a.title}</td><td className="k-num">{a.publishDate}</td><td className="k-num"><b>{fmtNum(a.read)}</b></td><td className="k-num">{a.share}</td><td className="k-num">{a.zaikan}</td><td className="k-num">{a.like}</td><td className="k-num">{a.comment}</td><td className="k-num">{a.readSubscribe}</td><td className="k-num">{fmtRate(a.finishRate)}</td></tr>)}</tbody>
                </table></div>
              )}
            </section>
          )}

          {Object.entries(report.errors).map(([key, text]) => <div key={key} className="k-notice err">{({ users: '涨粉数据', cumulate: '累计关注数据', biz: '阅读数据', articles: '文章明细' } as Record<string, string>)[key]}没有取到：{text}</div>)}
        </>
      )}
      {!report && idle && <section className="k-panel mp-empty"><BarChart3 size={26} /><b>一键生成公众号数据周报</b><span className="k-muted">先连接公众号（或切到「示例数据」体验），选好截止日期，点「生成周报」。</span></section>}
    </div>
  );
}
