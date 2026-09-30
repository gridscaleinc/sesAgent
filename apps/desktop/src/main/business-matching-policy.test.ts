import { describe, expect, it } from 'vitest'
import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import { parseMatchRequirements } from '@shared'
import { applyBusinessVerdict, evaluateBusinessMatch } from './business-matching-policy'

const person = (
  skills: string,
  extra: Record<string, string> = {},
  projects: CandidateProfile['projectExperiences'] = []
): CandidateProfile =>
  ({
    fields: Object.entries({ skills, ...extra }).map(([key, value]) => ({ key, label: key, value, sourceLabels: [] })),
    projectExperiences: projects
  }) as unknown as CandidateProfile
const job = (skills: string, extra: Record<string, string> = {}): ConfirmedJobCase =>
  ({
    fields: Object.entries({ required_skills: skills, ...extra }).map(([key, value]) => ({ key, label: key, value, sourceLabels: [] }))
  }) as unknown as ConfirmedJobCase
const project = (
  technologies: string[],
  period = '2020年01月〜2023年12月',
  summary = '開発・運用を担当'
): CandidateProfile['projectExperiences'][number] =>
  ({
    id: 'project',
    title: 'データ処理基盤',
    technologies,
    period,
    role: 'SE',
    summary
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
    expect(result.fit).toBe('weak')
  })
  it('rejects invented and unrelated cloud quotations even if every mandatory label is returned', () => {
    const result = applyBusinessVerdict(person('Java'), job('Scala、Spark'), {
      ...confident,
      requirements: [
        { requirement: 'Scala', outcome: 'met', evidence: 'Java' },
        { requirement: 'Spark', outcome: 'met', evidence: 'Spark development' }
      ]
    })
    expect(result.qualification.status).toBe('excluded')
  })
  it('allows directional aliases only for the corresponding technology', () => {
    expect(evaluateBusinessMatch(person('Scala、PySpark'), job('Scala、Spark')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('JavaScript'), job('Java')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('NoSQL'), job('SQL')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('C#'), job('C++')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('SpringBoot'), job('Spring Boot')).qualification.status).toBe('recommended')
  })
  it.each(['Java or Scala、Spark', 'JavaまたはScala、Spark', 'Java或Scala、Spark'])(
    'honours alternatives without dropping the separate Spark requirement: %s',
    (requirement) => {
      expect(evaluateBusinessMatch(person('Java、Spark'), job(requirement)).qualification.status).toBe('recommended')
      expect(evaluateBusinessMatch(person('Scala、Spark'), job(requirement)).qualification.status).toBe('recommended')
      expect(evaluateBusinessMatch(person('Java'), job(requirement)).qualification.status).toBe('excluded')
    }
  )
  it('preserves the scope of parenthesized alternatives and attached year counts', () => {
    expect(evaluateBusinessMatch(person('Java'), job('(Java or Scala) and Spark')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('Java、Spark'), job('(Java or Scala) and Spark')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('VC++ 4年'), job('VC++3年以上')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Java 4年'), job('Java3年以上')).qualification.status).toBe('recommended')
  })
  it('reads skill years from a job title that names the skill plus total experience (the 田中 resume)', () => {
    const tanaka = person('Java, Spring Boot, REST API, MySQL, 決済', { role: 'Java バックエンドエンジニア', experience_years: '5年' })
    expect(evaluateBusinessMatch(tanaka, job('Java 5年以上、Spring Boot')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(tanaka, job('Java 3年以上、Spring Boot')).qualification.status).toBe('recommended')
    // AWS is not in the resume at all, so that case stays excluded for the missing skill only.
    const aws = evaluateBusinessMatch(tanaka, job('Java 5年以上、Spring Boot、AWS'))
    expect(aws.qualification.status).toBe('excluded')
    expect(aws.qualification.requirements.find((item) => item.requirement.label.startsWith('Java'))).toMatchObject({
      outcome: 'met',
      evidence: expect.stringContaining('Java バックエンドエンジニア · 5年')
    })
    // Six years asked, five on record: not enough, as before.
    expect(evaluateBusinessMatch(tanaka, job('Java 6年以上、Spring Boot')).qualification.status).toBe('excluded')
  })
  it('credits total experience only to a skill the job title names', () => {
    const generalist = person('Java, PHP', { role: 'Web エンジニア', experience_years: '8年' })
    const result = evaluateBusinessMatch(generalist, job('Java 5年以上'))
    expect(result.qualification.status).toBe('recommended')
    // Not proven by the title, so HR still confirms the Java years.
    expect(result.qualification.requirements[0]).toMatchObject({ outcome: 'met', yearsUnconfirmed: true })
    expect(
      evaluateBusinessMatch(person('PHP', { role: 'Web エンジニア', experience_years: '8年' }), job('Java 5年以上')).qualification.status
    ).toBe('excluded')
  })

  it('does not satisfy English by quoting Japanese or an unrelated technical skill', () => {
    const result = applyBusinessVerdict(person('Scala、Spark', { japanese_level: 'N1' }), job('英語、Scala、Spark'), {
      ...confident,
      met: [{ requirement: '英語', evidence: 'N1' }]
    })
    expect(result.qualification.status).toBe('needs-confirmation')
    expect(result.confirm).toContain('英語')
  })
  it('handles explicit one-of lists and keeps preferred skills from gating', () => {
    expect(evaluateBusinessMatch(person('Java'), job('Java、Scalaいずれか')).qualification.status).toBe('recommended')
    expect(evaluateBusinessMatch(person('Java'), job('Java必須、Spark歓迎', { preferred_skills: 'Scala' })).qualification.status).toBe(
      'recommended'
    )
    expect(evaluateBusinessMatch(person('Scala'), job('Java必須、Spark歓迎')).qualification.status).toBe('excluded')
  })
  it.each(['Scala未経験', 'Scala経験なし', 'Scala学習中', '没有Scala经验', 'no Scala experience'])(
    'does not treat negative or learning mentions as experience: %s',
    (skills) => {
      expect(evaluateBusinessMatch(person(skills), job('Scala')).qualification.status).toBe('excluded')
    }
  )
  it('scans the entire career and finds evidence in project nine', () => {
    const projects = Array.from({ length: 8 }, () => project(['Java']))
    projects.push(project(['Scala', 'Spark']))
    const result = evaluateBusinessMatch(person('Java', {}, projects), job('Scala、Spark'))
    expect(result.qualification.status).toBe('recommended')
    expect(result.qualification.requirements.every((item) => item.source === 'データ処理基盤')).toBe(true)
  })
  it('passes a listed skill whose years are not written, and rejects only a written shortfall', () => {
    const java = (outcome: ReturnType<typeof evaluateBusinessMatch>) =>
      outcome.qualification.requirements.find((item) => item.requirement.label.startsWith('Scala'))
    // Skill listed, no years stated for it: passes, flagged for HR to confirm the years.
    const unstated = evaluateBusinessMatch(person('Scala', { experience_years: '19年' }), job('Scala 3年以上'))
    expect(unstated.qualification.status).toBe('recommended')
    expect(java(unstated)).toMatchObject({ outcome: 'met', yearsUnconfirmed: true })
    expect(evaluateBusinessMatch(person('Scala'), job('Scala 3年以上')).qualification.status).toBe('recommended')
    // Written years for the skill, or a whole career shorter than asked, are a real shortfall.
    expect(evaluateBusinessMatch(person('Scala 2年'), job('Scala 3年以上')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('Scala', { experience_years: '2年' }), job('Scala 3年以上')).qualification.status).toBe('excluded')
    // Proven years are not flagged.
    const stated = evaluateBusinessMatch(person('Scala 4年'), job('Scala 3年以上'))
    expect(stated.qualification.status).toBe('recommended')
    expect(java(stated)?.yearsUnconfirmed).toBeUndefined()
    expect(java(evaluateBusinessMatch(person('Scala', {}, [project(['Scala'])]), job('Scala 3年以上')))?.yearsUnconfirmed).toBeUndefined()
    // Overlapping projects count once: one year of dated work does not prove two years, so the years stay unconfirmed.
    const overlapping = evaluateBusinessMatch(
      person('Scala', { experience_years: '5年' }, [project(['Scala'], '2025/01〜2025/12'), project(['Scala'], '2025/01〜2025/12')]),
      job('Scala 2年以上')
    )
    expect(java(overlapping)).toMatchObject({ outcome: 'met', yearsUnconfirmed: true })
  })
  it('separates a skills inventory from a request for actual practical experience', () => {
    expect(evaluateBusinessMatch(person('Scala'), job('Scala実務経験')).qualification.status).toBe('excluded')
    expect(evaluateBusinessMatch(person('Scala', {}, [project(['Scala'])]), job('Scala実務経験')).qualification.status).toBe('recommended')
  })
  it('keeps commercial conflicts and scheduling separate from professional suitability', () => {
    expect(
      evaluateBusinessMatch(person('Scala、Spark', { work_style: 'フルリモート' }), job('Scala、Spark', { remote: '現場常駐' }))
        .qualification.status
    ).toBe('recommended')
    expect(
      evaluateBusinessMatch(person('Scala、Spark', { availability: '2026-10-01' }), job('Scala、Spark', { start_date: '9月〜長期' }))
        .qualification.status
    ).toBe('recommended')
    for (const isOwnCompany of [null, false])
      expect(
        evaluateBusinessMatch({ ...person('Scala、Spark'), isOwnCompany }, job('Scala、Spark', { contract_chain: '自社限定' }))
          .qualification.status
      ).toBe('recommended')
  })
  it('keeps unknown business conditions outside recommendations while retaining technical evidence', () => {
    const result = applyBusinessVerdict(person('Scala、Spark'), job('Scala、Spark', { japanese_level: 'N2以上' }), confident)
    expect(result.qualification.status).toBe('needs-confirmation')
    expect(result.confirm).toContain('N2以上')
    expect(
      evaluateBusinessMatch(person('Scala、Spark', { japanese_level: 'N1' }), job('Scala、Spark', { japanese_level: 'N2以上' }))
        .qualification.status
    ).toBe('recommended')
  })
  it('cannot use a cloud quotation to override an unknown Japanese hard filter embedded in skills', () => {
    const source = person('Scala、Spark', { japanese_level: '読む C / 会話 C' })
    const result = applyBusinessVerdict(source, job('Scala、Spark、日本語N2以上'), {
      ...confident,
      met: [{ requirement: '日本語N2以上', evidence: '読む C / 会話 C' }]
    })
    expect(result.qualification.status).toBe('needs-confirmation')
    expect(result.qualification.requirements.find((item) => item.requirement.label === '日本語N2以上')?.outcome).toBe('unknown')
  })
  it('does not invent a technical recommendation from an underspecified role-only case', () => {
    expect(evaluateBusinessMatch(person('SE'), job('SE')).qualification.status).toBe('needs-confirmation')
    expect(parseMatchRequirements(job('英語、Scala、Spark').fields).map((item) => item.category)).toEqual(['condition', 'core', 'core'])
  })
  it('requires a project quotation for specialized qualifiers instead of inferring them from the technology name', () => {
    const requirement = job('Scala性能チューニング経験')
    expect(evaluateBusinessMatch(person('Scala'), requirement).qualification.status).toBe('excluded')
    const source = person('Scala', {}, [project(['Scala'], undefined, 'Scalaジョブの性能分析とチューニングを担当')])
    const settled = applyBusinessVerdict(source, requirement, {
      ...confident,
      met: [{ requirement: 'Scala性能チューニング経験', evidence: 'Scalaジョブの性能分析とチューニングを担当' }]
    })
    expect(settled.qualification.status).toBe('recommended')
    // The AI's quote settled it, and the card can say so.
    expect(settled.qualification.requirements[0]).toMatchObject({ outcome: 'met', aiVerified: true, source: 'データ処理基盤' })
    expect(evaluateBusinessMatch(source, requirement).qualification.requirements[0]?.aiVerified).toBeUndefined()
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

it('gives the reported case a direct rejection with language evidence, not a list of missing facts', () => {
  const source = person('Java、Spring Boot', {
    role: 'SE',
    japanese_level: '読む C（ゆっくり対応可） / 書く B（スムーズ対応可） / 会話 C（ゆっくり対応可）'
  })
  const target = job('SE、C#（ASP.NET）、基本設計～、AI', { remote: '週3出勤', start_date: '9月～長期', japanese_level: '日本語N1流暢' })
  const result = applyBusinessVerdict(source, target, {
    ...confident,
    fit: 'insufficient-info',
    confirm: ['C#（ASP.NET）の実務経験を確認してください', '週3出勤', '9月～長期']
  })
  expect(result.fit).toBe('weak')
  expect(result.qualification.status).toBe('excluded')
  expect(result.qualification.requirements.filter((r) => r.requirement.category === 'core').every((r) => r.outcome === 'conflict')).toBe(
    true
  )
  expect(result.qualification.requirements.find((r) => r.requirement.key === 'japanese_level')).toMatchObject({
    outcome: 'conflict',
    evidence: source.fields.find((f) => f.key === 'japanese_level')!.value
  })
  expect(
    result.qualification.requirements
      .filter((r) => ['start_date', 'remote'].includes(r.requirement.key))
      .every((r) => r.outcome === 'unknown')
  ).toBe(true)
  expect(result.hardFilters.some((f) => f.type === 'availability-by')).toBe(false)
  expect(result.confirm).toEqual(['週3出勤', '9月～長期'])
})
it.each(['週3出勤', '週3日出社', '常駐'])('retains %s for negotiation without excluding technical matches', (remote) => {
  expect(evaluateBusinessMatch(person('Java'), job('Java', { remote, start_date: '9月～長期' })).qualification.status).toBe('recommended')
  expect(evaluateBusinessMatch(person('Java', { work_style: '只接受在宅' }), job('Java', { remote })).qualification.status).toBe(
    'recommended'
  )
  expect(evaluateBusinessMatch(person('Java', { work_style: '出社可' }), job('Java', { remote })).qualification.status).toBe('recommended')
})
it('preserves technical aliases and does not reject documented project experience', () => {
  const result = applyBusinessVerdict(
    person('Java', {}, [project(['C#', 'ASP.NET'], undefined, 'C#（ASP.NET）基本設計、AI開発を担当')]),
    job('C#（ASP.NET）、基本設計～、AI'),
    { ...confident, met: [], confirm: ['9月入場', '出社可否'] }
  )
  expect(result.qualification.status).toBe('recommended')
  expect(result.confirm).toEqual([])
})

it.each(['フルリモート希望', 'リモート希望', '週3日まで出社'])(
  'does not turn a compatible preference into an exclusion: %s',
  (work_style) => {
    expect(evaluateBusinessMatch(person('Java', { work_style }), job('Java', { remote: '週3出勤' })).qualification.status).toBe(
      'recommended'
    )
  }
)
it.each(['在宅のみ', '出社不可', '週2日まで出社', '出社は週2日まで'])(
  'shows an explicit commercial conflict without changing proposal fit: %s',
  (work_style) => {
    const result = evaluateBusinessMatch(person('Java', { work_style }), job('Java', { remote: '週3出勤' }))
    expect(result.qualification.status).toBe('recommended')
    expect(result.hardFilters.find((f) => f.type === 'remote-work')).toMatchObject({ actual: work_style, outcome: 'failed' })
  }
)

it('does not invent an onsite frequency when the case only says attendance is required', () => {
  expect(
    evaluateBusinessMatch(person('Java', { work_style: '週2日まで出社' }), job('Java', { remote: '出社必須' })).qualification.status
  ).toBe('recommended')
  expect(
    evaluateBusinessMatch(person('Java', { work_style: '週2日まで出社' }), job('Java', { remote: '出社週3日' })).qualification.status
  ).toBe('recommended')
})

it('recommends technical and language matches with unknown or conflicting commercial conditions', () => {
  const result = applyBusinessVerdict(
    person('C#、ASP.NET、基本設計、AI', {
      japanese_level: 'N1・日本語で顧客会議を進行、会話流暢',
      rate: '100万円',
      work_style: '在宅のみ',
      location: '大阪'
    }),
    job('C#（ASP.NET）、基本設計～、AI', {
      japanese_level: '日本語N1流暢',
      rate: '70万円以下',
      remote: '週3出勤',
      location: '東京',
      start_date: '9月～長期'
    }),
    { ...confident, fit: 'weak', confirm: ['日本語N1流暢を確認', 'C#（ASP.NET）の実務経験を確認してください'] }
  )
  expect(result.qualification.status).toBe('recommended')
  expect(result.fit).toBe('strong')
  expect(result.reviewable).toBe(true)
  expect(result.confirm.join(' ')).toContain('需协商')
  expect(result.confirm.join(' ')).toContain('9月～長期')
  expect(result.confirm.join(' ')).not.toMatch(/N1|ASP.NET/)
})
it.each([
  ['N1・会話流暢', '日本語N1流暢', 'met'],
  ['日本語ビジネスレベル、会話流暢', '日本語N1流暢', 'met'],
  ['日本語ビジネスレベル、会話流暢', 'N1合格証明必須', 'unknown'],
  ['N1合格', '日本語N1流暢', 'unknown'],
  ['読む A（現地人と同じレベル） / 会話 C（ゆっくり対応可）', '日本語N1流暢', 'conflict'],
  ['書く B（スムーズ対応可） / 会話 C', '日本語N1流暢', 'unknown'],
  ['N1勉強中', 'N1以上', 'unknown'],
  ['N1を勉強中', 'N1合格必須', 'unknown'],
  ['N1相当・会話流暢', 'N1合格証明必須', 'unknown'],
  ['N3・日常会話', 'N2以上', 'conflict']
])('compares language facts without inventing a certificate: %s / %s', (actual, requested, outcome) => {
  const result = evaluateBusinessMatch(person('Java', { japanese_level: actual }), job('Java', { japanese_level: requested }))
  expect(result.qualification.requirements.find((item) => item.requirement.key === 'japanese_level')).toMatchObject({
    outcome,
    evidence: actual
  })
})
it('finds Japanese work communication in project evidence even when the structured language field is absent', () => {
  const result = evaluateBusinessMatch(
    person('Java', {}, [project(['Java'], undefined, '日本語で顧客会議を進行、会話流暢')]),
    job('Java', { japanese_level: '日本語N1流暢' })
  )
  expect(result.qualification.status).toBe('recommended')
  expect(result.qualification.requirements.find((item) => item.requirement.key === 'japanese_level')).toMatchObject({
    outcome: 'met',
    source: 'データ処理基盤'
  })
  expect(result.hardFilters.find((filter) => filter.type === 'japanese-level')?.outcome).toBe('passed')
})
it('does not turn an empty extraction into a technical rejection', () => {
  expect(evaluateBusinessMatch(person(''), job('Java')).qualification.status).toBe('needs-confirmation')
})
