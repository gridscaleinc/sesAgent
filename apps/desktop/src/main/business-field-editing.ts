import { saveBusinessFieldInputSchema, type SaveBusinessFieldInput, type UpdateCandidateProfileInput } from '@shared'
import type { MainIpcContext } from './ipc/context'

export function saveBusinessField(context: Pick<MainIpcContext, 'repository' | 'currentOperator'>, raw: SaveBusinessFieldInput) {
  const input = saveBusinessFieldInputSchema.parse(raw)
  const { repository } = context
  const actor = context.currentOperator()
  if (input.kind === 'case') return repository.saveBusinessCaseField(input, actor.operatorId, actor.displayName)
  const profile = repository.getCurrentCandidateProfile(input.id)
  if (!profile) throw new Error('人员资料不存在或已归档。')
  const value = input.value?.trim() || null
  if (input.field === 'isOwnCompany' && !input.projectId) {
    const previous = profile.isOwnCompany == null ? null : String(profile.isOwnCompany)
    if (profile.profileVersion !== input.version && previous !== input.previousValue) throw new Error('所属已更新，请核对后重试。')
    if (value !== null && !['true','false'].includes(value)) throw new Error('无效的所属选项。')
    const saved = repository.setCandidateOwnCompany({ documentId: input.id, expectedVersion: profile.profileVersion, isOwnCompany: value === null ? null : value === 'true' }, actor.displayName)
    return { version: saved.profileVersion }
  }
  const update: UpdateCandidateProfileInput = { sourceDocumentId: input.id, expectedVersion: profile.profileVersion,
    identity: { ...profile.localPersonalDetails }, fields: profile.fields.map(({ key, value }) => ({ key, value })),
    projectExperiences: profile.projectExperiences.map((item) => ({ ...item })) }
  let previous: string | null | undefined
  if (input.projectId) {
    const review = repository.getCandidateReview(input.id)
    const canonicalIndex = update.projectExperiences.findIndex((item) => item.id === input.projectId)
    const index = canonicalIndex >= 0 ? canonicalIndex : review?.projectExperiences.findIndex((item) => item.draftId === input.projectId) ?? -1
    const project = update.projectExperiences[index]
    if (!project || !['title','period','role','technologies','summary'].includes(input.field)) throw new Error('项目经历已更新，请重新打开。')
    const key = input.field as 'title' | 'period' | 'role' | 'technologies' | 'summary'
    previous = key === 'technologies' ? project.technologies.join(', ') : project[key]
    if (key === 'technologies') project.technologies = (value ?? '').split(/[,，、;；\n]+/u).map((item) => item.trim()).filter(Boolean)
    else if (key === 'title' || key === 'summary') project[key] = value ?? ''
    else project[key] = value
  } else if (input.field.startsWith('identity.')) {
    const key = input.field.slice(9) as keyof UpdateCandidateProfileInput['identity']
    if (!Object.hasOwn(update.identity, key)) throw new Error('无效的人员信息字段。')
    previous = update.identity[key]
    update.identity[key] = value
  } else {
    const field = update.fields.find((item) => item.key === input.field)
    if (!field) throw new Error('无效的人员信息字段。')
    previous = field.value
    field.value = value
  }
  if (profile.profileVersion !== input.version && previous !== input.previousValue) throw new Error('这一项已被更新，输入内容已保留，请核对后重试。')
  if (previous === value) return { version: profile.profileVersion }
  const saved = repository.updateCandidateProfile(update, actor.operatorId, actor.displayName)
  return { version: saved.profileVersion }
}
