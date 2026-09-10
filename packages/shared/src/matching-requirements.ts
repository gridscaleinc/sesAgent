/** One requirement policy for both directions of the HR workbench. Scores never
 * compensate for an unevidenced mandatory skill. This describes a pair, not a
 * person's lifecycle or permission to use the workbench. */
export const businessMatchingPolicyVersion = 'mandatory-evidence-v1' as const

export interface MatchRequirement {
  id: string
  key: string
  label: string
  category: 'core' | 'condition'
  /** Any alternative may satisfy the group; terms within an alternative are AND. */
  alternatives: string[][]
  minimumYears: number | null
  requiresPractice: boolean
  /** Unparsed qualifiers must be read against project evidence by the model. */
  requiresSemanticReview?: boolean
}
export interface MatchRequirementEvidence {
  requirement: MatchRequirement
  outcome: 'met' | 'unknown' | 'conflict'
  evidence: string | null
  source: string | null
}
export interface BusinessMatchQualification {
  policyVersion: typeof businessMatchingPolicyVersion
  status: 'recommended' | 'needs-confirmation' | 'excluded'
  requirements: MatchRequirementEvidence[]
}
export interface MatchProfessionalFacts {
  fields: ReadonlyArray<{ key: string; label: string; value: string | null }>
  projectExperiences: ReadonlyArray<{ title: string; period: string | null; role: string | null; technologies: string[]; summary: string }>
}
type Field = { key: string; label: string; value: string | null }
const norm = (text: string) => text.normalize('NFKC').toLowerCase().trim()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const generic = /^(?:SE|PG|PM|PMO|PL|TL|SL|IT|英語|英语|英文|日本語|日语|日文|English|Japanese|N[1-5]|エンジニア|工程师)$/iu
const language = /英語|英语|英文|日本語|日语|日文|\b(?:English|Japanese|JLPT|N[1-5]|TOEIC)\b/iu
const optional = /尚可|歓迎|加分|优先|優遇|nice.to.have|preferred|optional/iu
const orOperator = /^(?:または|又は|もしくは|あるいは|或(?:者)?|or|か)$/iu
const aliases: Record<string, string[]> = {
  spark: ['Spark', 'Apache Spark', 'PySpark'],
  'spring boot': ['Spring Boot', 'SpringBoot'],
  springboot: ['Spring Boot', 'SpringBoot'],
  'sql server': ['SQL Server', 'MSSQL'],
  postgresql: ['PostgreSQL', 'Postgres'],
  javascript: ['JavaScript', 'JS'], typescript: ['TypeScript', 'TS'],
  'node.js': ['Node.js', 'NodeJS'], 'vue.js': ['Vue.js', 'VueJS', 'Vue'],
  'react.js': ['React.js', 'ReactJS', 'React'], 'c#': ['C#', 'C Sharp'],
  aws: ['AWS', 'Amazon Web Services'], gcp: ['GCP', 'Google Cloud'],
  uipath: ['UiPath'], kubernetes: ['Kubernetes', 'K8s']
}

/** Exact technology boundaries: Java is not JavaScript; SQL is not NoSQL.
 * Equivalences are directional: PySpark establishes Spark, never Scala. */
export function mentionsRequiredTerm(text: string, term: string): boolean {
  return (aliases[norm(term)] ?? [term]).some((name) => {
    const pattern = escape(norm(name)).replace(/\s+/gu, '\\s*')
    return new RegExp(`(?<![a-z0-9+#])${pattern}(?![a-z0-9+#])`, 'u').test(norm(text))
  })
}

export function positiveSkillEvidence(text: string, term: string): string | null {
  const segments = text.split(/[\n。;；,，、]+/u)
  return segments.find((part) => mentionsRequiredTerm(part, term) &&
    !/(?:未経験|経験(?:は)?なし|経験がない|未使用|未対応|学習中|勉強中|不具备|没有|无.{0,8}经验|暂无|未掌握|\bno\b|\bwithout\b|\bnot\b|learning only)/iu.test(part))?.trim() ?? null
}

export function explicitSkillDenial(text: string, term: string): boolean {
  return text.split(/[\n。;；,，、]+/u).some((part) => mentionsRequiredTerm(part, term) && /未経験|経験(?:は)?なし|経験がない|未使用|不具备|没有|\bno\b|\bwithout\b|\bnot\b/iu.test(part))
}

/** Preserve common compound names, and retain prose requirements as an atomic
 * clause for cloud evidence review rather than silently discarding them. */
function termsIn(text: string): string[] {
  const protectedNames: string[] = []
  const remaining = text.replace(/(?<=[A-Za-z+#])(\d+(?:\.\d+)?)(?=\s*年以上)/gu, ' $1').replace(/Spring\s*Boot|SQL\s+Server|Amazon\s+Web\s+Services|Google\s+Cloud|Apache\s+Spark|SAP\s+(?:FI(?:\s*\/\s*CO)?|CO|ABAP|S\/4HANA)/giu, (value) => {
    protectedNames.push(value); return ' '
  })
  const words = remaining.match(/(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]*(?:[+#]{1,2}|\.[A-Za-z0-9]+)*(?![A-Za-z0-9])/gu) ?? []
  const technical = words.filter((word) => !generic.test(word) && !/^(?:and|or|with|using|experience|years?|required|must|have|development|in|of|the|at|least|business|level|native|fluent)$/iu.test(word))
  const concepts = remaining.match(/要件定義|基本設計|詳細設計|業務分析|データ分析|データ基盤|プロジェクト管理|進捗管理|品質管理|テスト自動化|自動テスト|運用保守|障害対応|需求分析|概要设计|详细设计|项目管理|自动化测试|数据分析/gu) ?? []
  return [...new Set([...protectedNames, ...technical, ...concepts])]
}

/** Small explicit AND/OR grammar. Parentheses retain their scope; adjacent
 * atoms mean AND, and ordinary prose stays an atom for evidence review. */
function requirementAlternatives(text: string): string[][] {
  const tokens = text.replace(/[（]/gu, '(').replace(/[）]/gu, ')')
    .split(/(\(|\)|\bor\b|\band\b|または|又は|もしくは|あるいは|或(?:者)?|かつ|および|及び|以及|并且|且|(?<=[A-Za-z+#])か(?=[A-Za-z]))/iu)
    .map((part) => part.trim()).filter(Boolean)
  let index = 0
  const primary = (): string[][] => {
    if (tokens[index] === '(') { index++; const result = disjunction(); if (tokens[index] === ')') index++; return result }
    return [termsIn(tokens[index++] ?? '')]
  }
  const conjunction = (): string[][] => {
    let left = primary()
    while (index < tokens.length && tokens[index] !== ')' && !orOperator.test(tokens[index]!)) {
      if (/^(?:and|かつ|および|及び|以及|并且|且)$/iu.test(tokens[index]!)) index++
      const right = primary()
      left = left.flatMap((a) => right.map((b) => [...new Set([...a, ...b])])).slice(0, 32)
    }
    return left
  }
  const disjunction = (): string[][] => {
    let left = conjunction()
    while (index < tokens.length && orOperator.test(tokens[index]!)) { index++; left = [...left, ...conjunction()].slice(0, 32) }
    return left
  }
  return disjunction()
}

function hasUnparsedQualifier(clause: string, choices: string[][]): boolean {
  let rest = clause
  for (const term of [...new Set(choices.flat())].sort((a, b) => b.length - a.length)) rest = rest.replace(new RegExp(escape(term), 'giu'), '')
  rest = rest.replace(/\d+(?:\.\d+)?\s*(?:年以上|年(?:以上)?の経験|\+?\s*years?)/giu, '')
    .replace(/実務経験|実務|経験|实务经验|实务|经验|必須|必须|必需|スキル|技能|使用|または|又は|もしくは|あるいは|かつ|および|及び|以及|并且|或者|\b(?:and|or|experience|required|must|have|using)\b/giu, '')
    .replace(/[\s()（）/／・、,，&+~〜～:：的のと或か]+/gu, '')
  return rest.length > 0
}

function skillClauses(value: string): string[] {
  // A labelled optional section does not become mandatory if it was extracted
  // into required_skills. Keep mandatory material preceding it.
  const mandatory = value.replace(/(?:[【\[]?(?:尚可|歓迎|加分项?|优先|nice.to.have|preferred)[】\]]?\s*[:：])[\s\S]*$/iu, '')
  return mandatory.split(/[\n;；。]+/u).flatMap((line) => {
    const trimmed = line.trim().replace(/^[・●■◆\-*\d.)\s]+/u, '')
    if (!trimmed) return []
    // Explicit "one of" scopes the entire comma/slash list on this line.
    if (/いずれか|どちらか|任一|任选|其中之一|\bone of\b/iu.test(trimmed)) {
      return [trimmed.replace(/いずれか|どちらか|任一|任选|其中之一|\bone of\b/giu, '').replace(/[、,，/／]/gu, ' or ')]
    }
    return trimmed.split(/[、,，]+/u).map((part) => part.trim()).filter((part) => part && !optional.test(part))
  })
}

export function parseMatchRequirements(fields: readonly Field[]): MatchRequirement[] {
  const result: MatchRequirement[] = []
  for (const field of fields) {
    if (!field.value?.trim()) continue
    if (field.key === 'required_skills') {
      for (const clause of skillClauses(field.value)) {
        const choices = requirementAlternatives(clause)
        const isCondition = language.test(clause) && choices.every((terms) => terms.length === 0) || generic.test(clause.trim()) || /^(?:SE|PG|PM|PMO|PL|TL|SL)\s*\d*\s*名?$/iu.test(clause.trim())
        result.push({ id: `R${result.length + 1}`, key: field.key, label: clause,
          category: isCondition ? 'condition' : 'core', alternatives: choices,
          minimumYears: Number(clause.match(/(\d+(?:\.\d+)?)\s*(?:年以上|年(?:以上)?の経験|\+?\s*years?)/iu)?.[1]) || null,
          requiresPractice: /実務|实务|实际|実績|production|commercial/iu.test(clause),
          requiresSemanticReview: !isCondition && hasUnparsedQualifier(clause, choices) })
      }
    } else if (['japanese_level', 'role', 'rate', 'start_date', 'remote', 'location', 'work_authorization', 'contract_chain'].includes(field.key)) {
      result.push({ id: `R${result.length + 1}`, key: field.key, label: field.value.trim(), category: 'condition', alternatives: [], minimumYears: null, requiresPractice: false })
    }
  }
  return result
}

function alternativeEvidence(profile: MatchProfessionalFacts, terms: string[]): { evidence: string; source: string } | null {
  if (!terms.length) return null
  const matches = terms.map((term) => {
    // Actual project work has priority over a skills inventory or role label.
    for (const project of profile.projectExperiences) {
      if (explicitSkillDenial(project.summary, term)) continue
      for (const text of [project.summary, project.technologies.join('、'), project.title]) {
        const evidence = positiveSkillEvidence(text, term)
        if (evidence) return { evidence, source: project.title }
      }
    }
    for (const field of profile.fields.filter((field) => ['skills', 'summary', 'experience', 'role'].includes(field.key))) {
      const evidence = field.value ? positiveSkillEvidence(field.value, term) : null
      if (evidence) return { evidence, source: field.label }
    }
    return null
  })
  if (matches.some((match) => !match)) return null
  return { evidence: [...new Set(matches.map((match) => match!.evidence))].join('、'), source: [...new Set(matches.map((match) => match!.source))].join(' / ') }
}

function experienceEnough(profile: MatchProfessionalFacts, terms: string[], requirement: MatchRequirement): boolean {
  return terms.every((term) => {
    const projects = profile.projectExperiences.filter((project) => !explicitSkillDenial(project.summary, term) && positiveSkillEvidence([project.title, ...project.technologies, project.summary].join('、'), term))
    if (!requirement.minimumYears) return !requirement.requiresPractice || projects.length > 0 || profile.fields.some((field) => field.key === 'skills' && field.value && positiveSkillEvidence(field.value, term) && /実務|实务|\d+\s*年/iu.test(positiveSkillEvidence(field.value, term)!))
    const explicit = profile.fields.some((field) => {
      const part = field.key === 'skills' && field.value ? positiveSkillEvidence(field.value, term) : null
      const years = part?.match(/(\d+(?:\.\d+)?)\s*(?:年|years?)/iu)?.[1]
      return years !== undefined && Number(years) >= requirement.minimumYears!
    })
    if (explicit) return true
    const months = new Set<number>()
    for (const project of projects) {
      const dates = [...(project.period ?? '').matchAll(/(20\d{2}|19\d{2})\s*[年/.-]\s*(1[0-2]|0?[1-9])/gu)]
      if (dates.length < 2) continue
      const start = Number(dates[0]![1]) * 12 + Number(dates[0]![2])
      const end = Number(dates[1]![1]) * 12 + Number(dates[1]![2])
      if (end < start || end - start > 600) continue
      for (let month = start; month <= end; month++) months.add(month)
    }
    return months.size >= requirement.minimumYears * 12
  })
}

export function localCoreRequirementEvidence(profile: MatchProfessionalFacts, requirement: MatchRequirement): MatchRequirementEvidence {
  for (const terms of requirement.alternatives) {
    const match = alternativeEvidence(profile, terms)
    if (match && !requirement.requiresSemanticReview && experienceEnough(profile, terms, requirement)) return { requirement, outcome: 'met', ...match }
  }
  return { requirement, outcome: 'unknown', evidence: null, source: null }
}

/** Cloud quotes must come from this person's professional material, and an
 * atomic technology claim must actually name that technology. */
export function groundedProfessionalQuote(profile: MatchProfessionalFacts, quote: string): boolean {
  const values = [...profile.fields.flatMap((field) => field.value ? [field.value] : []),
    ...profile.projectExperiences.flatMap((project) => [project.title, project.period ?? '', project.role ?? '', ...project.technologies, project.summary])]
  const parts = quote.split(/、/u).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 && parts.every((part) => values.some((value) => norm(value).includes(norm(part))))
}

export function groundedRequirementQuote(profile: MatchProfessionalFacts, requirement: MatchRequirement, quote: string): boolean {
  if (!groundedProfessionalQuote(profile, quote)) return false
  if (requirement.category === 'condition') {
    if (/(未経験|経験なし|不具备|没有|\bno\b|\bnot\b)/iu.test(quote)) return false
    if (/英語|英语|英文|English|TOEIC|IELTS|TOEFL/iu.test(requirement.label)) return /英語|英语|英文|English|TOEIC|IELTS|TOEFL/iu.test(quote)
    if (/日本語|日语|Japanese|N[1-5]/iu.test(requirement.label)) return /日本語|日语|Japanese|N[1-5]|JLPT|会話|ビジネス/iu.test(quote)
    return true
  }
  if (!requirement.alternatives.some((terms) => terms.length > 0)) return quote.length >= 8 && !/(未経験|経験なし|不具备|没有|\bno\b|\bnot\b)/iu.test(quote)
  if (requirement.requiresSemanticReview && (quote.length < 8 || !profile.projectExperiences.some((project) => norm(project.summary).includes(norm(quote))))) return false
  return requirement.alternatives.some((terms) => terms.length && terms.every((term) => positiveSkillEvidence(quote, term)) && experienceEnough(profile, terms, requirement))
}

export function qualificationStatus(requirements: MatchRequirementEvidence[]): BusinessMatchQualification['status'] {
  const core = requirements.filter((item) => item.requirement.category === 'core')
  if (!core.length || core.some((item) => item.outcome !== 'met') || requirements.some((item) => item.outcome === 'conflict')) return 'excluded'
  return requirements.some((item) => item.outcome === 'unknown') ? 'needs-confirmation' : 'recommended'
}
