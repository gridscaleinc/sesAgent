export type BusinessEmailClassification = 'job-case' | 'candidate-proposal' | 'unclassified'

export function emailHtmlToPlainText(input: string): string {
  return input
    .slice(0, 500_000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/giu, ' ')
    .replace(/<!--[^]*?-->/gu, ' ')
    .replace(/<(?:br|hr)\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&#(\d{1,7});/gu, (_match, decimal: string) => safeEntityCodePoint(Number(decimal)))
    .replace(/&#x([a-f0-9]{1,6});/giu, (_match, hexadecimal: string) => safeEntityCodePoint(Number.parseInt(hexadecimal, 16)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function safeEntityCodePoint(value: number): string {
  if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return ' '
  return String.fromCodePoint(value)
}

export function normalizeEmailHeaderValue(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const normalized = value
    .replace(/\r?\n[\t ]*/gu, ' ')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return normalized.slice(0, 2_000) || fallback
}

export function minimizeEmailBodyForLocalProcessing(body: string): string {
  const lines = body.replaceAll('\u0000', '').split(/\r?\n/u)
  const retained: string[] = []
  let characters = 0
  for (const line of lines) {
    if (
      retained.length >= 2 &&
      /^(?:--\s*$|On .+ wrote:$|-{2,}\s*Original Message\s*-{2,}|差出人:\s|From:\s|送信日時:\s)/iu.test(line.trim())
    ) {
      break
    }
    const remaining = 100_000 - characters
    if (remaining <= 0) break
    const boundedLine = line.slice(0, remaining)
    retained.push(boundedLine)
    characters += boundedLine.length + 1
  }
  return retained.join('\n').slice(0, 100_000).trim()
}

export function classifyEmailText(subject: string, body: string): BusinessEmailClassification {
  const text = `${subject}\n${body}`
  // Rates and availability occur in both directions. The mail's business purpose takes priority.
  const introduction = /(?:要員|人材|候補者|人员|人員|人才).{0,12}(?:紹介|提案|ご提案|情報|介绍|推荐)/iu
  const resume = /(?:スキルシート|経歴書|履歴書|简历|履历|resume)/iu
  if (introduction.test(subject)) return 'candidate-proposal'
  if (/(?:案件|募集|求人)/u.test(subject)) return 'job-case'
  if (resume.test(subject)) return 'candidate-proposal'
  if (introduction.test(body) || /(?:氏名|姓名|名前)\s*[:：]/u.test(body) && /(?:スキル|経験|技能|经验)/u.test(body)) return 'candidate-proposal'
  if (/(?:案件|募集|要件|単価|商流|稼働|参画)/u.test(text)) return 'job-case'
  if (/(?:要員|人材|候補者|人员|人員|人才)/u.test(text)) return 'candidate-proposal'
  return 'unclassified'
}

export function emailHasPromptInjectionPattern(text: string): boolean {
  return /(?:ignore (?:all |the )?(?:previous|system) instructions?|system prompt|send (?:this|data) to|指示を無視|ルールを無視|他のファイルを読み|忽略(?:之前|所有|系统).{0,12}(?:指令|规则)|发送到)/iu.test(text)
}
