import { describe, expect, it } from 'vitest'
import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import { parseMatchRequirements } from '@shared'
import { applyBusinessVerdict, evaluateBusinessMatch } from './business-matching-policy'

const person = (skills: string, extra: Record<string, string> = {}, projects: CandidateProfile['projectExperiences'] = []): CandidateProfile => ({
  fields: Object.entries({ skills, ...extra }).map(([key, value]) => ({ key, label: key, value, sourceLabels: [] })), projectExperiences: projects
}) as unknown as CandidateProfile
const job = (skills: string, extra: Record<string, string> = {}): ConfirmedJobCase => ({
  fields: Object.entries({ required_skills: skills, ...extra }).map(([key, value]) => ({ key, label: key, value, sourceLabels: [] }))
}) as unknown as ConfirmedJobCase
const project = (technologies: string[], period = '2020年01月〜2023年12月', summary = '開発・運用を担当'): CandidateProfile['projectExperiences'][number] => ({
  id: 'project', title: 'データ処理基盤', technologies, period, role: 'SE', summary
}) as CandidateProfile['projectExperiences'][number]
const confident = { fit: 'strong' as const, met: [{ requirement: 'SE', evidence: 'SE' }], confirm: [], gaps: [], reason: 'qualified' }

describe('mandatory professional evidence', () => {
  it.each(['Java', 'SE', 'Scala', 'Spark', 'PySpark', 'JavaScript、SQL'])('does not recommend %s for Scala AND Spark', (skills) => {
    const evaluated = evaluateBusinessMatch(person(skills, { role: 'SE', japanese_level: 'N1' }), job('英語、Scala、Spark', { role: 'SE' }))
    expect(evaluated.qualification.status).toBe('excluded')
    expect(evaluated.missing.length).toBeGreaterThan(0)
  })
  it('cannot let a confident cloud role/language verdict override missing mandatory skills', () => {
    const actual = person('Java', { role: 'SE', japanese_level: 'N1' })
    const result = applyBusinessVerdict(actual, job('Scala、Spark', { role: 'SE' }), confident)
    expect(result.qualification.status).toBe('excluded')
    expect(result.fit).toBe('insufficient-info')
  })
  it('rejects invented and unrelated cloud quotations even if every mandatory label is returned', () => {
    const result = applyBusinessVerdict(person('Java'), job('Scala、Spark'), { ...confident,
      requirements: [{ requirement: 'Scala', outcome: 'met', evidence: 'Java' }, { requirement: 'Spark', outcome: 'met', evidence: 'Spark development' }] })
    expect(result.qualification.status).toBe('excluded')
  })
  it('allows directional aliases only for the corresponding technology', () => {
    expect(evaluateBusinessMatch(person('Scala、PySpark'), job('Scala、Spark')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('JavaScript'), job('Java')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('NoSQL'), job('SQL')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('C#'), job('C++')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('SpringBoot'), job('Spring Boot')).qualification.status).toBe('recommended')
  })
  it.each(['Java or Scala、Spark', 'JavaまたはScala、Spark', 'Java或Scala、Spark'])('honours alternatives without dropping the separate Spark requirement: %s', (requirement) => {
    expect(evaluateBusinessMatch(person('Java、Spark'), job(requirement)).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Scala、Spark'), job(requirement)).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Java'), job(requirement)).qualification.status).toBe('excluded')
  })
  it('preserves the scope of parenthesized alternatives and attached year counts', () => {
    expect(evaluateBusinessMatch(person('Java'), job('(Java or Scala) and Spark')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('Java、Spark'), job('(Java or Scala) and Spark')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('VC++ 4年'), job('VC++3年以上')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Java 4年'), job('Java3年以上')).qualification.status).toBe('recommended')
  })
  it('does not satisfy English by quoting Japanese or an unrelated technical skill', () => {
    const result = applyBusinessVerdict(person('Scala、Spark', { japanese_level: 'N1' }), job('英語、Scala、Spark'), { ...confident,
      met: [{ requirement: '英語', evidence: 'N1' }] })
    expect(result.qualification.status).toBe('needs-confirmation')
    expect(result.confirm).toContain('英語')
  })
  it('handles explicit one-of lists and keeps preferred skills from gating', () => {
    expect(evaluateBusinessMatch(person('Java'), job('Java、Scalaいずれか')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Java'), job('Java必須、Spark歓迎', { preferred_skills: 'Scala' })).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Scala'), job('Java必須、Spark歓迎')).qualification.status).toBe('excluded')
  })
  it.each(['Scala未経験', 'Scala経験なし', 'Scala学習中', '没有Scala经验', 'no Scala experience'])('does not treat negative or learning mentions as experience: %s', (skills) => {
    expect(evaluateBusinessMatch(person(skills), job('Scala')).qualification.status).toBe('excluded')
  })
  it('scans the entire career and finds evidence in project nine', () => {
    const projects = Array.from({ length: 8 }, () => project(['Java']))
    projects.push(project(['Scala', 'Spark']))
    const result = evaluateBusinessMatch(person('Java', {}, projects), job('Scala、Spark'))
    expect(result.qualification.status).toBe('recommended')
    expect(result.qualification.requirements.every((item) => item.source === 'データ処理基盤')).toBe(true)
  })
  it('checks skill-specific years, not total experience, and never double-counts overlapping projects', () => {
    expect(evaluateBusinessMatch(person('Scala', { experience_years: '19年' }), job('Scala 3年以上')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('Scala 4年'), job('Scala 3年以上')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Scala', {}, [project(['Scala'])]), job('Scala 3年以上')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Scala', {}, [project(['Scala'], '2025/01〜2025/12'), project(['Scala'], '2025/01〜2025/12')]), job('Scala 2年以上')).qualification.status).toBe('excluded')
  })
  it('separates a skills inventory from a request for actual practical experience', () => {
    expect(evaluateBusinessMatch(person('Scala'), job('Scala実務経験')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('Scala', {}, [project(['Scala'])]), job('Scala実務経験')).qualification.status).toBe('recommended')
  })
  it('excludes explicit work-style, availability, and affiliation conflicts', () => {
    expect(evaluateBusinessMatch(person('Scala、Spark', { work_style: 'フルリモート' }), job('Scala、Spark', { remote: '現場常駐' })).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('Scala、Spark', { availability: '2026-10-01' }), job('Scala、Spark', { start_date: '9月〜長期' })).qualification.status).toBe('excluded')
    for (const isOwnCompany of [null, false]) expect(evaluateBusinessMatch({ ...person('Scala、Spark'), isOwnCompany }, job('Scala、Spark', { contract_chain: '自社限定' })).qualification.status).toBe('excluded')
  })
  it('keeps unknown business conditions outside recommendations while retaining technical evidence', () => {
    const result = applyBusinessVerdict(person('Scala、Spark'), job('Scala、Spark', { japanese_level: 'N2以上' }), confident)
    expect(result.qualification.status).toBe('needs-confirmation')
    expect(result.confirm).toContain('N2以上')
    expect(evaluateBusinessMatch(person('Scala、Spark', { japanese_level: 'N1' }), job('Scala、Spark', { japanese_level: 'N2以上' })).qualification.status).toBe('recommended')
  })
  it('cannot use a cloud quotation to override an unknown Japanese hard filter embedded in skills', () => {
    const source = person('Scala、Spark', { japanese_level: '読む C / 会話 C' })
    const result = applyBusinessVerdict(source, job('Scala、Spark、日本語N2以上'), { ...confident,
      met: [{ requirement: '日本語N2以上', evidence: '読む C / 会話 C' }] })
    expect(result.qualification.status).toBe('needs-confirmation')
    expect(result.qualification.requirements.find((item) => item.requirement.label === '日本語N2以上')?.outcome).toBe('unknown')
  })
  it('does not invent a technical recommendation from an underspecified role-only case', () => {
    expect(evaluateBusinessMatch(person('SE'), job('SE')).qualification.status).toBe('excluded')
    expect(parseMatchRequirements(job('英語、Scala、Spark').fields).map((item) => item.category)).toEqual(['condition', 'core', 'core'])
  })
  it('requires a project quotation for specialized qualifiers instead of inferring them from the technology name', () => {
    const requirement = job('Scala性能チューニング経験')
    expect(evaluateBusinessMatch(person('Scala'), requirement).qualification.status).toBe('excluded')
    const source = person('Scala', {}, [project(['Scala'], undefined, 'Scalaジョブの性能分析とチューニングを担当')])
    expect(applyBusinessVerdict(source, requirement, { ...confident, met: [{ requirement: 'Scala性能チューニング経験', evidence: 'Scalaジョブの性能分析とチューニングを担当' }] }).qualification.status).toBe('recommended')
  })
  it('uses project evidence and preferred skills to rank only after mandatory coverage', () => {
    const requirement = job('Scala、Spark', { preferred_skills: 'AWS' })
    const bare = evaluateBusinessMatch(person('Scala、Spark'), requirement)
    const experienced = evaluateBusinessMatch(person('Scala、Spark、AWS', {}, [project(['Scala', 'Spark', 'AWS'])]), requirement)
    expect(experienced.qualification.status).toBe('recommended')
    expect(experienced.score).toBeGreaterThan(bare.score)
    expect(evaluateBusinessMatch(person('AWS'), requirement).qualification.status).toBe('excluded')
  })
})
