# Secure Talent Match AI V0.1 Data Model Draft

## 1. 说明

本文档是 MVP 数据模型草案，用于指导开发和评审，不代表已实现数据库结构。单机 PoC 默认可使用 SQLite；企业试点可升级为 PostgreSQL。

## 2. ProjectRequirement

项目需求 / JD 的结构化结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 项目需求 ID |
| title | string | 项目或职位名称 |
| raw_text | text | 原始 JD / 项目需求 |
| client_industry | string | 客户行业 |
| location | string | 工作地点 |
| remote_policy | string | 远程条件 |
| start_date | string | 到岗时间 |
| employment_type | string | 雇佣形态 |
| status | string | draft / confirmed / archived |
| created_by | string | 创建人 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

## 3. RequirementCriterion

从项目需求中拆解出的条件、权重和风险点。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 条件 ID |
| project_requirement_id | string | 所属项目需求 |
| category | string | skill / project_experience / industry / seniority / language / availability / risk |
| name | string | 条件名称 |
| description | text | 条件说明 |
| priority | string | must / plus / verify |
| weight | number | 匹配权重 |
| source | string | ai_generated / human_edited |
| evidence_query | text | 用于检索简历证据的查询文本 |

## 4. Candidate

候选人主档。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 候选人 ID |
| display_name | string | 展示名称，可为脱敏名称 |
| original_name | string | 原始姓名，本地保存 |
| email | string | 邮箱，本地保存 |
| phone | string | 电话，本地保存 |
| location | string | 当前地点 |
| total_years_experience | number | 工作年限 |
| language_profile | json | 日语 / 英语等语言能力 |
| availability | json | 到岗时间、地点、远程、雇佣形态 |
| source | string | upload / csv / ats_export |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

## 5. ResumeDocument

简历文件与解析状态。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 简历文件 ID |
| candidate_id | string | 关联候选人 |
| file_name | string | 原始文件名 |
| file_type | string | pdf / docx / csv / other |
| storage_path | string | 本地文件路径 |
| parse_status | string | pending / processing / succeeded / failed |
| parse_error | text | 解析失败原因 |
| raw_text_path | string | 原文抽取结果路径 |
| sanitized_text_path | string | 脱敏文本路径 |
| created_at | datetime | 导入时间 |

## 6. CandidateSkill

候选人技能标签。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 技能记录 ID |
| candidate_id | string | 候选人 ID |
| skill_name | string | 技能名称，如 Java、AWS、Spring |
| skill_type | string | language / framework / tool / domain / certification |
| proficiency | string | beginner / intermediate / advanced / unknown |
| years_used | number | 使用年限 |
| evidence_id | string | 对应证据片段 |

## 7. ProjectExperience

候选人项目经历。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 项目经历 ID |
| candidate_id | string | 候选人 ID |
| title | string | 项目标题，可脱敏 |
| industry | string | 行业 / 领域 |
| role | string | 职责或角色 |
| technologies | json | 使用技术 |
| start_date | string | 开始时间 |
| end_date | string | 结束时间 |
| summary | text | 项目摘要 |
| evidence_id | string | 对应证据片段 |

## 8. EvidenceSnippet

评分和解释引用的证据片段。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 证据 ID |
| candidate_id | string | 候选人 ID |
| resume_document_id | string | 来源简历 |
| section | string | 简历章节 |
| text | text | 原文片段 |
| sanitized_text | text | 脱敏片段 |
| page_number | number | 页码，可为空 |
| confidence | number | 抽取置信度 |

## 9. MatchResult

候选人与项目需求的匹配结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 匹配结果 ID |
| project_requirement_id | string | 项目需求 ID |
| candidate_id | string | 候选人 ID |
| total_score | number | 总分，0-100 |
| recommendation_level | string | strong_fit / possible_fit / needs_review / weak_fit |
| summary | text | AI 辅助摘要 |
| strengths | json | 核心匹配点 |
| gaps | json | 缺口 |
| risks | json | 风险点 |
| human_confirmation_suggestions | json | 人工确认建议 |
| model_version | string | 模型版本 |
| prompt_version | string | 提示词版本 |
| created_at | datetime | 生成时间 |

## 10. MatchScoreItem

分项评分。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 分项评分 ID |
| match_result_id | string | 匹配结果 ID |
| dimension | string | skill / project_experience / industry / seniority / language / availability |
| score | number | 分项分，0-100 |
| weight | number | 权重 |
| explanation | text | 解释 |
| evidence_ids | json | 证据 ID 列表 |

## 11. InterviewQuestionSet

面试问题与评分表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 问题集 ID |
| match_result_id | string | 匹配结果 ID |
| question_type | string | technical / project_review / risk_followup / language |
| question | text | 面试问题 |
| rationale | text | 生成理由 |
| related_evidence_ids | json | 关联证据 |
| scoring_guide | text | 评分说明 |

## 12. AuditLog

关键行为审计记录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 审计 ID |
| actor_id | string | 操作者 |
| action | string | 行为类型 |
| target_type | string | project_requirement / candidate / match_result / export / model_config |
| target_id | string | 目标 ID |
| metadata | json | 变更详情、权重变化、导出参数等 |
| created_at | datetime | 发生时间 |
