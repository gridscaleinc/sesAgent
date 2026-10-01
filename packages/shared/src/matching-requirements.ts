/** One requirement policy for both directions of the HR workbench. Scores never
 * compensate for an unevidenced mandatory skill. This describes a pair, not a
 * person's lifecycle or permission to use the workbench. */
export const businessMatchingPolicyVersion = 'technical-language-v5' as const

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
  /** Met because the skill is on the resume and nothing states too few years; HR confirms the years when in contact. */
  yearsUnconfirmed?: true
  /** Settled by the cloud AI quoting this person's own material (a local check alone could not). */
  aiVerified?: true
  /** HR's own decision on an item the material left unclear; the local outcome underneath was 'unknown'. */
  hrDecision?: RequirementHrDecision
}
/** What HR settled about one requirement: confirmed, not met, or being asked of the person. */
export interface RequirementHrDecision {
  confirmationId: string
  outcome: RequirementConfirmation['outcome']
  scope: RequirementConfirmation['scope']
  note: string | null
  question: string | null
  decidedAt: string
  decidedBy: string | null
  /** What the material (résumé, rules, AI review) concluded before HR decided; restored when the decision is withdrawn. */
  materialOutcome?: MatchRequirementEvidence['outcome']
}
/**
 * One HR decision on a requirement. 'person' scope is a fact about the person (their Japanese, their years with a
 * skill) and applies to every case asking the same thing; 'pair' scope holds only for one case version.
 */
export interface RequirementConfirmation {
  id: string
  documentId: string
  scope: 'person' | 'pair'
  /** Set for 'pair' scope: the decision holds only while the case stays at this version. */
  jobCaseId: string | null
  jobCaseVersion: number | null
  /** requirementIdentity of the requirement, so the same wording in another case finds it. */
  requirementKey: string
  requirementLabel: string
  outcome: 'met' | 'conflict' | 'asking'
  note: string | null
  /** For 'asking': what HR will ask the person. */
  question: string | null
  decidedAt: string
  decidedBy: string | null
}
export interface BusinessMatchQualification {
  policyVersion: typeof businessMatchingPolicyVersion | 'mandatory-evidence-v1' | 'mandatory-evidence-v2'
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
const language = /英語|英语|英文|日本語|日语|日文|\b(?:English|Japanese|JLPT|N[1-5]|TOEIC\d*|IELTS|TOEFL)\b/iu
const optional = /尚可|歓迎|加分|优先|優遇|nice.to.have|preferred|optional/iu
const orOperator = /^(?:または|又は|もしくは|あるいは|或(?:者)?|or|か)$/iu
const aliases: Record<string, string[]> = {
  spark: ['Spark', 'Apache Spark', 'PySpark'],
  'spring boot': ['Spring Boot', 'SpringBoot'],
  springboot: ['Spring Boot', 'SpringBoot'],
  'sql server': ['SQL Server', 'MSSQL'],
  postgresql: ['PostgreSQL', 'Postgres'],
  javascript: ['JavaScript', 'JS'],
  typescript: ['TypeScript', 'TS'],
  'node.js': ['Node.js', 'NodeJS'],
  'vue.js': ['Vue.js', 'VueJS', 'Vue'],
  'react.js': ['React.js', 'ReactJS', 'React'],
  'c#': ['C#', 'C Sharp'],
  aws: ['AWS', 'Amazon Web Services'],
  gcp: ['GCP', 'Google Cloud'],
  uipath: ['UiPath'],
  kubernetes: ['Kubernetes', 'K8s']
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
  return (
    segments
      .find(
        (part) =>
          mentionsRequiredTerm(part, term) &&
          !/(?:未経験|経験(?:は)?なし|経験がない|未使用|未対応|学習中|勉強中|不具备|没有|无.{0,8}经验|暂无|未掌握|\bno\b|\bwithout\b|\bnot\b|learning only)/iu.test(
            part
          )
      )
      ?.trim() ?? null
  )
}

export function explicitSkillDenial(text: string, term: string): boolean {
  return text
    .split(/[\n。;；,，、]+/u)
    .some(
      (part) =>
        mentionsRequiredTerm(part, term) && /未経験|経験(?:は)?なし|経験がない|未使用|不具备|没有|\bno\b|\bwithout\b|\bnot\b/iu.test(part)
    )
}

/** Preserve common compound names, and retain prose requirements as an atomic
 * clause for cloud evidence review rather than silently discarding them. */
function termsIn(text: string): string[] {
  const protectedNames: string[] = []
  const remaining = text
    .replace(/(?<=[A-Za-z+#])(\d+(?:\.\d+)?)(?=\s*年以上)/gu, ' $1')
    .replace(
      /Spring\s*Boot|SQL\s+Server|Amazon\s+Web\s+Services|Google\s+Cloud|Apache\s+Spark|SAP\s+(?:FI(?:\s*\/\s*CO)?|CO|ABAP|S\/4HANA)/giu,
      (value) => {
        protectedNames.push(value)
        return ' '
      }
    )
  const words = remaining.match(/(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]*(?:[+#]{1,2}|\.[A-Za-z0-9]+)*(?![A-Za-z0-9])/gu) ?? []
  const technical = words.filter(
    (word) =>
      !generic.test(word) &&
      !/^(?:and|or|with|using|experience|years?|required|must|have|development|in|of|the|at|least|business|level|native|fluent)$/iu.test(
        word
      )
  )
  const concepts =
    remaining.match(
      /要件定義|基本設計|詳細設計|業務分析|データ分析|データ基盤|プロジェクト管理|進捗管理|品質管理|テスト自動化|自動テスト|運用保守|障害対応|需求分析|概要设计|详细设计|项目管理|自动化测试|数据分析/gu
    ) ?? []
  return [...new Set([...protectedNames, ...technical, ...concepts])]
}

/** Small explicit AND/OR grammar. Parentheses retain their scope; adjacent
 * atoms mean AND, and ordinary prose stays an atom for evidence review. */
function requirementAlternatives(text: string): string[][] {
  const tokens = text
    .replace(/[（]/gu, '(')
    .replace(/[）]/gu, ')')
    .split(/(\(|\)|\bor\b|\band\b|または|又は|もしくは|あるいは|或(?:者)?|かつ|および|及び|以及|并且|且|(?<=[A-Za-z+#])か(?=[A-Za-z]))/iu)
    .map((part) => part.trim())
    .filter(Boolean)
  let index = 0
  const primary = (): string[][] => {
    if (tokens[index] === '(') {
      index++
      const result = disjunction()
      if (tokens[index] === ')') index++
      return result
    }
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
    while (index < tokens.length && orOperator.test(tokens[index]!)) {
      index++
      left = [...left, ...conjunction()].slice(0, 32)
    }
    return left
  }
  return disjunction()
}

function hasUnparsedQualifier(clause: string, choices: string[][]): boolean {
  let rest = clause
  for (const term of [...new Set(choices.flat())].sort((a, b) => b.length - a.length))
    rest = rest.replace(new RegExp(escape(term), 'giu'), '')
  rest = rest
    .replace(/\d+(?:\.\d+)?\s*(?:年以上|年(?:以上)?の経験|\+?\s*years?)/giu, '')
    .replace(
      /実務経験|実務|経験|实务经验|实务|经验|必須|必须|必需|スキル|技能|使用|または|又は|もしくは|あるいは|かつ|および|及び|以及|并且|或者|\b(?:and|or|experience|required|must|have|using)\b/giu,
      ''
    )
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
    return trimmed
      .split(/[、,，]+/u)
      .map((part) => part.trim())
      .filter((part) => part && !optional.test(part))
  })
}

export function parseMatchRequirements(fields: readonly Field[]): MatchRequirement[] {
  const result: MatchRequirement[] = []
  for (const field of fields) {
    if (!field.value?.trim()) continue
    if (field.key === 'required_skills') {
      for (const clause of skillClauses(field.value)) {
        const choices = requirementAlternatives(clause)
        const businessKey = /^(?:週\s*[1-5]\s*日?\s*(?:出社|出勤)|常駐|フルリモート|完全在宅|リモート|在宅)/u.test(clause)
          ? 'remote'
          : /^(?:(?:20\d{2}年)?\d{1,2}月|即日).*(?:長期|開始|入場|稼働|～|〜|~)/u.test(clause)
            ? 'start_date'
            : null
        const isCondition =
          Boolean(businessKey) ||
          (language.test(clause) && choices.every((terms) => terms.every((term) => /^(?:TOEIC\d*|IELTS|TOEFL|JLPT)$/iu.test(term)))) ||
          generic.test(clause.trim()) ||
          /^(?:SE|PG|PM|PMO|PL|TL|SL)\s*\d*\s*名?$/iu.test(clause.trim())
        result.push({
          id: `R${result.length + 1}`,
          key: businessKey ?? field.key,
          label: clause,
          category: isCondition ? 'condition' : 'core',
          alternatives: choices,
          minimumYears: Number(clause.match(/(\d+(?:\.\d+)?)\s*(?:年以上|年(?:以上)?の経験|\+?\s*years?)/iu)?.[1]) || null,
          requiresPractice: /実務|实务|实际|実績|production|commercial/iu.test(clause),
          requiresSemanticReview: !isCondition && hasUnparsedQualifier(clause, choices)
        })
      }
    } else if (
      ['japanese_level', 'role', 'rate', 'start_date', 'remote', 'location', 'work_authorization', 'contract_chain'].includes(field.key)
    ) {
      result.push({
        id: `R${result.length + 1}`,
        key: field.key,
        label: field.value.trim(),
        category: 'condition',
        alternatives: [],
        minimumYears: null,
        requiresPractice: false
      })
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
  return {
    evidence: [...new Set(matches.map((match) => match!.evidence))].join('、'),
    source: [...new Set(matches.map((match) => match!.source))].join(' / ')
  }
}

/** A job title that names the skill (「Java バックエンドエンジニア」) means the total experience was spent with it. */
function titleYearsEvidence(profile: MatchProfessionalFacts, term: string, minimumYears: number): string | null {
  const role = profile.fields.find((field) => field.key === 'role')?.value
  const years = profile.fields.find((field) => field.key === 'experience_years')?.value
  const total = Number(years?.normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*(?:年|years?)/iu)?.[1])
  return role && years && positiveSkillEvidence(role, term) && total >= minimumYears ? `${role} · ${years}` : null
}

const yearsIn = (text: string | null | undefined) => {
  const years = text?.normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*(?:年|years?)/iu)?.[1]
  return years === undefined ? null : Number(years)
}

/** How well the resume supports "N years of this skill": proven, clearly short, or simply not stated. */
function skillYears(profile: MatchProfessionalFacts, term: string, minimumYears: number): 'enough' | 'short' | 'unclear' {
  const stated = profile.fields.flatMap((field) => {
    const part =
      ['skills', 'summary', 'experience', 'role'].includes(field.key) && field.value ? positiveSkillEvidence(field.value, term) : null
    const years = yearsIn(part)
    return years === null ? [] : [years]
  })
  if (stated.some((years) => years >= minimumYears)) return 'enough'
  if (titleYearsEvidence(profile, term, minimumYears)) return 'enough'
  const months = new Set<number>()
  for (const project of profile.projectExperiences) {
    if (
      explicitSkillDenial(project.summary, term) ||
      !positiveSkillEvidence([project.title, ...project.technologies, project.summary].join('、'), term)
    )
      continue
    const dates = [...(project.period ?? '').matchAll(/(20\d{2}|19\d{2})\s*[年/.-]\s*(1[0-2]|0?[1-9])/gu)]
    if (dates.length < 2) continue
    const start = Number(dates[0]![1]) * 12 + Number(dates[0]![2])
    const end = Number(dates[1]![1]) * 12 + Number(dates[1]![2])
    if (end < start || end - start > 600) continue
    for (let month = start; month <= end; month++) months.add(month)
  }
  if (months.size >= minimumYears * 12) return 'enough'
  // Only a written number can rule the person out: years stated for the skill, or a whole career shorter than asked.
  // Listed projects rarely cover a whole career, so a short project total alone is not a shortfall.
  const total = yearsIn(profile.fields.find((field) => field.key === 'experience_years')?.value)
  if (stated.length || (total !== null && total < minimumYears)) return 'short'
  return 'unclear'
}

function experienceEnough(profile: MatchProfessionalFacts, terms: string[], requirement: MatchRequirement): boolean {
  return terms.every((term) => {
    if (!requirement.minimumYears) {
      const projects = profile.projectExperiences.filter(
        (project) =>
          !explicitSkillDenial(project.summary, term) &&
          positiveSkillEvidence([project.title, ...project.technologies, project.summary].join('、'), term)
      )
      return (
        !requirement.requiresPractice ||
        projects.length > 0 ||
        profile.fields.some(
          (field) =>
            field.key === 'skills' &&
            field.value &&
            positiveSkillEvidence(field.value, term) &&
            /実務|实务|\d+\s*年/iu.test(positiveSkillEvidence(field.value, term)!)
        )
      )
    }
    return skillYears(profile, term, requirement.minimumYears) !== 'short'
  })
}

export function localCoreRequirementEvidence(profile: MatchProfessionalFacts, requirement: MatchRequirement): MatchRequirementEvidence {
  for (const terms of requirement.alternatives) {
    const match = alternativeEvidence(profile, terms)
    if (match && !requirement.requiresSemanticReview && experienceEnough(profile, terms, requirement)) {
      // When only the job title and total years prove the years, quote them so the reader sees why.
      const title = requirement.minimumYears
        ? terms.map((term) => titleYearsEvidence(profile, term, requirement.minimumYears!)).find(Boolean)
        : null
      const unconfirmed = Boolean(
        requirement.minimumYears && terms.some((term) => skillYears(profile, term, requirement.minimumYears!) === 'unclear')
      )
      return {
        requirement,
        outcome: 'met',
        ...match,
        ...(title ? { evidence: `${match.evidence}、${title}` } : {}),
        ...(unconfirmed ? { yearsUnconfirmed: true as const } : {})
      }
    }
  }
  return { requirement, outcome: 'unknown', evidence: null, source: null }
}

/** Cloud quotes must come from this person's professional material, and an
 * atomic technology claim must actually name that technology. */
export function groundedProfessionalQuote(profile: MatchProfessionalFacts, quote: string): boolean {
  const values = [
    ...profile.fields.flatMap((field) => (field.value ? [field.value] : [])),
    ...profile.projectExperiences.flatMap((project) => [
      project.title,
      project.period ?? '',
      project.role ?? '',
      ...project.technologies,
      project.summary
    ])
  ]
  const parts = quote
    .split(/、/u)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 && parts.every((part) => values.some((value) => norm(value).includes(norm(part))))
}

export function groundedRequirementQuote(profile: MatchProfessionalFacts, requirement: MatchRequirement, quote: string): boolean {
  if (!groundedProfessionalQuote(profile, quote)) return false
  if (requirement.category === 'condition') {
    if (/(未経験|経験なし|不具备|没有|\bno\b|\bnot\b)/iu.test(quote)) return false
    if (/英語|英语|英文|English|TOEIC|IELTS|TOEFL/iu.test(requirement.label))
      return /英語|英语|英文|English|TOEIC|IELTS|TOEFL/iu.test(quote)
    if (/日本語|日语|Japanese|N[1-5]/iu.test(requirement.label)) return /日本語|日语|Japanese|N[1-5]|JLPT|会話|ビジネス/iu.test(quote)
    return true
  }
  if (!requirement.alternatives.some((terms) => terms.length > 0))
    return quote.length >= 8 && !/(未経験|経験なし|不具备|没有|\bno\b|\bnot\b)/iu.test(quote)
  if (
    requirement.requiresSemanticReview &&
    (quote.length < 8 || !profile.projectExperiences.some((project) => norm(project.summary).includes(norm(quote))))
  )
    return false
  return requirement.alternatives.some(
    (terms) => terms.length && terms.every((term) => positiveSkillEvidence(quote, term)) && experienceEnough(profile, terms, requirement)
  )
}

export function qualificationStatus(requirements: MatchRequirementEvidence[]): BusinessMatchQualification['status'] {
  const core = requirements.filter((item) => isProposalRequirement(item.requirement))
  if (core.some((item) => item.outcome === 'conflict')) return 'excluded'
  if (!core.some((item) => requirementDimension(item.requirement) === 'technical') || core.some((item) => item.outcome === 'unknown'))
    return 'needs-confirmation'
  return 'recommended'
}

/** Business terms remain visible, but do not decide professional suitability. */
export function requirementDimension(
  requirement: Pick<MatchRequirement, 'key' | 'label' | 'category'>
): 'technical' | 'language' | 'business' {
  if (
    ['japanese_level', 'japanese-level', 'english_level', 'language'].includes(requirement.key) ||
    (requirement.category === 'condition' && language.test(requirement.label))
  )
    return 'language'
  return requirement.category === 'core' ? 'technical' : 'business'
}
export const isProposalRequirement = (requirement: MatchRequirement) => requirementDimension(requirement) !== 'business'

export function proposalConclusion(qualification: BusinessMatchQualification | undefined, zh: boolean): string {
  return qualification?.status === 'recommended'
    ? zh
      ? '可以提案'
      : '提案可能'
    : qualification?.status === 'excluded'
      ? excludedByHr(qualification)
        ? zh
          ? 'HR 确认不满足本案条件'
          : 'HRが案件条件を満たさないと確認'
        : zh
          ? '不建议向本案提案'
          : 'この案件への提案は推奨しません'
      : zh
        ? '待确认'
        : '確認待ち'
}

export const requirementIdentity = (requirement: Pick<MatchRequirement, 'key' | 'label' | 'category'>) =>
  `${requirementDimension(requirement)}:${norm(requirement.label).replace(/[\s（）()、,，:：~〜～]/gu, '')}`
export function uniqueRequirementEvidence(items: MatchRequirementEvidence[]): MatchRequirementEvidence[] {
  const result = new Map<string, MatchRequirementEvidence>()
  for (const item of items) {
    const key = requirementIdentity(item.requirement),
      previous = result.get(key)
    // A known conflict takes precedence over a duplicate positive or unknown.
    const rank = { unknown: 0, met: 1, conflict: 2 }
    if (!previous || rank[item.outcome] > rank[previous.outcome]) result.set(key, item)
  }
  return [...result.values()]
}

/** Free model questions are deliberately not merged back into resolved facts.
 * Explicit HR questions may add a topic, but cannot reopen an assessed item. */
export function matchEvidenceSections(qualification: BusinessMatchQualification | undefined, questions: string[] = []) {
  const items = uniqueRequirementEvidence(qualification?.requirements ?? [])
  const questionKey = (value: string) => norm(value).replace(/[\s（）()、,，:：~〜～]/gu, '')
  const represented = (question: string) =>
    items.some((item) => {
      const label = questionKey(item.requirement.label),
        text = questionKey(question)
      return (
        text.includes(label) ||
        label.includes(text) ||
        item.requirement.alternatives.flat().some((term) => mentionsRequiredTerm(question, term)) ||
        (requirementDimension(item.requirement) === 'language' &&
          /(日本語|日语|Japanese|JLPT|N[1-5])/iu.test(item.requirement.label) &&
          /(日本語|日语|Japanese|JLPT|N[1-5])/iu.test(question))
      )
    })
  return {
    met: items.filter((item) => item.outcome === 'met'),
    conflicts: items.filter((item) => item.outcome === 'conflict' && isProposalRequirement(item.requirement)),
    corePending: items.filter((item) => item.outcome === 'unknown' && isProposalRequirement(item.requirement)),
    businessPending: items.filter((item) => item.outcome !== 'met' && !isProposalRequirement(item.requirement)),
    questions: [...new Map(questions.filter((text) => text.trim() && !represented(text)).map((text) => [questionKey(text), text])).values()]
  }
}

export function matchFollowUpLabels(qualification: BusinessMatchQualification | undefined, questions: string[] = [], zh = true): string[] {
  const sections = matchEvidenceSections(qualification, questions)
  return [...sections.corePending, ...sections.businessPending]
    .map((item) =>
      // What HR chose to ask the person goes into the follow-up as written.
      item.hrDecision?.outcome === 'asking' && item.hrDecision.question
        ? item.hrDecision.question
        : `${requirementDisplayLabel(item.requirement, zh)}${item.evidence ? `：${item.evidence}` : ''}${item.outcome === 'conflict' ? (zh ? '（条件有差异，需协商）' : '（条件に相違あり・要相談）') : ''}`
    )
    .concat(sections.questions)
}

export function requirementDisplayLabel(requirement: MatchRequirement, zh: boolean): string {
  if (!/^(無|有|なし|あり|可|不可|要相談|不問|未定|待定|无|有|可以|否)$/u.test(requirement.label)) return requirement.label
  const names: Record<string, [string, string]> = {
    remote: ['工作方式', '勤務形態'],
    rate: ['单价', '単価'],
    start_date: ['入场时间', '稼働時期'],
    location: ['地点', '勤務地']
  }
  const name = names[requirement.key]
  return name ? `${name[zh ? 0 : 1]}：${requirement.label}` : requirement.label
}

/** The local result under any earlier HR decision, so applying the current decisions again is exact and reversible. */
function withoutHrDecision(item: MatchRequirementEvidence): MatchRequirementEvidence {
  if (!item.hrDecision) return item
  const { hrDecision, ...rest } = item
  return { ...rest, outcome: hrDecision.materialOutcome ?? 'unknown' }
}
/** The decision that applies to one requirement of a case: one made for this case version first, then the person's own. */
export function requirementConfirmationFor(
  confirmations: readonly RequirementConfirmation[],
  requirement: Pick<MatchRequirement, 'key' | 'label' | 'category'>,
  job: { id: string; version: number }
): RequirementConfirmation | undefined {
  const key = requirementIdentity(requirement)
  const latest = (items: RequirementConfirmation[]) => items.toSorted((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0]
  return (
    latest(
      confirmations.filter(
        (item) => item.requirementKey === key && item.scope === 'pair' && item.jobCaseId === job.id && item.jobCaseVersion === job.version
      )
    ) ?? latest(confirmations.filter((item) => item.requirementKey === key && item.scope === 'person'))
  )
}
/**
 * Applies HR decisions to a pair's qualification. Only technical and language items the material left 'unknown' take
 * a decision; a met or conflicting local result stays as it is. Earlier decisions are removed first, so a withdrawn
 * decision returns the item to 'unknown'.
 */
export function applyRequirementConfirmations(
  qualification: BusinessMatchQualification,
  confirmations: readonly RequirementConfirmation[],
  job: { id: string; version: number }
): BusinessMatchQualification {
  const requirements = qualification.requirements.map((original) => {
    const item = withoutHrDecision(original)
    // HR's decision is the final word on a requirement, whatever the material or the AI review concluded: an unclear
    // item is settled, a conflict HR knows better about is overruled, and a 不满足 holds even where the AI saw a match.
    if (!isProposalRequirement(item.requirement)) return item
    const decision = requirementConfirmationFor(confirmations, item.requirement, job)
    if (!decision) return item
    return {
      ...item,
      outcome: decision.outcome === 'asking' ? ('unknown' as const) : decision.outcome,
      hrDecision: {
        confirmationId: decision.id,
        outcome: decision.outcome,
        scope: decision.scope,
        note: decision.note,
        question: decision.question,
        decidedAt: decision.decidedAt,
        decidedBy: decision.decidedBy,
        materialOutcome: item.outcome
      }
    }
  })
  const changed = requirements.some((item, index) => item !== qualification.requirements[index])
  return changed ? { ...qualification, requirements, status: qualificationStatus(requirements) } : qualification
}
/**
 * True when HR judged any requirement of this pair 不满足: the pair stays listed, marked and sorted last, and is not
 * proposed or interviewed from any entry (the same reading as Main's rejectedByHr). Other conflicts of the material
 * may sit beside it; HR's judgement is what decides.
 */
export function excludedByHr(qualification: BusinessMatchQualification | undefined): boolean {
  if (qualification?.status !== 'excluded') return false
  return (qualification.requirements ?? []).some(
    (item) => isProposalRequirement(item.requirement) && item.outcome === 'conflict' && item.hrDecision?.outcome === 'conflict'
  )
}
/** A first wording of what to ask the person about an unclear requirement; HR edits it before saving. */
export function requirementQuestion(requirement: MatchRequirement, zh: boolean): string {
  const label = requirementDisplayLabel(requirement, zh)
  if (requirementDimension(requirement) === 'language')
    return zh
      ? `关于「${label}」：请确认本人在工作中实际使用该语言的程度（会议、邮件、文档）。`
      : `「${label}」について、業務での使用状況（会議・メール・資料作成）をご本人に確認させてください。`
  return zh
    ? `关于「${label}」：请确认本人的实际经验（年限、担当内容、最近一次使用时间）。`
    : `「${label}」について、実務経験（年数・担当内容・直近の利用時期）をご本人に確認させてください。`
}
