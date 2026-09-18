import type { MatchProfessionalFacts, MatchRequirement, MatchRequirementEvidence } from '@shared'

const japanese = /日本語|日语|日文|Japanese|JLPT|N[1-5]/iu
const english = /英語|英语|英文|English|TOEIC|IELTS|TOEFL/iu
const normalized = (value: string) => value.normalize('NFKC')

/** Read the person's language facts, including project/summary evidence when
 * extraction did not populate the dedicated field. Never use a case's words. */
export function languageRequirementEvidence(profile: MatchProfessionalFacts, requirement: MatchRequirement): MatchRequirementEvidence {
  const isJapanese = requirement.key === 'japanese_level' || requirement.key === 'japanese-level' || japanese.test(requirement.label)
  const marker = isJapanese ? japanese : english
  const sources = profile.fields.flatMap(field => {
    if (!field.value) return []
    if (field.key === (isJapanese ? 'japanese_level' : 'english_level')) return [{ text: field.value, source: field.label }]
    return field.value.split(/[\n。;；]/u).filter(text => marker.test(text)).map(text => ({ text, source: field.label }))
  }).concat(profile.projectExperiences.flatMap(project => project.summary.split(/[\n。;；]/u)
    .filter(text => marker.test(text)).map(text => ({ text, source: project.title }))))
  const facts = [...new Map(sources.map(source => [source.text, source])).values()]
  const actual = facts.map(source => source.text).join(' / ')
  const text = normalized(actual), requested = normalized(requirement.label)
  const result = (outcome: MatchRequirementEvidence['outcome']): MatchRequirementEvidence => ({ requirement, outcome,
    evidence: actual || null, source: facts.length ? [...new Set(facts.map(source => source.source))].join(' / ') : null })
  if (!text) return result('unknown')

  // Speaking grades have priority over reading/writing grades. An unexplained
  // A/B/C grade is not mapped to a JLPT certificate or communication level.
  const speech = text.match(/(?:会話|会话|口语|口語|speaking)\s*[:：]?\s*[A-D]\s*\(([^)]+)\)/iu)?.[1]
    ?? text.match(/(?:会話|会话|口语|口語|speaking)\s*[:：]?\s*([^/\n]+)/iu)?.[1]
  const abilityText = speech ?? text.replace(/(?:読む|読解|書く|読み|書き|reading|writing)\s*[:：]?\s*[A-D]\s*\([^)]+\)/giu, '')
  const unknownSpeech = Boolean(speech && /^[A-D]\s*$/iu.test(speech.trim()))
  const negative = /(?:会話|会话|口语|日本語|日语|英語|英语).{0,8}(?:不可|できない|无法|不能)|(?:ビジネス|流暢|流畅).{0,4}(?:不可|ではない|ではありません)|not\s+(?:fluent|conversational)/iu.test(abilityText)
  const fluent = !negative && !unknownSpeech && /流暢|流畅|堪能|ビジネス|商务|商務|スムーズ対応可|ネイティブ|母語|母国語|現地人と同じ|native|fluent|business|(?:顧客|客户).{0,12}(?:会議|会议|折衝|沟通|交渉|調整|対応).{0,8}(?:問題なし|支障なし|無障碍|无障碍)|(?:会議|会议).{0,8}(?:進行|主持)/iu.test(abilityText)
  const limited = negative || /ゆっくり対応可|ゆっくり.*(?:会話|対応)|慢速|初学者|初級|片言|挨拶程度|basic|beginner/iu.test(abilityText)
  const conversational = fluent || /日常会話|日常交流|会話レベル|中級|conversational/iu.test(abilityText)
  const wantsFluent = /流暢|流畅|ビジネス|商务|商務|堪能|fluent|business/iu.test(requested)
  const wantsConversation = wantsFluent || /日常会話|会話レベル|会話可能|conversational/iu.test(requested)
  if ((wantsConversation || isJapanese && /N[12]/iu.test(requested)) && limited) return result('conflict')
  if (negative) return result('conflict')

  if (isJapanese) {
    const wantedGrade = Number(requested.match(/N([1-5])/iu)?.[1]) || null
    const gradeMentions = [...text.matchAll(/(?:JLPT\s*)?N([1-5])/giu)].filter(match =>
      !/^\s*(?:を|は|に)?\s*(?:未取得|未合格|不合格|勉強中|学習中|取得予定|受験予定|未受験)/u.test(text.slice(match.index + match[0].length)))
    const heldGrades = gradeMentions.map(match => Number(match[1]))
    const grade = heldGrades.length ? Math.min(...heldGrades) : null
    const certificateRequired = /合格|取得|資格|証明|证书|持有|certificate/iu.test(requested)
    if (wantedGrade && grade && grade > wantedGrade) return result('conflict')
    const certificateGrade = gradeMentions.some(match => (!wantedGrade || Number(match[1]) <= wantedGrade) &&
      !/^\s*(?:相当|レベル|程度)/u.test(text.slice(match.index + match[0].length)))
    if (certificateRequired && !certificateGrade) return result('unknown')
    if (wantsFluent) return result(fluent ? 'met' : 'unknown')
    if (wantsConversation) return result(conversational ? 'met' : 'unknown')
    if (wantedGrade) return result(grade ? 'met' : wantedGrade >= 2 && fluent ? 'met' : 'unknown')
    if (/ネイティブ|母語|母国語|native/iu.test(requested)) return result(/ネイティブ|母語|母国語|native|現地人と同じ/iu.test(abilityText) ? 'met' : 'unknown')
    return result(grade || conversational || limited ? 'met' : 'unknown')
  }
  const minimum = requested.match(/TOEIC\s*[:：]?\s*(\d{3})/iu)?.[1]
  if (minimum) {
    const score = text.match(/TOEIC\s*[:：]?\s*(\d{3})/iu)?.[1]
    return result(score ? Number(score) >= Number(minimum) ? 'met' : 'conflict' : 'unknown')
  }
  if (wantsFluent) return result(fluent ? 'met' : limited ? 'conflict' : 'unknown')
  if (wantsConversation) return result(conversational ? 'met' : limited ? 'conflict' : 'unknown')
  return result(conversational ? 'met' : 'unknown')
}
