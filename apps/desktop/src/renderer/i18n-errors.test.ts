import { describe, expect, it } from 'vitest'
import { aiServiceProblem, localizedIpcError } from './i18n'

const ipc = (message: string) => new Error(`Error invoking remote method 'broadcast:prepare-case-introduction': Error: ${message}`)
const bilingual =
  '案件字段含有个人信息，无法确认：必須スキル（person_name）。请在案件详情中删除这些内容后重试。 / 案件フィールドに直接識別子を保存できません: 必須スキル（person_name）'

describe('localizedIpcError', () => {
  it('shows the half of a "中文 / 日本語" message that matches the display language instead of hiding the reason', () => {
    expect(localizedIpcError('zh-CN', ipc(bilingual), '案件介绍准备失败，请重试。')).toBe(
      '案件字段含有个人信息，无法确认：必須スキル（person_name）。请在案件详情中删除这些内容后重试。'
    )
    expect(localizedIpcError('ja-JP', ipc(bilingual), '案件紹介を準備できませんでした。')).toBe(
      '案件フィールドに直接識別子を保存できません: 必須スキル（person_name）'
    )
  })

  it('does not split ordinary slashes in a Japanese message', () => {
    expect(localizedIpcError('ja-JP', ipc('Java / Spring Bootの案件が見つかりません。'), 'fallback')).toBe(
      'Java / Spring Bootの案件が見つかりません。'
    )
    expect(localizedIpcError('zh-CN', ipc('Java / Spring Bootの案件が見つかりません。'), '失败')).toBe('失败')
  })

  it('still replaces schema and transport diagnostics with the fallback', () => {
    expect(localizedIpcError('zh-CN', ipc('[{"code":"invalid_type"}]'), '操作失败')).toBe('操作失败')
    expect(localizedIpcError('ja-JP', ipc('SqliteError: constraint failed'), '失敗しました')).toBe('失敗しました')
  })

  it('turns known AI member service failures into what happened and what to do', () => {
    const signIn = ipc('AiCommerceRequestError: Please sign in to Member Center first.')
    expect(aiServiceProblem(signIn)).toBe('sign-in')
    expect(localizedIpcError('zh-CN', signIn, '生成失败')).toBe('AI 未登录，请先登录 AI 会员后重试。')
    expect(localizedIpcError('ja-JP', signIn, '失敗')).not.toMatch(/AiCommerceRequestError|sign in/u)
    expect(aiServiceProblem(ipc('AiCommerceRequestError: The AI service could not be reached.'))).toBe('network')
    expect(aiServiceProblem(ipc('AiCommerceRequestError: There are not enough available AI credits.'))).toBe('quota')
    expect(aiServiceProblem(ipc('AiCommerceRequestError: The AI request timed out. Please retry the same action.'))).toBe('timeout')
    expect(aiServiceProblem(ipc('Gmail session expired'))).toBeNull()
  })
})
