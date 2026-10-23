// 截图与预览用的示例数据（不会进入正式运行）。公众号、文章均为虚构的「示例」。
import { MOCK_CRED, createMockMp } from './mock';
import { collectReport } from './flow';
import type { DemoState } from './Main';

export const rows = () => [];
export const params = {};

const END = '2026-10-18';
const m = createMockMp('2026-10-19');
const report = await collectReport(m.http, MOCK_CRED, END);
export const demo: DemoState = {
  report, end: END,
  ai: '本周概况：净增关注 16，较上周小幅回落；阅读人数、分享人数与上周基本持平。\n亮点与问题：取关人数 33，接近新增 49 的七成，净增偏低可能与取关偏多有关（示例解读，仅作展示）。\n下周建议：关注取关集中的日期，对照当天的推送内容排查原因。',
  notice: { kind: 'ok', text: `示例：周报已生成 ${report.cur.begin} ~ ${report.cur.end}` },
};
