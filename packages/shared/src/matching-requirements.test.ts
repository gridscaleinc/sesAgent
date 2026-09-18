import { expect, it } from 'vitest'
import { matchEvidenceSections, matchFollowUpLabels, businessMatchingPolicyVersion, type BusinessMatchQualification, type MatchRequirementEvidence } from './matching-requirements'
const item = (id: string, label: string, key: string, outcome: MatchRequirementEvidence['outcome'], evidence: string | null = null): MatchRequirementEvidence => ({
  requirement: { id, label, key, category: key === 'required_skills' ? 'core' : 'condition', alternatives: key === 'required_skills' ? [[label]] : [], minimumYears: null, requiresPractice: false }, outcome, evidence, source: null
})
it('keeps each requirement in exactly one section and removes paraphrased confirmations of resolved facts', () => {
  const qualification: BusinessMatchQualification = { policyVersion: businessMatchingPolicyVersion, status: 'recommended', requirements: [
    item('1', 'Java', 'required_skills', 'met', 'Java'), item('2', 'Java', 'required_skills', 'unknown'),
    item('3', '日本語N1流暢', 'japanese_level', 'met', 'N1 会話流暢'), item('4', '週3出勤', 'remote', 'conflict', '在宅のみ'), item('5', '9月入場', 'start_date', 'unknown')
  ] }
  const questions = ['Java の実務経験を確認してください', '日本語を確認してください', '週3出勤できるか確認', '本人の希望を確認', ' 本人の希望を確認 ']
  const sections = matchEvidenceSections(qualification, questions)
  expect(sections.met.map(item => item.requirement.label)).toEqual(['Java', '日本語N1流暢'])
  expect(sections.corePending).toEqual([])
  expect(sections.conflicts).toEqual([])
  expect(sections.businessPending).toHaveLength(2)
  expect(sections.questions).toHaveLength(1)
  const labels = matchFollowUpLabels(qualification, questions)
  expect(labels).toHaveLength(3)
  expect(labels[0]).toContain('在宅のみ（条件有差异，需协商）')
  expect(labels.join(' ')).not.toMatch(/Java|日本語/)
})
it('never repeats a known technical shortfall under follow-up questions', () => {
  const qualification: BusinessMatchQualification = { policyVersion: businessMatchingPolicyVersion, status: 'excluded', requirements: [item('1', 'ASP.NET', 'required_skills', 'conflict')] }
  expect(matchFollowUpLabels(qualification, ['ASP.NET の実務経験を確認してください'])).toEqual([])
  expect(matchEvidenceSections(qualification).conflicts).toHaveLength(1)
})
