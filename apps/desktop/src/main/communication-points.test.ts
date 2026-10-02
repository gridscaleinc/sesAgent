import { describe, expect, it } from 'vitest'
import {
  buildCommunicationPointsProjection,
  communicationPointsInstructions,
  parseCommunicationPointsResponse
} from './agent-cloud-narrative'

const input = {
  locale: 'zh-CN' as const,
  person: {
    facts: [{ label: '稼働開始', value: '2026年11月〜' }],
    projects: [{ title: '決済基盤刷新', period: '2024', role: 'SE', technologies: ['Java'], summary: 'Spring Boot で決済 API を設計' }]
  },
  jobCase: { title: '損保案件', fields: [{ label: '勤務形態', value: '週3出社' }], body: '詳細は面談にて' },
  openRequirements: [{ label: '基本設計の経験', outcome: 'unknown' as const }],
  alreadyListed: ['能否接受每周两天出社？']
}

describe('沟通要点', () => {
  it('sends the open requirements, what HR already asks and the request, and quotes only what the model saw', () => {
    const built = buildCommunicationPointsProjection({ ...input, operatorRequest: ' 重点看 入场时间 ' })
    const projection = JSON.parse(built.projection)
    expect(projection.version).toBe('communication-points-v1')
    expect(projection.openRequirements).toEqual([{ label: '基本設計の経験', outcome: 'unknown' }])
    expect(projection.alreadyListed).toEqual(['能否接受每周两天出社？'])
    expect(projection.operatorRequest).toBe('重点看 入场时间')
    expect(built.material).toEqual(expect.arrayContaining(['2026年11月〜', '週3出社', '詳細は面談にて', 'Spring Boot で決済 API を設計']))
    expect(communicationPointsInstructions('zh-CN')).toContain('Do not repeat alreadyListed')
    expect(communicationPointsInstructions('ja-JP')).toContain('Japanese')
  })

  it('keeps well-formed questions, drops a source that is not verbatim and rejects malformed answers', () => {
    const { material } = buildCommunicationPointsProjection(input)
    const points = parseCommunicationPointsResponse(
      JSON.stringify({
        points: [
          { question: '最早什么时候可以入场？', audience: 'person', reason: '资料写 11 月起。', source: '2026年11月〜' },
          { question: '每周几天出社？', audience: 'client', reason: '案件只写了出社。', source: '週5出社' },
          { question: '最早什么时候可以入场？', audience: 'person', reason: '重复', source: null },
          { question: '没有对象', audience: 'manager', reason: '无效', source: null },
          { question: 'x'.repeat(200), audience: 'person', reason: '过长', source: null }
        ]
      }),
      material
    )
    expect(points).toEqual([
      { question: '最早什么时候可以入场？', audience: 'person', reason: '资料写 11 月起。', source: '2026年11月〜' },
      { question: '每周几天出社？', audience: 'client', reason: '案件只写了出社。', source: null }
    ])
    expect(() => parseCommunicationPointsResponse('not json', material)).toThrow('Invalid communication points JSON')
    expect(() => parseCommunicationPointsResponse('{"items":[]}', material)).toThrow('protocol')
  })

  it('drops the case text before the open items when everything does not fit', () => {
    const long = {
      ...input,
      person: {
        facts: [],
        projects: Array.from({ length: 30 }, (_, index) => ({
          title: `案件${index + 1}`,
          period: '2020',
          role: 'SE',
          technologies: ['Java'],
          summary: '設計'.repeat(400)
        }))
      },
      jobCase: { ...input.jobCase, body: '本文'.repeat(5000) },
      alreadyListed: Array.from({ length: 15 }, (_, index) => `问题${index}`.repeat(30))
    }
    const built = buildCommunicationPointsProjection(long)
    expect(built.projection.length).toBeLessThanOrEqual(20_000)
    expect(JSON.parse(built.projection).alreadyListed).toHaveLength(15)
  })
})
