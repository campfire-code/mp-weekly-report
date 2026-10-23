// 公众号连接设置：AppID + AppSecret（只存本机）、前置条件说明、测试连接；以及「示例数据」体验模式。
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, KeyRound, Loader2 } from 'lucide-react';
import { settingsStore } from '../kit/platform';
import { CRED_KEY, clearTokenCache, credReady, defaultEndDate, getToken, getUserCumulate, withToken, type Http, type MpCred } from './mp';
import { MOCK_CRED, createMockMp } from './mock';
import { tauriHttp } from './net';

export type Source = 'mp' | 'demo';
const EMPTY: MpCred = { appId: '', appSecret: '' };
const todayBj = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);

export interface Conn {
  source: Source;
  setSource(s: Source): void;
  cred: MpCred;
  saveCred(c: MpCred): Promise<void>;
  http: Http;
  activeCred: MpCred;
  ready: boolean;
}

export function useConn(preview: boolean, now = Date.now()): Conn {
  const [cred, setCred] = useState<MpCred>(EMPTY);
  const [source, setSourceState] = useState<Source>(preview ? 'demo' : 'mp');
  const mock = useMemo(() => createMockMp(todayBj(now)), []);
  useEffect(() => {
    if (preview) return;
    (async () => {
      try {
        const st = await settingsStore();
        const c = (await st.get<MpCred>(CRED_KEY)) ?? EMPTY;
        setCred(c);
        const s = await st.get<Source>(`${CRED_KEY}.source`);
        setSourceState(s ?? (credReady(c) ? 'mp' : 'demo'));
      } catch { /* 首次打开 */ }
    })();
  }, [preview]);
  const setSource = (s: Source) => {
    setSourceState(s);
    if (!preview) settingsStore().then((st) => st.set(`${CRED_KEY}.source`, s)).catch(() => {});
  };
  const saveCred = async (c: MpCred) => {
    setCred(c);
    clearTokenCache();
    if (!preview) { try { await (await settingsStore()).set(CRED_KEY, c); } catch { /* 预览页 */ } }
  };
  const demo = source === 'demo';
  return { source, setSource, cred, saveCred, http: demo ? mock.http : tauriHttp, activeCred: demo ? MOCK_CRED : cred, ready: demo || credReady(cred) };
}

export function SourceSwitch({ conn, disabled }: { conn: Conn; disabled?: boolean }) {
  return (
    <div className="k-seg wx-src" role="radiogroup" aria-label="数据来源">
      {([['mp', '公众号'], ['demo', '示例数据']] as const).map(([v, l]) => (
        <button key={v} role="radio" aria-checked={conn.source === v} className={conn.source === v ? 'on' : ''} disabled={disabled} onClick={() => conn.setSource(v)}>{l}</button>
      ))}
    </div>
  );
}

export function SetupPanel({ conn, open, setOpen, onMsg }: { conn: Conn; open: boolean; setOpen(v: boolean): void; onMsg(m: { kind: 'ok' | 'err'; text: string }): void }) {
  const [draft, setDraft] = useState<MpCred>(conn.cred);
  const [testing, setTesting] = useState(false);
  useEffect(() => setDraft(conn.cred), [conn.cred]);
  const ok = credReady(conn.cred);
  const changed = draft.appId !== conn.cred.appId || draft.appSecret !== conn.cred.appSecret;
  return (
    <section className="k-panel wx-setup" aria-label="公众号设置">
      <button className="wx-setup-hd" aria-expanded={open} onClick={() => setOpen(!open)}>
        <KeyRound size={15} /><b>公众号设置</b>
        <span className={`k-st ${ok ? 'ok' : 'wait'}`}>{ok ? `已填写 ${conn.cred.appId.slice(0, 6)}…` : '未填写'}</span>
        <ChevronDown size={15} className={`wx-chev${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="wx-setup-body">
          <div className="wx-setup-grid">
            <div className="k-field"><label className="k-label" htmlFor="mp-appid">AppID</label><input id="mp-appid" className="k-input" autoComplete="off" value={draft.appId} placeholder="wx 开头的 18 位" onChange={(e) => setDraft({ ...draft, appId: e.target.value })} /></div>
            <div className="k-field"><label className="k-label" htmlFor="mp-secret">AppSecret</label><input id="mp-secret" className="k-input" type="password" autoComplete="off" value={draft.appSecret} placeholder="开发密钥里的 AppSecret" onChange={(e) => setDraft({ ...draft, appSecret: e.target.value })} /></div>
          </div>
          <ol className="wx-pre">
            <li>数据统计接口只开放给<b>已认证</b>的公众号 / 服务号（官方文档写明「仅认证」），未认证的账号会提示没有权限。</li>
            <li>到「微信开发者平台（developers.weixin.qq.com/platform）→ 我的业务 → 选择这个公众号 → 开发密钥」复制 AppID，生成并复制 <b>AppSecret</b>（只显示一次）。</li>
            <li>在同一页的「<b>API IP 白名单</b>」里加入本机所在网络的公网出口 IP（要固定 IP，动态 IP 会变），否则报 40164。</li>
            <li>数据每天<b>早上 8 点后</b>才有前一天的数据，所以最好在周一上午 8 点后生成上周周报。</li>
          </ol>
          <p className="k-help">AppID 和 AppSecret 只保存在这台电脑上，不会上传到别处，也不会写进日志。</p>
          <div className="wx-row">
            <button className="k-btn primary" disabled={!changed} onClick={async () => { await conn.saveCred({ appId: draft.appId.trim(), appSecret: draft.appSecret.trim() }); onMsg({ kind: 'ok', text: '公众号设置已保存在本机' }); }}>保存</button>
            <button className="k-btn" disabled={!credReady(draft) || testing} onClick={async () => {
              setTesting(true);
              try {
                const c = { appId: draft.appId.trim(), appSecret: draft.appSecret.trim() };
                await conn.saveCred(c);
                await getToken(tauriHttp, c);
                const end = defaultEndDate(Date.now());
                await withToken(tauriHttp, c, (t) => getUserCumulate(tauriHttp, t, end, end));
                conn.setSource('mp');
                onMsg({ kind: 'ok', text: '连接成功：AppID、AppSecret、IP 白名单和数据接口权限都没问题' });
                setOpen(false);
              } catch (e) {
                onMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
              }
              setTesting(false);
            }}>{testing && <Loader2 size={15} className="k-spin" />}{testing ? '测试中…' : '保存并测试连接'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
