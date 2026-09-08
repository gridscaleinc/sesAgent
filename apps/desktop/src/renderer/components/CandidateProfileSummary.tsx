import type { ReactNode } from 'react'
import type { CandidateReviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import './candidate-profile-summary.css'

export function CandidateProfileSummary({ review, collapseProjects = false, ownCompanyControl }: { review: CandidateReviewSnapshot; collapseProjects?: boolean; ownCompanyControl?: ReactNode }) {
  const zh = useUiLocale() === 'zh-CN'
  const skills = [...new Set((review.fields.find((field) => field.key === 'skills')?.value ?? '').split(/[,，、;；\n]+/u).map((skill) => skill.trim()).filter(Boolean))]
  const facts = review.fields.filter((field) => field.key !== 'skills')
  const projects = <div className="candidate-summary-projects">{review.projectExperiences.map((project) => <details key={project.draftId}><summary><strong>{project.title}</strong><small>{[project.period, project.role].filter(Boolean).join(' · ')}</small></summary><p>{project.summary}</p><div className="candidate-skill-tags">{project.technologies.map((technology, index) => <span key={`${technology}:${index}`}>{technology}</span>)}</div></details>)}</div>
  return <div className="candidate-profile-summary">
    <section><h3>{zh ? '基本条件' : '基本条件'}</h3><dl className="candidate-summary-facts"><div className={ownCompanyControl ? 'candidate-own-company-row' : undefined}><dt>{zh ? '是否自社' : '自社所属'}</dt><dd>{ownCompanyControl ?? (review.isOwnCompany === true ? '自社' : review.isOwnCompany === false ? '非自社' : (zh ? '未设置' : '未設定'))}</dd></div>{facts.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value || (zh ? '待补充' : '未記入')}</dd></div>)}</dl></section>
    <section><h3>{zh ? '技能' : 'スキル'} <small>{skills.length}</small></h3>
      <div className="candidate-skill-tags">{skills.slice(0, 8).map((skill) => <span key={skill}>{skill}</span>)}</div>
      {skills.length > 8 ? <details><summary>{zh ? `展开其余 ${skills.length - 8} 项技能` : `残りのスキルを表示 (${skills.length - 8})`}</summary><div className="candidate-skill-tags">{skills.slice(8).map((skill) => <span key={skill}>{skill}</span>)}</div></details> : null}
      {!skills.length ? <p>{zh ? '技能待补充' : 'スキル未記入'}</p> : null}
    </section>
    {review.projectExperiences.length ? <section>{collapseProjects ? <details className="candidate-projects-disclosure"><summary>{zh ? '项目经历' : 'プロジェクト経験'} <span>{review.projectExperiences.length}</span></summary>{projects}</details> : <><h3>{zh ? '项目经历' : 'プロジェクト経験'} <small>{review.projectExperiences.length}</small></h3>{projects}</>}</section> : null}
  </div>
}
