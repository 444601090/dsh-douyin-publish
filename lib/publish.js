// lib/publish.js —— 抖音创作者中心自动发布核心
// 2026-10-29 在「红蜻蜓童鞋旗舰店」账号上实测跑通后固化：
//   上传 → 等表单（标题 input 出现，不是 textarea）→ 填标题 → 逐一点选话题 →
//   挂车能力检查 → 定时发布 → DOM 校验 → 发布 → 作品管理确认
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright-core'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
export const 上传页 = 'https://creator.douyin.com/creator-micro/content/upload'

const 等 = (ms) => new Promise((r) => setTimeout(r, ms))

export function 解析定时(定时) {
  const s = String(定时 || '').trim()
  if (!s || s === '立即' || s === 'now') return null
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
    throw new Error('定时格式要 YYYY-MM-DD HH:mm（如 2026-11-02 08:00）或「立即」')
  }
  return s
}

/** 确保账号的 Chrome 在跑（独立档案 + 调试端口），返回端口。 */
export async function 起Chrome(账号) {
  const chromePath = String(账号.chromePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  const profile = String(账号.profileDir || '')
  const port = Number(账号.port) || 9222
  if (!profile) throw new Error('账号没配 profileDir')
  if (!existsSync(chromePath)) throw new Error('Chrome 没找到：' + chromePath)
  mkdirSync(profile, { recursive: true })
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (r.ok) return port
  } catch (e) {}
  spawn(chromePath, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    'https://creator.douyin.com/creator-micro/home',
  ], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 25; i++) {
    await 等(1000)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return port
    } catch (e) {}
  }
  throw new Error('Chrome 起不来（端口 ' + port + '），可能被占用或路径不对')
}

export async function 连浏览器(port) {
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`)
}

export function 找页面(browser) {
  const 所有 = []
  for (const c of browser.contexts()) {
    for (const p of c.pages()) 所有.push(p)
  }
  return 所有.find((p) => {
    try { return p.url().includes('creator.douyin.com') } catch { return false }
  }) || 所有[0]
}

/** 检查登录态：返回 { ok: true, 抖音号, 名称 } 或 { ok: false, 原因 }。 */
export async function 查登录(page) {
  try {
    const 文 = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 3000) : ''))
    if (文.includes('扫码登录') || 文.includes('验证码登录')) return { ok: false, 原因: '未登录（页面停在扫码/验证码登录）' }
    const m = 文.match(/抖音号[：:]\s*(\d+)/)
    return { ok: true, 抖音号: m ? m[1] : null }
  } catch (e) {
    return { ok: false, 原因: String((e && e.message) || e) }
  }
}

/** 上传视频并等表单就绪（标题 input 出现）。返回 { ok, url }。 */
export async function 上传视频(page, 视频路径) {
  if (!existsSync(视频路径)) throw new Error('视频文件不存在：' + 视频路径)
  if (!page.url().includes('/upload')) {
    await page.goto(上传页, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await 等(3000)
  }
  await page.locator('input[type=file]').first().setInputFiles(视频路径)
  const 标题选择器 = 'input[placeholder="填写作品标题，为作品获得更多流量"]'
  for (let i = 1; i <= 72; i++) {
    await 等(5000)
    try {
      if ((await page.locator(标题选择器).count()) > 0) return { ok: true, url: page.url() }
    } catch (e) {}
  }
  throw new Error('上传后 6 分钟表单还没出来（转码失败或网络问题）')
}

export async function 填标题(page, 标题) {
  const 框 = page.locator('input[placeholder="填写作品标题，为作品获得更多流量"]').first()
  await 框.click()
  await 框.fill(String(标题 || ''))
  return (await 框.inputValue()).trim()
}

/** 编辑器光标移到末尾（话题必须逐一点选，光标位置是成败关键）。 */
async function 光标到末尾(page) {
  await page.evaluate(() => {
    const e = document.querySelector('[contenteditable="true"]')
    if (!e) return
    e.focus()
    const range = document.createRange()
    range.selectNodeContents(e)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  })
}

/** 输入 #词 并点选精确匹配的话题；返回 { 词, 选中 }。 */
export async function 加话题(page, 词) {
  const 净词 = String(词 || '').trim().replace(/^#+/, '')
  if (!净词) return { 词, 选中: false, 说: '空词' }
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await 光标到末尾(page)
  await 等(200)
  await page.keyboard.type('#' + 净词, { delay: 60 })
  await 等(1200)
  const r = await page.evaluate((t) => {
    const 们 = document.querySelectorAll('.mention-suggest-item-container-TVOZMl .tag-hash-view-name-DwMEe8')
    for (const n of 们) {
      if (n.textContent.trim() === t) {
        n.closest('.tag-dVUDkJ').click()
        return { 选中: true, 词: t }
      }
    }
    const 第一 = document.querySelector('.mention-suggest-item-container-TVOZMl .tag-dVUDkJ')
    if (第一) {
      const 名 = (第一.innerText || '').split('\n')[0]
      第一.click()
      return { 选中: false, 词: t, 说: '没有精确匹配，选了第一条：' + 名 }
    }
    return { 选中: false, 词: t, 说: '话题下拉没出现' }
  }, 净词)
  await 等(700)
  return r
}

/** 挂车能力检查：发布表单的「添加标签」类型下拉里有没有「商品」。 */
export async function 查挂车能力(page) {
  try {
    await page.locator('.select-lJTtRL').first().click()
    await 等(1200)
    const 选项 = await page.evaluate(() => {
      const 出 = []
      for (const el of document.querySelectorAll('.select-dropdown-option-video')) {
        const t = (el.innerText || '').trim()
        if (t) 出.push(t)
      }
      return 出
    })
    await page.keyboard.press('Escape')
    await 等(300)
    const 有商品 = 选项.includes('商品')
    return { 有商品, 选项 }
  } catch (e) {
    return { 有商品: false, 选项: [], 说: String((e && e.message) || e) }
  }
}

/**
 * 挂商品（实验性：依赖账号有「商品」选项；没实测过有权限的账号，失败会明确报错）。
 * 商品 参数传商品名称或链接里的 id。
 */
export async function 挂商品(page, 商品) {
  const 能力 = await 查挂车能力(page)
  if (!能力.有商品) {
    throw new Error('这个号的发布页没有「商品」选项，挂不了车（规则：挂不了就不发）。选项：' + (能力.选项.join('/') || '无'))
  }
  // 选「商品」类型
  const 选中 = await page.evaluate(() => {
    for (const el of document.querySelectorAll('.select-dropdown-option-video')) {
      if ((el.innerText || '').trim() === '商品') { el.click(); return true }
    }
    return false
  })
  if (!选中) throw new Error('「商品」选项点了没反应')
  await 等(2000)
  // 尝试搜索商品名
  const 搜索框 = page.locator('input[placeholder*="搜索"], input[placeholder*="商品"], .anchor-component input').first()
  const 框数 = await 搜索框.count()
  if (框数 > 0) {
    await 搜索框.fill(String(商品 || ''))
    await 等(2000)
    const 结果数 = await page.locator('[class*="goods"], [class*="product"], [class*="card"]').count()
    if (结果数 === 0) throw new Error('搜「' + 商品 + '」没出结果，挂车面板结构可能变了')
    // 点第一个结果（v0.1：精确匹配选择器留待实测有权限的号）
    await page.locator('[class*="goods"], [class*="product"]').first().click()
    await 等(1500)
  }
  const 挂上没 = await page.evaluate(() => {
    const t = document.body.innerText
    return /商品标题|商品封面|已选商品/.test(t)
  })
  if (!挂上没) throw new Error('商品选了但表单里没看到商品卡，可能没选上')
  return { ok: true, 商品: String(商品 || '') }
}

export async function 设定时(page, 定时) {
  const 时 = 解析定时(定时)
  if (!时) return { 定时: '立即' }
  await page.locator('label:has-text("定时发布")').first().click()
  await 等(1000)
  const 框 = page.locator('input[format="yyyy-MM-dd HH:mm"]').first()
  await 框.click()
  await 等(400)
  await page.keyboard.press('Control+a')
  await 框.fill(时)
  await 等(400)
  await page.keyboard.press('Enter')
  await 等(1200)
  const 值 = await 框.inputValue()
  if (值 !== 时) throw new Error('定时没填上：输入框里是「' + 值 + '」，想要「' + 时 + '」')
  return { 定时: 值 }
}

/** 发布前 DOM 校验（标题/话题数/定时/发布按钮）。 */
export async function 校验(page, 期望标题, 期望标签数) {
  const r = await page.evaluate((期望) => {
    const t = document.querySelector('input[placeholder="填写作品标题，为作品获得更多流量"]')
    const dt = document.querySelector('input[format="yyyy-MM-dd HH:mm"]')
    const 定时选 = Array.from(document.querySelectorAll('label')).find((x) => (x.innerText || '').trim() === '定时发布')
    const 发布钮 = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === '发布')
    return {
      标题: t ? t.value : null,
      话题数: document.querySelectorAll('[data-mention="#"]').length,
      定时值: dt ? dt.value : null,
      定时选中: 定时选 ? 定时选.getAttribute('data-checked') : null,
      发布可用: 发布钮 ? !发布钮.disabled : false,
    }
  }, { 期望标题, 期望标签数 })
  const 错 = []
  if (r.标题 !== 期望标题) 错.push('标题不对：' + r.标题)
  if (r.话题数 !== 期望标签数) 错.push('话题数不对：' + r.话题数 + '，想要 ' + 期望标签数)
  if (!r.发布可用) 错.push('发布按钮还是灰的')
  return { ...r, 通过: 错.length === 0, 错 }
}

export async function 截图(page, 路径) {
  try {
    await page.screenshot({ path: 路径 })
    return 路径
  } catch (e) {
    return null
  }
}

/** 点发布并等跳转作品管理；随后在列表里确认作品状态。 */
export async function 点发布(page) {
  await page.locator('button.primary-cECiOJ').first().click()
  for (let i = 0; i < 12; i++) {
    await 等(1000)
    try {
      if (page.url().includes('/content/manage')) break
    } catch (e) {}
  }
  return page.url()
}

/** 在作品管理页找标题对应的作品状态（定时发布中/已发布/审核中等）。 */
export async function 确认作品(page, 标题) {
  for (let i = 0; i < 10; i++) {
    const r = await page.evaluate((t) => {
      const 文 = document.body.innerText
      const idx = 文.indexOf(t)
      if (idx === -1) return null
      const 段 = 文.slice(idx, idx + 400)
      const 定时 = 段.match(/定时[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日\s*\d{2}:\d{2})/)
      const 状态 = /审核中/.test(段) ? '审核中' : /已发布/.test(段) ? '已发布' : /定时发布中/.test(段) ? '定时发布中' : '未知'
      return { 状态, 定时: 定时 ? 定时[1] : null }
    }, 标题)
    if (r) return r
    await 等(3000)
    try { await page.reload({ waitUntil: 'domcontentloaded' }) } catch (e) {}
  }
  return null
}

/** 完整发布一条视频。返回结果对象；任何一步失败抛错（由上层转成清晰文案）。 */
export async function 发布一条(账号, { 视频, 标题, 标签, 定时, 商品, 截图目录 }) {
  const 净标签 = (Array.isArray(标签) ? 标签 : String(标签 || '').split(/[\s,，]+/)).map((x) => String(x).trim()).filter(Boolean)
  const 净标题 = String(标题 || '').trim()
  if (!净标题) throw new Error('标题不能空')
  if (净标签.length === 0) throw new Error('标签不能空（发布前必须点选真话题）')
  const 时 = 解析定时(定时)

  const 端口 = await 起Chrome(账号)
  const browser = await 连浏览器(端口)
  try {
    let page = 找页面(browser)
    // 登录检查
    await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await 等(3000)
    const 登录 = await 查登录(page)
    if (!登录.ok) throw new Error('账号「' + 账号.名称 + '」没登录：' + 登录.原因 + '。让用户先扫码。')

    const 回执 = { 账号: 账号.名称, 抖音号: 登录.抖音号, 标题: 净标题, 标签: 净标签, 定时: 时 || '立即', 商品: 商品 ? String(商品) : null, 步骤: [] }

    // 上传
    await 上传视频(page, 视频)
    回执.步骤.push('上传完成')

    // 挂车：有商品参数就挂（能力检查在挂商品里做，没有「商品」选项直接抛错停止）
    if (商品) {
      await 挂商品(page, 商品)
      回执.步骤.push('挂车完成')
    } else {
      回执.挂车说明 = '未请求挂车（纯发布）'
    }

    // 标题 + 话题
    await 填标题(page, 净标题)
    for (const 词 of 净标签) {
      const r = await 加话题(page, 词)
      if (!r.选中) throw new Error('话题「#' + 词 + '」没点选成功：' + (r.说 || '下拉没出现'))
    }
    回执.步骤.push('标题+话题完成')

    // 定时
    const 定时结果 = await 设定时(page, 定时)
    回执.步骤.push('定时设置：' + 定时结果.定时)

    // 校验
    const 检 = await 校验(page, 净标题, 净标签.length)
    回执.校验 = 检
    if (!检.通过) throw new Error('发布前校验不过：' + 检.错.join('；'))

    // 截图（发布前）
    mkdirSync(截图目录, { recursive: true })
    const 前图 = await 截图(page, join(截图目录, 账号.名称 + '-' + Date.now() + '-发布前.png'))

    // 发布
    await 点发布(page)
    回执.步骤.push('已点发布')

    // 确认
    const 作品 = await 确认作品(page, 净标题)
    if (!作品) throw new Error('发布后在作品管理里没找到这条作品，请人工去内容管理确认')
    回执.作品状态 = 作品
    回执.步骤.push('作品管理确认：' + (作品.状态 || '') + (作品.定时 ? '（定时 ' + 作品.定时 + '）' : ''))

    const 后图 = await 截图(page, join(截图目录, 账号.名称 + '-' + Date.now() + '-回执.png'))
    回执.截图 = [前图, 后图].filter(Boolean)
    return { ok: true, ...回执 }
  } finally {
    try { await browser.close() } catch (e) {}
  }
}
