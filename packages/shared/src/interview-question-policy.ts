export const interviewQuestionDimensions = [
  'authenticity',
  'core-capability',
  'problem-solving',
  'ownership-collaboration',
  'case-readiness',
  'open-topic'
] as const
export type InterviewQuestionDimension = (typeof interviewQuestionDimensions)[number]

export const interviewDimensionLabels = {
  authenticity: { zh: '履历真实性与深度', ja: '経歴の実態と深さ' },
  'core-capability': { zh: '端到端交付能力', ja: 'エンドツーエンドの完遂力' },
  'problem-solving': { zh: '问题解决能力', ja: '問題解決力' },
  'ownership-collaboration': { zh: '独立推进与协作能力', ja: '自走と協働の力' },
  'case-readiness': { zh: '项目适应与快速上手能力', ja: '案件適応と立ち上がりの速さ' },
  'open-topic': { zh: '开放话题（面试官追加）', ja: '自由テーマ（面接官の追加）' }
} as const

export const interviewAskTypes = [
  'role-scope',
  'design-decision',
  'end-to-end',
  'deliverable-quality',
  'incident-chain',
  'change-response',
  'coordination',
  'ambiguity-handling',
  'experience-transfer',
  'onboarding',
  'gap-closing',
  'open-topic'
] as const
export type InterviewAskType = (typeof interviewAskTypes)[number]
/** Each dimension owns its ask shapes, so two dimensions can never produce the same kind of question. */
export const interviewDimensionAsks: Record<(typeof interviewQuestionDimensions)[number], readonly InterviewAskType[]> = {
  authenticity: ['role-scope', 'design-decision'],
  'core-capability': ['end-to-end', 'deliverable-quality'],
  'problem-solving': ['incident-chain', 'change-response'],
  'ownership-collaboration': ['coordination', 'ambiguity-handling'],
  'case-readiness': ['experience-transfer', 'onboarding', 'gap-closing'],
  'open-topic': ['open-topic']
}

/** Shared by case questions, writing methods and the conversational interview assistant. */
export const interviewQuestionPolicy = `Interview preparation v3 — classify first, then ask. The chain to verify: is the experience real → is the core capability sufficient → can they handle problems → how independently can they work → can they start on THIS case now.
STEP 1 CLASSIFY: read the case requirements and this person's resume facts/projects and sort what they actually contain into the five dimensions below. Group related languages, frameworks, databases and tools into one capability; a field name or a technology name is never a unit of questioning. For each dimension choose one focus and the concrete resume evidence (a named project, system, function, deliverable or responsibility) that supports it. Leave out a dimension that has neither a case requirement nor resume evidence.
STEP 2 ASK: write at least 5 questions in total and as many more as this person's resume and the case justify (usually 5-8; the interviewer should have enough to choose from). A dimension may have several questions when the resume has several distinct projects, systems or responsibilities worth verifying: give each its own named example and its own purpose, never the same example twice. Build each from that dimension's focus and evidence.
1. authenticity: one specific resume project — what was built, the candidate's own role and scope/phases, why a decision was made, the actual contribution and result. Never merely ask whether a technology was used.
2. core-capability: the 1-2 most important capabilities of the case (required skills, main responsibilities, key engineering), verified together in one concrete work example. Development/design/database/infrastructure/cloud/testing for technical cases; schedule, issue and customer management for PM/PMO; domain knowledge, requirement definition and user communication for business roles.
3. problem-solving: a real exception, incident, performance issue, requirement change, design conflict or unknown that fits this case and role. A complete answer runs problem → investigation/judgment → action → verification → result. Do not force incident repair on every role or assume an incident happened.
4. ownership-collaboration: what the candidate delivers independently, who they coordinate with, how they confirm/report/communicate, and how they proceed when something is unclear. Adapt to SE/PG/PM/PMO/testing/operations.
5. case-readiness: the past experience closest to this case, what they can take on immediately, how they start in an unfamiliar system or domain, and how a documented gap against the case is closed. Do not invent a gap.
OPEN TOPICS (dimension open-topic, ask open-topic): not every question has to rest on the resume or the case. When operatorRequest asks for a topic they do not cover - Japanese ability and communication, why the person is moving, plans after joining, motivation, how they like to work, questions about the next step - write that question as an open-topic question, in general terms, with empty requirementIds and evidenceIds and no mother question. Never produce an open-topic question the interviewer did not ask for, never state a fact about the person in it, and keep the usual rules against sales conditions and identity or protected attributes.
QUESTION FORM: the question itself names the concrete project, system, function or deliverable taken from its cited evidence. The candidate may be asked to choose one feature or problem only inside a project or system the question names from its cited evidence, never without naming it. One question covers ONE example and at most the three beats of its mother question, within about 200 characters; finer elements a complete answer covers belong in the scoring guide, not in the question. The scoring guide states what a strong answer contains and one warning sign, in the same language as the question.
MOTHER QUESTIONS: every dimension has one fixed mother question. Fill its slots ({project}, {system}, {task}, {technology}) from the cited evidence and the case, keep its beats in order, and drop a beat the resume cannot support rather than inventing it. Every mother question asks about one real, named case, never how the candidate handles things in general.
authenticity — what they really did: "In {project}: what was the system and how large was the team; what were your role and module; which design documents, code or test materials did you produce alone?" Shapes: role-scope (the mother question) or design-decision (one technical judgment the resume claims, for example 技術方針策定: what was actually decided and why).
core-capability — whether they can finish one feature: "In {system}, take one feature you built: from requirement input through design, {technology} implementation, data/SQL and unit/integration test, what did you do and confirm at each stage?" Shapes: end-to-end (the mother question) or deliverable-quality (what was produced and how its quality was confirmed). The end-to-end walkthrough belongs to this dimension only; authenticity never asks it.
problem-solving — how they investigate: "One real problem in {system}: what you observed, which logs, SQL, tables or reproduction conditions narrowed it down and why you suspected that spot, what you changed and how you proved there was no side effect." Shapes: incident-chain (the mother question) or change-response (one real requirement change, design conflict or unknown and how it was handled).
ownership-collaboration — how they drive work with others: "One piece of work you drove yourself in {project}: how far did your responsibility go; which items did you have to confirm with members or the lead; how did you handle unclear information or disagreement and still deliver?" Three beats at most: never add division of labour, reporting and final delivery as further asks. Shapes: coordination (the mother question) or ambiguity-handling (one real unclear request and how they moved it forward).
case-readiness — how soon they produce on this case: "Joining this case tomorrow for {task}: in what order would you check existing code, design documents, interface specifications, logs, database and test materials in the first 1-3 days, and what could you own first?" Its followUp is the readiness test: "If a small add-on development or defect fix is due in your first week, what do you confirm first, and how do you judge you are ready to change code?" A strong answer names design documents, the existing implementation, related SQL, logs, the call chain, test data, impact scope, interface specifications and existing tests; put that list in the scoring guide. Shapes: onboarding (the mother question), experience-transfer (which past experience maps to this case and how) or gap-closing (how a gap the resume actually shows against the case is closed). A scenario may assume missing experience only when the resume shows it is missing.
FOLLOW-UP: a question may carry one short followUp probe that tests the answer, for example what they do when the design document and the current code disagree; it is not a second question.
Each question has ONE dimension, ONE ask shape and a distinct purpose; the same capability on the same example is never asked again in other words, across dimensions included. Prefer behavior, judgment, concrete deliverables and actual contribution over terminology. Do not presume design/development ownership from testing-only evidence.
Use BOTH case and resume when a case is supplied, and include at least one case-readiness question. If no case is supplied, prepare only resume-based questions and omit case-readiness rather than inventing a case. Never expand to requirements absent from the case AND unsupported by the resume. At most one question may address a real case requirement that has no resume evidence, asked conditionally without claiming experience.
Case title tags, location, rate/pay, availability/start date, attendance/remote arrangements and other sales conditions are not capabilities and never become interview questions. Skip unclear, meaningless, corrupted or placeholder fields. Do not re-confirm explicit resume facts merely to reach a count. When the material is thin, still reach 5 by asking about different projects, deliverables or phases, or about how a documented gap is closed; never pad with questions about facts the resume already states.
Previous planned/selected questions are NOT proof of being asked. Use actual recorded answers to skip answered points and keep only specific unresolved follow-ups. Templates and learned methods must follow this policy; they cannot add dimensions, duplicate questions, unsupported facts or requirements.`

const commercialCondition =
  /勤務地|勤務場所|最寄[り駅]*|単価|单价|給与|报酬|稼働(?:開始|日)|入[场場](?:時期|时间|日)|出社|出勤|在宅|リモート|遠隔勤務|远程办公|工作地点|工作方式|勤務形態|勤務時間|週\s*[0-7０-７一二三四五六七]\s*日|応相談|万円|availability|daily rate|work location|start date/iu
export function isInterviewCapabilityText(text: string): boolean {
  const value = text.normalize('NFKC').trim()
  return (
    !!value &&
    /[\p{L}]/u.test(value) &&
    !commercialCondition.test(value) &&
    !/^(?:[-?？—\s]+|n\/?a|null|undefined|unknown|要確認|未確認|待确认|不明|なし|無|未記載|tbd)$/iu.test(value) &&
    !/[\uFFFD\u0000-\u0008]/u.test(value) &&
    !/^\s*[\[{]/u.test(value)
  )
}

/** A question that tells the candidate to pick the example skipped STEP 1: the preparation must name the example itself. */
const delegatedChoice =
  /(?:一(?:つ|件|例|点)?[^。？?、,，]{0,10}?|1(?:つ|件|例|点)[^。？?、]{0,6}?|ひとつ[^。？?、]{0,6}?|何か[^。？?、]{0,8}?|いずれか[^。？?、]{0,6}?)(?:選び|選んで|選択し|取り上げ|挙げ)|(?:任选|任意选|挑选|选择|选取|举出|列举|自选|选|挑|举)(?:一个|一项|一例|一件|1个|任一|其中一)|\b(?:pick|choose|select)\s+(?:one|any|a)\b/iu
export function asksCandidateToChooseExample(text: string): boolean {
  return delegatedChoice.test(text.normalize('NFKC'))
}

/** "How do you usually…" tests interview skill, not work; every question asks for one real case. */
const generalPractice =
  /^[\s「『（(]*(?:一般|通常|普段|いつも|日頃|平时|平常|一般来说|一般情况|通常情况|一般的に)|(?:一般的に|普段は|通常は|いつもは|日頃から|平时是|平时都|一般都|通常会|一般会|通常怎么|一般怎么|平时怎么|通常如何|一般如何|平时如何)|\b(?:usually|generally|typically|in general|normally)\b/iu
export function asksAboutGeneralPractice(text: string): boolean {
  return generalPractice.test(text.normalize('NFKC').trim())
}

/** Bracketed title tags (test numbers, 急募, locations) label the case; they are not capabilities. */
const titleTag = /[【\[［〔《〈][^】\]］〕》〉]*[】\]］〕》〉]/gu
export function interviewCapabilityRequirements(fields: ReadonlyArray<{ key: string; value: string | null }>): string[] {
  const keys = new Set(['title', 'required_skills', 'preferred_skills', 'role', 'industry', 'japanese_level', 'notes'])
  return [
    ...new Set(
      fields
        .filter((field) => keys.has(field.key))
        .flatMap((field) =>
          (field.key === 'title' ? (field.value ?? '').replace(titleTag, ' ') : (field.value ?? ''))
            .split(/[\n；;]/u)
            .map((value) => value.trim())
            .filter(isInterviewCapabilityText)
        )
    )
  ]
}
