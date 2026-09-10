import type { AgentCandidateDraftFacts, ResumeAnalysisSummary } from '@shared'

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(1, maximum - 1))}…`
}

/**
 * Converts the committed local analysis into the only resume representation a
 * Sales Agent conversation may persist or project to Cloud AI. Direct identity,
 * the original file name and local document identifiers are excluded upstream
 * when the conversation projection is serialized.
 */
export function agentDraftFactsFromResumeAnalysis(
  analysis: ResumeAnalysisSummary,
  label: string
): AgentCandidateDraftFacts {
  return {
    documentId: analysis.fileToken,
    label: bounded(label, 60),
    confirmed: false,
    reviewStatus: 'awaiting-review',
    fields: analysis.extractedFields.slice(0, 20).map((field) => ({
      label: bounded(field.label, 80),
      value: field.value === null ? null : bounded(field.value, 600),
      confidence: field.confidence,
      status: field.status,
      sources: [...new Set(field.sourceLabels)].slice(0, 12).map((source) => bounded(source, 180))
    })),
    projects: (analysis.extractedProjectExperiences ?? []).slice(0, 30).map((project) => ({
      title: bounded(project.title, 300),
      period: project.period === null ? null : bounded(project.period, 120),
      role: project.role === null ? null : bounded(project.role, 180),
      technologies: project.technologies.slice(0, 40).map((technology) => bounded(technology, 120)),
      summary: bounded(project.summary, 2_000),
      confidence: project.confidence,
      sources: [...new Set(project.sourceLabels)].slice(0, 12).map((source) => bounded(source, 180))
    }))
  }
}
