/** Customer-facing SES mail. Commercial facts always come from the person, never the case. */
type Field = { key: string; value: string | null }
type Project = { title: string; summary: string; technologies: string[] }
export type ProposalPerson = { documentId: string; fields: readonly Field[]; projectExperiences?: readonly Project[]; isOwnCompany?: boolean | null }
export type ProposalCase = { fields: readonly Field[]; redactedSubject?: string }

const categories = [
  ['言語', '语言', /^(?:Java|JavaScript|TypeScript|Python|HTML\d*|CSS\d*|VBA|VB(?:\.NET)?|C#|C\+\+|C|PHP|Ruby|Go|Kotlin|Swift|Scala|COBOL|SQL)$/iu],
  ['FW', '框架', /Spring|MyBatis|Hibernate|ASP\.NET|React|Vue|Angular|Django|Flask|Laravel|Rails|\.NET/iu],
  ['DB', '数据库', /Oracle|PostgreSQL|MySQL|SQL Server|DB2|MongoDB|Redis|MariaDB|SQLite/iu],
  ['環境', '环境', /Windows|Linux|Unix|Tomcat|Apache|Docker|Kubernetes|AWS|Azure|GCP|Mac/iu],
  ['ツール', '工具', /Eclipse|IntelliJ|VS Code|Visual Studio|Git|SVN|Jenkins|Maven|Gradle|Jira/iu]
] as const
const clean = (value: string) => value.replace(/[（(]\s*[◎○〇△×☆★]+\s*[）)]/gu, '').replace(/[◎○〇△×☆★]/gu, '').replace(/<(?:[A-Z_]+)_\d{3}>/gu, '').trim()
const unknown = /^(?:要確認|待确认|不明|未記載|未確認|なし|無|未設定|unknown|n\/a|-|—)$/iu
const field = (fields: readonly Field[], key: string) => { const value = clean(fields.find(f => f.key === key)?.value ?? ''); return unknown.test(value) ? '' : value }
const includesSkill = (text: string, skill: string) => {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'iu').test(text)
}
export function proposalJapaneseAbility(raw: string): string {
  // Preserve the grade's actual definition; never infer fluency from a letter or a certificate.
  return clean(raw).replace(/(読む|書く|会話)\s*[A-D]\s*[（(]([^）)]+)[）)]/gu, '$1：$2')
}

export function generatePersonnelProposal(person: ProposalPerson, job?: ProposalCase, lang: 'ja' | 'zh' = 'ja', brief = false) {
  const ja = lang === 'ja', t = (jp: string, cn: string) => ja ? jp : cn
  const placeholder = t('[送信前に記入]', '[发送前填写]')
  const id = person.documentId.slice(0, 8).toUpperCase()
  const title = job ? field(job.fields, 'title') || clean(job.redactedSubject ?? '') : ''
  const requirements = job?.fields.filter(f => ['required_skills', 'preferred_skills', 'role'].includes(f.key)).map(f => f.value ?? '').join('、') ?? ''
  const projects = person.projectExperiences ?? []
  const rawSkills = [field(person.fields, 'skills'), ...projects.flatMap(p => p.technologies)].join('、')
  const skills = [...new Set(rawSkills.split(/[、,，;；\n／/|]/u).map(clean).filter(s => s && s.length < 60 && !unknown.test(s)))]
  const relevant = (s: string) => includesSkill(`${title}、${requirements}`, s)
  skills.sort((a, b) => Number(relevant(b)) - Number(relevant(a)))
  const focus = skills.filter(relevant).slice(0, 3)
  // The browser shows no local match narrative: the cloud synthesizes technologies and responsibilities.
  const points: string[] = []
  const role = field(person.fields, 'role'), years = field(person.fields, 'experience_years'), availability = field(person.fields, 'availability')
  const experience = years ? /年|year/iu.test(years) ? years : `${years}${t('年', '年')}` : ''
  const subjectSkills = (focus.length ? focus : skills.slice(0, 2)).join('・')
  const subject = [t(`【要員提案${subjectSkills ? `／${subjectSkills}` : ''}】`, `【人员提案${subjectSkills ? `／${subjectSkills}` : ''}】`) + (role || ''), experience ? t(`経験${experience}`, `经验${experience}`) : '', availability, t(`要員ID：${id}`, `人员ID：${id}`)].filter(Boolean).join('／').slice(0, 240)
  const missingFields: string[] = []
  const item = (jp: string, cn: string, value: string) => {
    if (!value) missingFields.push(t(jp, cn))
    return `${t(jp, cn)}：${value || placeholder}`
  }
  const overview = [item('要員ID', '人员ID', id), item('職種', '职种', role), item('経験', '经验', experience)]
  const groups = categories.map(([, , pattern]) => skills.filter(s => pattern.test(s)).slice(0, brief ? 3 : 5))
  const primary = [...groups[0]!.filter(relevant), ...groups[1]!]
  const otherLanguages = groups[0]!.filter(s => !primary.includes(s))
  const skillLines = [primary, groups[2]!, otherLanguages, groups[3]!, groups[4]!].filter(group => group.length).map(group => group.join('、'))
  const stages = ['要件定義', '基本設計', '詳細設計', '製造', '単体テスト', '結合テスト', '障害調査', '改修'].filter(stage => projects.some(p => p.summary.includes(stage)))
  if (!skillLines.length && skills.length) skillLines.push(skills.slice(0, 6).join('、'))
  const text = [t('〇〇株式会社\n〇〇様', '〇〇公司\n〇〇先生／女士'), t('お世話になっております。', '您好，感谢一直以来的关照。'),
    title ? t(`「${title}」案件につきまして、\n下記要員をご提案いたします。`, `关于“${title}”案件，\n向您推荐以下人员。`) : t('下記要員をご紹介いたします。', '向您介绍以下人员。'),
    `${t('■要員概要', '■人员概要')}\n${overview.join('\n')}`,
    `${t('■主要スキル', '■主要技能')}\n${skillLines.join('\n') || placeholder}`,
    stages.length ? `${t('■対応工程', '■对应阶段')}\n${stages.join('、')}` : '',
    job ? t('■案件とのマッチポイント', '■与案件的匹配点') : '',
    t('詳細につきましては、スキルシートをご確認いただき、\n面談をご検討いただけましたら幸いです。', '详细经历请参阅技能简历，\n期待您考虑安排面试。'), t('何卒よろしくお願いいたします。', '谢谢，敬请考虑。')].filter(Boolean).join('\n\n')
  return { subject, text, missingFields, matchPoints: points }
}

export const personnelProposalInstructions = `Use the supplied customerMailTemplate as the mandatory structure for a concise customer-facing SES personnel proposal. Return the BODY only, without a subject or Markdown fences. Use the requested output language throughout, independently of the UI language and source language; translate Chinese project descriptions into natural Japanese for Japanese mail. Keep the overview to personnel ID, role and overall experience only. Do not add commercial fields or placeholders for affiliation, price, availability, location or parallel interviews. Keep main skills in compact technology groups, with no rating symbols or database field labels. Keep 対応工程 as its own short section.
The essential task is to synthesize 3–4 DISTINCT technical match points from job requirements + each project's technologies + responsibilities. Each point should explain a relevant technical capability, such as Java business-system development, Spring Boot/Spring/MyBatis development, existing-system enhancement and defect investigation/fixing, or Oracle/PostgreSQL/MySQL SQL and data investigation. Those are illustrative categories, NOT facts to invent. Mention the actual language/framework/database where supported by the same project's metadata and responsibilities. Summarize across relevant projects; do NOT dump project names and raw task quotations such as 在…项目中的实际职责 or …での担当内容. Do NOT produce several repeated test-execution bullets. A project technology list may contextualize its actual testing work, but testing alone does not prove design or implementation ownership. If the source only supports testing, say so honestly rather than implying development. A bare global skill token supports only a listed skill, not delivery experience. Use fewer points when necessary, never fabricate experience or durations. Overall career years must not become years in Java or Spring Boot. Output polished, natural customer-facing sentences, not an internal evidence report. Do not output 要確認, internal pending conditions or rating marks ◎○△. Preserve original facts and language proficiency; learned writing rules cannot override this format.`
