import { describe, expect, it } from 'vitest'
import { reviewMatchAssessmentEvidence } from './match-assessment-evidence'

describe('matching evidence consistency', () => {
  it('splits Java and SQL, refuses to prove SQL with Java, and withdraws conflicting conclusions', () => {
    const result = reviewMatchAssessmentEvidence({ fit: 'strong' as const,
      met: [{ requirement: 'Java, SQL', evidence: 'Java (◎)' }],
      gaps: ['Java, SQL'], confirm: [], reason: 'Both skills are satisfied.' })
    expect(result.corrected).toBe(true)
    expect(result.assessment).toEqual({ fit: 'insufficient-info', met: [{ requirement: 'Java', evidence: 'Java (◎)' }], gaps: [], confirm: ['SQL'], reason: '' })
  })
  it('does not treat JavaScript as evidence for Java', () => {
    expect(reviewMatchAssessmentEvidence({ fit: 'strong' as const, met: [{ requirement: 'Java', evidence: 'JavaScript 5年' }], gaps: [], confirm: [], reason: 'qualified' }).assessment)
      .toMatchObject({ fit: 'insufficient-info', met: [], confirm: ['Java'], reason: '' })
  })
  it('keeps C++, C# and multiword skills intact', () => {
    expect(reviewMatchAssessmentEvidence({ fit: 'possible' as const, met: [{ requirement: 'C++, C#, Spring Boot', evidence: 'C++ / C# / Spring Boot' }], gaps: [], confirm: [], reason: 'cited' }).assessment.met.map((item) => item.requirement))
      .toEqual(['C++', 'C#', 'Spring Boot'])
  })
  it('accepts PySpark for Spark but rejects negative technology mentions', () => {
    expect(reviewMatchAssessmentEvidence({ fit: 'strong' as const, met: [{ requirement: 'Spark', evidence: 'PySpark' }], gaps: [], confirm: [], reason: '' }).assessment.met).toHaveLength(1)
    expect(reviewMatchAssessmentEvidence({ fit: 'strong' as const, met: [{ requirement: 'Scala', evidence: 'Scala未経験' }], gaps: [], confirm: [], reason: '' }).assessment.met).toHaveLength(0)
  })
})
