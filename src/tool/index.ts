// 工具声明：公众号数据周报（自定义界面；请求只发往微信公众平台官方接口 api.weixin.qq.com）。
import { BarChart3 } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'w10',
  name: '公众号数据周报',
  tagline: '官方数据接口，自动出阅读、涨粉图表',
  icon: BarChart3,
  category: '微信私域',
  type: 'data',
  mode: 'custom',
  mainLabel: '数据周报',
  needsLLM: true,
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
