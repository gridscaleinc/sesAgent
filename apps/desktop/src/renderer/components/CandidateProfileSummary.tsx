import { BusinessField } from './BusinessField'
import type { ReactNode } from 'react'
import type { CandidateReviewSnapshot } from '@shared'
import { localeText, useUiLocale, localizedCandidateFieldLabel } from '../i18n'
import './candidate-profile-summary.css'

export function CandidateProfileSummary({
  review,
  collapseProjects = false,
  ownCompanyControl
}: {
  review: CandidateReviewSnapshot
  collapseProjects?: boolean
  ownCompanyControl?: ReactNode
}) {
  const edit = (field: string, value: string | null, label: string, projectId?: string) => (
    <BusinessField
      kind="person"
      id={review.documentId}
      version={review.profile?.version ?? 1}
      field={field}
      value={value}
      label={label}
      projectId={projectId}
      disabled={!review.profile || review.recordStatus !== 'active'}
    />
  )
  const zh = useUiLocale() === 'zh-CN'
  const t = localeText(zh)
  const skills = [
    ...new Set(
      (review.fields.find((field) => field.key === 'skills')?.value ?? '')
        .split(/[,，、;；\n]+/u)
        .map((skill) => skill.trim())
        .filter(Boolean)
    )
  ]
  const facts = review.fields.filter((field) => field.key !== 'skills')
  const projects = (
    <div className="candidate-summary-projects">
      {review.projectExperiences.map((project) => (
        <details key={project.draftId}>
          <summary>
            <strong>{project.title}</strong>
            <small>{[project.period, project.role].filter(Boolean).join(' · ')}</small>
          </summary>
          <dl className="candidate-summary-facts">
            {(['title', 'period', 'role', 'summary', 'technologies'] as const).map((field) => (
              <div key={field}>
                <dt>
                  {
                    {
                      title: t('项目名称', '案件名'),
                      period: t('期间', '期間'),
                      role: t('角色', '役割'),
                      summary: t('项目内容', '業務内容'),
                      technologies: t('技术', '技術')
                    }[field]
                  }
                </dt>
                <dd>
                  {edit(
                    field,
                    field === 'technologies' ? project.technologies.join(', ') : project[field],
                    {
                      title: t('项目名称', '案件名'),
                      period: t('期间', '期間'),
                      role: t('角色', '役割'),
                      summary: t('项目内容', '業務内容'),
                      technologies: t('技术', '技術')
                    }[field],
                    project.draftId
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </div>
  )
  return (
    <div className="candidate-profile-summary">
      <section>
        <h3>{t('基本条件', '基本条件')}</h3>
        <dl className="candidate-summary-facts">
          <div className={ownCompanyControl ? 'candidate-own-company-row' : undefined}>
            <dt>{t('是否自社', '自社所属')}</dt>
            <dd>
              {ownCompanyControl ??
                edit('isOwnCompany', review.isOwnCompany == null ? null : String(review.isOwnCompany), t('是否自社', '自社所属'))}
            </dd>
          </div>
          {facts.map((field) => (
            <div key={field.key}>
              <dt>{localizedCandidateFieldLabel(zh ? 'zh-CN' : 'ja-JP', field)}</dt>
              <dd>{edit(field.key, field.value, localizedCandidateFieldLabel(zh ? 'zh-CN' : 'ja-JP', field))}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>
          {t('技能', 'スキル')} <small>{skills.length}</small>
        </h3>
        {edit('skills', review.fields.find((field) => field.key === 'skills')?.value ?? null, t('技能', 'スキル'))}
      </section>
      {review.projectExperiences.length ? (
        <section>
          {collapseProjects ? (
            <details className="candidate-projects-disclosure">
              <summary>
                {t('项目经历', 'プロジェクト経験')} <span>{review.projectExperiences.length}</span>
              </summary>
              {projects}
            </details>
          ) : (
            <>
              <h3>
                {t('项目经历', 'プロジェクト経験')} <small>{review.projectExperiences.length}</small>
              </h3>
              {projects}
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
