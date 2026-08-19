interface NumberedMarker {
  index: number
  end: number
  prefix: string
  number: number
}

const numberedMarkerPattern = /(^|[\r\n]+|[？?!！。:：]\s*|\s+)(?:(\d{1,2})[.)、:：](?!\d)|[（(](\d{1,2})[）)])\s*/gu
const questionSignalPattern = /[？?。]$|请|如何|怎样|怎么|为什么|为何|説明|教えて|確認|どのよう|どんな|なぜ|いつ|どこ|何/u

function cleanQuestion(value: string): string {
  return value
    .replace(/^\s*(?:[-*•]|>)+\s*/u, '')
    .replace(/^\s*(?:\d{1,2}[.)、:：]|[（(]\d{1,2}[）)])\s*/u, '')
    .replace(/^\s*[「『“"]|[」』”"]\s*$/gu, '')
    .trim()
}

function numberedSegments(content: string): string[] {
  const candidates = [...content.matchAll(numberedMarkerPattern)].map((match) => ({
    index: match.index,
    end: match.index + match[0].length,
    prefix: match[1] ?? '',
    number: Number(match[2] ?? match[3])
  } satisfies NumberedMarker))
  const markers: NumberedMarker[] = []
  let expected = 1
  for (const candidate of candidates) {
    if (candidate.number !== expected) continue
    markers.push(candidate)
    expected += 1
  }
  if (markers.length < 2) return []
  return markers.map((marker, index) => {
    const next = markers[index + 1]
    if (!next) return content.slice(marker.end)
    const terminalOffset = next.prefix.search(/[？?!！。]/u)
    const end = next.index + (terminalOffset >= 0 ? terminalOffset + 1 : 0)
    return content.slice(marker.end, end)
  })
}

function normalizedQuestionKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, '')
}

export function extractInterviewQuestions(content: string): string[] {
  const normalized = content
    .replaceAll('\u0000', '')
    .replace(/[０-９]/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replaceAll('．', '.')
    .trim()
  if (!normalized) return []
  const segments = numberedSegments(normalized)
  const candidates = segments.length > 0 ? segments : normalized.split(/\r?\n+/u)
  const seen = new Set<string>()
  return candidates
    .map(cleanQuestion)
    .filter((question) => question.length >= 6 && question.length <= 300)
    .filter((question) => questionSignalPattern.test(question))
    .filter((question) => {
      const key = normalizedQuestionKey(question)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
}
