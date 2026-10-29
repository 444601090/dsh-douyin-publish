// lib/host.js —— 「视频发布-抖音」宿主半边
// 职责：配置读写、给每个会话挂三个工具（douyin_check / douyin_publish / douyin_queue）、HTTP 接口。
// 规则写进工具描述里：新会话自动看到，不用复述。
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { 发布一条, 连浏览器, 找页面, 查登录, 起Chrome } from './publish.js'

export const name = 'douyin-publish'

export const inject = ['webServer']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 数据目录 = join(目录, 'douyin-publish')
const 配置文件 = join(数据目录, 'config.json')
const 排期文件 = () => join(数据目录, '排期.jsonl')

const 默认配置 = {
  chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  素材根目录: 'D:\\DownLoad\\Vedio\\抖音创作者中心',
  账号: [
    { 名称: '旧', port: 9222, profileDir: 'D:\\DeepSeekCode\\工作模式\\账号\\旧\\profile' },
  ],
}

function 读配置() {
  try {
    const j = JSON.parse(readFileSync(配置文件, 'utf8'))
    return { ...默认配置, ...j, 账号: Array.isArray(j.账号) ? j.账号 : 默认配置.账号 }
  } catch (e) {
    return JSON.parse(JSON.stringify(默认配置))
  }
}

function 写配置(c) {
  mkdirSync(dirname(配置文件), { recursive: true })
  writeFileSync(配置文件, JSON.stringify(c, null, 2), 'utf8')
}

function 找账号(名) {
  const c = 读配置()
  const a = (c.账号 || []).find((x) => String(x.名称) === String(名))
  if (!a) throw new Error('没有叫「' + 名 + '」的账号。现有：' + (c.账号 || []).map((x) => x.名称).join('、'))
  return { ...a, chromePath: a.chromePath || c.chromePath, 素材根目录: a.素材根目录 || c.素材根目录 }
}

function 解视频路径(账号, 视频) {
  const v = String(视频 || '').trim()
  if (!v) throw new Error('要视频路径（绝对路径，或素材根目录/<账号> 下的文件名）')
  if (v.includes(':') || v.startsWith('\\') || v.startsWith('/')) return v
  const 根 = String(账号.素材根目录 || '')
  if (!根) throw new Error('视频给了文件名但账号没配素材根目录，请给绝对路径')
  return join(根, 账号.名称, v)
}

function 记排期(条) {
  try {
    mkdirSync(dirname(排期文件()), { recursive: true })
    appendFileSync(排期文件(), JSON.stringify(条) + '\n', 'utf8')
  } catch (e) {}
}

function 截图目录(账号) {
  return join(数据目录, '截图', String(账号.名称 || '未知'))
}

export function apply(ctx) {
  const 记 = (s) => { try { ctx.logger.info('douyin-publish: ' + s) } catch (e) {} }

  // ---- 工具 ----
  const 渲染 = (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]

  const 挂工具 = (agentCtx) => {
    try {
      if (!agentCtx || !agentCtx.tools || typeof agentCtx.tools.register !== 'function') return

      agentCtx.tools.register({
        name: 'douyin_publish',
        description:
          '在抖音创作者中心自动发布一条视频，全流程自动：起 Chrome → 检查登录 → 上传视频 → 填标题 → 逐一点选话题标签（成真话题）→ 挂车（可选）→ 定时发布 → DOM 校验 → 点发布 → 作品管理确认。参数：账号（配置里的账号名）、视频（绝对路径或素材根目录/账号 下的文件名）、标题、标签（数组，不带#）、定时（"2026-11-02 08:00" 格式或「立即」，必须在 2 小时后~14 天内）、商品（可选：商品名称或链接；账号发布页「添加标签」下拉里没有「商品」选项 = 挂不了车，会报错停止——挂不了车就不发）。规则：简介不写；标签必须点选成真话题（工具自动做）。跑完要好几分钟，耐心等结果。',
        parameters: {
          type: 'object',
          properties: {
            账号: { type: 'string', description: '配置里的账号名，如「旧」' },
            视频: { type: 'string', description: '视频文件：绝对路径，或素材根目录/<账号> 下的文件名' },
            标题: { type: 'string', description: '作品标题（30 字上限）' },
            标签: { type: 'array', items: { type: 'string' }, description: '话题标签数组，不带 #，如 ["儿童长靴","女童靴子"]' },
            定时: { type: 'string', description: '"YYYY-MM-DD HH:mm" 或「立即」；定时必须在 2 小时后~14 天内' },
            商品: { type: 'string', description: '可选。商品名称或链接；挂不了车的号会报错并停止' },
          },
          required: ['账号', '视频', '标题', '标签', '定时'],
        },
        output: { schema: { type: 'object', properties: { 结果: { type: 'string' } } }, render: 渲染 },
        async execute(args) {
          try {
            const 账号 = 找账号(String((args && args.账号) || ''))
            const 视频 = 解视频路径(账号, (args && args.视频) || '')
            const r = await 发布一条(账号, {
              视频,
              标题: String((args && args.标题) || '').trim(),
              标签: (args && args.标签) || [],
              定时: (args && args.定时) || '',
              商品: (args && args.商品) ? String(args.商品) : '',
              截图目录: 截图目录(账号),
            })
            记排期({ at: new Date().toISOString(), 账号: r.账号, 标题: r.标题, 定时: r.定时, 状态: (r.作品状态 && r.作品状态.状态) || '已发布', 视频: 视频 })
            return JSON.stringify(r, null, 2)
          } catch (e) {
            const 说 = String((e && e.message) || e)
            记排期({ at: new Date().toISOString(), 账号: (args && args.账号) || '', 状态: '失败', 原因: 说 })
            return '发布失败：' + 说
          }
        },
      })

      agentCtx.tools.register({
        name: 'douyin_check',
        description:
          '检查抖音发布账号的状态：登录没、抖音号、定时中的作品数、最新作品。注意：能不能挂车要进发布表单才看得到，douyin_publish 在发布前会自动检查并拦截（规则：发布页「添加标签」里没有「商品」选项 = 挂不了车 = 不发）。',
        parameters: {
          type: 'object',
          properties: {
            账号: { type: 'string', description: '配置里的账号名' },
          },
          required: ['账号'],
        },
        output: { schema: { type: 'object', properties: { 结果: { type: 'string' } } }, render: 渲染 },
        async execute(args) {
          let browser = null
          try {
            const 账号 = 找账号(String((args && args.账号) || ''))
            const 端口 = await 起Chrome(账号)
            browser = await 连浏览器(端口)
            let page = 找页面(browser)
            await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'domcontentloaded', timeout: 60000 })
            await new Promise((r) => setTimeout(r, 3000))
            const 登录 = await 查登录(page)
            let 定时作品数 = null
            let 最近 = null
            if (登录.ok) {
              await page.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'domcontentloaded', timeout: 60000 })
              await new Promise((r) => setTimeout(r, 4000))
              const 信息 = await page.evaluate(() => {
                const 文 = document.body.innerText
                const 数 = (文.match(/作品 \((\d+)\)/) || [])[1] || null
                const 定时们 = Array.from(文.matchAll(/定时[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日\s*\d{2}:\d{2})/g)).map((m) => m[1])
                const 最近块 = 文.slice(文.indexOf('内容管理'), 文.indexOf('内容管理') + 600).replace(/\n+/g, ' | ').slice(0, 300)
                return { 数, 定时们: 定时们.slice(0, 10), 最近块 }
              })
              定时作品数 = (信息.定时们 && 信息.定时们.length) || 0
              最近 = 信息.最近块
            }
            return JSON.stringify({ 账号: 账号.名称, 登录: 登录.ok ? '已登录（抖音号 ' + 登录.抖音号 + '）' : '未登录', 定时作品数, 最近 }, null, 2)
          } catch (e) {
            return '检查失败：' + String((e && e.message) || e)
          } finally {
            if (browser) { try { await browser.close() } catch (e) {} }
          }
        },
      })

      agentCtx.tools.register({
        name: 'douyin_queue',
        description: '看抖音发布的排期记录（本插件每次发布/失败的本地记录，含账号、标题、定时、状态）。',
        parameters: { type: 'object', properties: { 条数: { type: 'number', description: '看最近几条，默认 10' } }, required: [] },
        output: { schema: { type: 'object', properties: { 结果: { type: 'string' } } }, render: 渲染 },
        async execute(args) {
          try {
            const n = Math.min(Number((args && args.条数) || 10) || 10, 50)
            if (!existsSync(排期文件())) return '还没有排期记录'
            const 行 = readFileSync(排期文件(), 'utf8').trim().split('\n').filter(Boolean)
            return 行.slice(-n).reverse().map((x) => { try { const j = JSON.parse(x); return `${j.at || ''} ${j.账号 || ''} ${j.状态 || ''} ${j.标题 || ''} ${j.定时 || ''}${j.原因 ? '（' + j.原因 + '）' : ''}` } catch (e) { return x } }).join('\n')
          } catch (e) {
            return '读取失败：' + String((e && e.message) || e)
          }
        },
      })
    } catch (e) {
      记('挂工具出错：' + String((e && e.message) || e))
    }
  }

  try {
    if (typeof ctx.on === 'function') {
      ctx.on('agent/created', (agent) => {
        try { 挂工具((agent && agent.ctx) || agent) } catch (e) {}
      })
    }
  } catch (e) {}

  // ---- HTTP ----
  try {
    const 服务 = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (服务 && typeof 服务.register === 'function') {
      const 注册 = (路径, 处理) => ctx.effect(() => 服务.register({ kind: 'exact', path: 路径, handler: 处理 }), 'dsh-douyin-publish: ' + 路径)
      const 回JSON = (res, 码, 对象) => { try { res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(对象)) } catch (e) {} }

      注册('/douyin-publish/config', async (req, res) => {
        try {
          if (req.method === 'GET') { 回JSON(res, 200, 读配置()); return }
          const 块 = []
          for await (const 片 of req) 块.push(片)
          const d = 块.length ? JSON.parse(Buffer.concat(块).toString('utf8')) : {}
          写配置({ ...读配置(), ...d })
          回JSON(res, 200, { ok: true })
        } catch (e) { 回JSON(res, 500, { ok: false, 说: String((e && e.message) || e) }) }
      })

      注册('/douyin-publish/status', async (req, res) => {
        try {
          回JSON(res, 200, { ok: true, 配置: 读配置(), 排期文件: 排期文件(), 截图目录: join(数据目录, '截图') })
        } catch (e) { 回JSON(res, 500, { ok: false }) }
      })
    }
  } catch (e) {}

  记('已加载｜账号 ' + 读配置().账号.map((x) => x.名称).join('、') + '｜素材根目录 ' + (读配置().素材根目录 || '未设'))
}
