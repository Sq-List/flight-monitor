import { mkdir, writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

import { parseFlightCards } from './parser.js';

function collectionError(code, message) {
  return Object.assign(new Error(message), { code });
}

// 根据固定查询条件构造携程往返航班页面地址。
export function buildSearchUrl(query) {
  const route = `${query.from.toLowerCase()}-${query.to.toLowerCase()}`;
  return `https://flights.ctrip.com/online/list/round-${route}`
    + `?depdate=${query.depart_date}_${query.return_date}`
    + '&cabin=Y_S_C_F&adult=1&child=0&infant=0';
}

// 优先识别验证码，再判断页面是否已经渲染出可解析的航班卡片。
export function classifyPageState({ url, bodyText, cardCount }) {
  if (url.includes('captcha') || /验证码|安全验证|verify the human|访问频繁|whaleguard\s+block/i.test(bodyText)) {
    return 'captcha';
  }
  if (cardCount > 0 && /\d{1,2}:\d{2}/.test(bodyText) && /[¥$€£]/.test(bodyText)) {
    return 'content';
  }
  return 'empty';
}

// 按 DOM 中的显示顺序提取每张航班卡片的文本片段，供纯函数解析器处理。
export async function extractCardChunks(page) {
  return page.locator('.flight-item').evaluateAll((cards) => cards.map((card) => {
    const chunks = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) chunks.push(text);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
    };
    walk(card);
    return chunks;
  }));
}

async function saveFailureArtifacts(page, artifactDir, sourceUrl) {
  await mkdir(artifactDir, { recursive: true });
  let bodyText = '';
  if (page) {
    await page.screenshot({ path: `${artifactDir}/failure.png`, fullPage: true }).catch(() => {});
    bodyText = await page.locator('body').innerText().catch(() => '');
  }
  const summary = `URL: ${sourceUrl}\n\n${bodyText.slice(0, 4000)}`;
  await writeFile(`${artifactDir}/failure-summary.txt`, summary, 'utf8');
}

// 启动匿名 Chromium 读取携程动态页面，失败时只保存截图和截断后的可见文本。
export async function collectQuotes({ query, artifactDir = 'artifacts' }) {
  const sourceUrl = buildSearchUrl(query);
  let browser;
  let page;
  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    try {
      await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw collectionError('navigation_timeout', '携程页面未在 45 秒内打开');
      }
      throw error;
    }

    await page.waitForTimeout(18000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const cardCount = await page.locator('.flight-item').count();
    const state = classifyPageState({ url: page.url(), bodyText, cardCount });
    if (state === 'captcha') throw collectionError('captcha', '携程返回验证码或访问验证页面');
    if (state !== 'content') throw collectionError('cards_not_found', '页面未发现有效航班卡片');

    const chunks = await extractCardChunks(page);
    const quotes = parseFlightCards(chunks, sourceUrl);
    if (quotes.length === 0) throw collectionError('quotes_invalid', '航班卡片没有有效正数价格');
    return quotes;
  } catch (error) {
    await saveFailureArtifacts(page, artifactDir, sourceUrl);
    if (error?.code) throw error;
    throw collectionError('unexpected', error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
  }
}
