# Secure Talent Match AI MVP REST API Draft

## 1. 说明

本文档是 V0.1 API 草案，用于前后端开发对齐，不代表已实现接口。所有 AI 输出均为辅助判断，最终招聘决策由用户完成。

## 2. 通用约定

- Base path: `/api/v1`
- Request / response 使用 JSON，文件上传使用 `multipart/form-data`。
- 时间格式使用 ISO 8601。
- 异步任务返回 `job_id`，前端通过任务查询接口获取进度。
- 错误响应包含 `code`、`message` 和可选 `details`。

## 3. 项目需求

### 创建项目需求

`POST /project-requirements`

请求：

```json
{
  "title": "Java backend engineer for payment system",
  "jd_text": "JD or project requirement text",
  "client_industry": "payment",
  "location": "Tokyo",
  "remote_policy": "hybrid",
  "start_date": "2026-08-01",
  "employment_type": "SES",
  "prompt_version": "match-v0.1"
}
```

响应：

```json
{
  "id": "prj_001",
  "status": "draft"
}
```

### AI 解析项目需求

`POST /project-requirements/{id}/analyze`

请求：

```json
{
  "jd_text": "JD or project requirement text",
  "prompt_version": "match-v0.1"
}
```

响应：

```json
{
  "project_requirement_id": "prj_001",
  "criteria": [
    {
      "category": "skill",
      "name": "Java",
      "priority": "must",
      "weight": 30,
      "description": "Core backend skill"
    }
  ],
  "risk_items": [
    {
      "name": "domain uncertainty",
      "description": "Payment system experience should be confirmed in interview"
    }
  ],
  "interview_validation_points": [
    "Confirm experience with high-traffic backend services"
  ],
  "ai_notice": "AI output is decision support only; final recruiting decisions require human review."
}
```

### 更新并确认项目需求条件

`PUT /project-requirements/{id}/criteria`

请求：

```json
{
  "criteria": [
    {
      "id": "crit_001",
      "category": "skill",
      "name": "Java",
      "priority": "must",
      "weight": 30,
      "description": "5+ years preferred"
    }
  ],
  "status": "confirmed",
  "actor": "demo-user"
}
```

## 4. 简历导入

### 上传简历文件

`POST /resume-imports`

请求：`multipart/form-data`

- `files`: PDF / Word / CSV / folder archive
- `source`: `upload` / `ats_export`

浏览器样例导入和 Mock API 可使用 JSON：

```json
{
  "source": "sample_batch",
  "project_requirement_id": "prj_demo_001",
  "file_count": 120
}
```

响应：

```json
{
  "job_id": "job_import_001",
  "status": "queued",
  "total_files": 120,
  "note": "Mock API does not store original resumes."
}
```

### 查询导入任务

`GET /jobs/{job_id}`

响应：

```json
{
  "job_id": "job_import_001",
  "type": "resume_import",
  "status": "completed",
  "total": 120,
  "succeeded": 120,
  "failed": 0,
  "generated_candidates": 120,
  "errors": [
    {
      "file_name": "resume_012.pdf",
      "message": "Unable to extract text"
    }
  ]
}
```

## 5. 匹配任务

### 创建匹配任务

`POST /match-runs`

请求：

```json
{
  "project_requirement_id": "prj_demo_001",
  "candidate_scope": {
    "source": "current_workspace"
  },
  "ai_mode": "sanitized_api",
  "prompt_version": "match-v0.1"
}
```

响应：

```json
{
  "job_id": "job_match_001",
  "status": "completed",
  "project_requirement_id": "prj_demo_001",
  "candidate_count": 120
}
```

### 获取匹配结果列表

`GET /project-requirements/{id}/match-results`

查询参数：

- `sort`: `total_score` / `skill_score` / `project_experience_score` / `language_score` / `availability_score`
- `recommendation_level`: 可选推荐级别过滤
- `limit`: 默认 50
- `offset`: 默认 0

响应：

```json
{
  "items": [
    {
      "match_result_id": "match_001",
      "candidate_id": "cand_001",
      "display_name": "Candidate A",
      "total_score": 86,
      "recommendation_level": "strong_fit",
      "key_matches": ["Java", "payment domain", "Japanese business communication"],
      "risks": ["Availability needs confirmation"],
      "gaps": ["Cloud operations experience unclear"]
    }
  ],
  "total": 120
}
```

## 6. 候选人详情

### 获取候选人匹配详情

`GET /match-results/{id}`

响应：

```json
{
  "id": "match_001",
  "candidate": {
    "id": "cand_001",
    "display_name": "Candidate A",
    "total_years_experience": 7,
    "language_profile": {
      "ja": "business"
    }
  },
  "total_score": 86,
  "score_items": [
    {
      "dimension": "skill",
      "score": 90,
      "weight": 30,
      "explanation": "Java and Spring experience are clearly described.",
      "evidence": [
        {
          "id": "ev_001",
          "text": "Worked on Java/Spring backend..."
        }
      ]
    }
  ],
  "strengths": ["Strong Java backend background"],
  "gaps": ["Cloud operations depth unclear"],
  "risks": ["Start date should be confirmed"],
  "human_confirmation_suggestions": ["Confirm availability from August"]
}
```

### 添加人工备注

`POST /match-results/{id}/notes`

请求：

```json
{
  "text": "Project owner wants to confirm payment domain depth.",
  "actor": "demo-user"
}
```

响应：

```json
{
  "id": "note_001",
  "match_result_id": "match_001",
  "text": "Project owner wants to confirm payment domain depth.",
  "actor": "demo-user",
  "created_at": "2026-07-23T03:00:00.000Z"
}
```

### 保存人工评审结论

`PUT /match-results/{id}/review-decision`

说明：保存 HR 或项目负责人对候选人的人工确认结论。该结论用于短名单、面试准备表和审计日志；AI 输出仍仅作为辅助判断，不作为自动录用或自动淘汰依据。

请求：

```json
{
  "decision": "interview",
  "decision_label": "推荐面试",
  "actor": "demo-user"
}
```

响应：

```json
{
  "id": "review_decision_001",
  "match_result_id": "match_001",
  "decision": "interview",
  "decision_label": "推荐面试",
  "actor": "demo-user",
  "ai_notice": "AI output is decision support only; final recruiting decisions require human review.",
  "updated_at": "2026-07-23T03:00:00.000Z"
}
```

## 7. 面试问题

### 生成面试问题

`POST /match-results/{id}/interview-questions`

请求：

```json
{
  "question_types": ["technical", "project_review", "risk_followup", "language"],
  "prompt_version": "match-v0.1"
}
```

响应：

```json
{
  "match_result_id": "match_001",
  "prompt_version": "match-v0.1",
  "ai_notice": "AI output is decision support only; final recruiting decisions require human review.",
  "questions": [
    {
      "type": "technical",
      "question": "Please explain your role in the Java payment backend project.",
      "scoring_guide": "Evaluate depth, ownership, and ability to explain tradeoffs."
    }
  ]
}
```

## 8. 导出

### 导出短名单

`POST /exports/shortlist`

请求：

```json
{
  "project_requirement_id": "prj_001",
  "match_result_ids": ["match_001", "match_002"],
  "format": "csv"
}
```

响应：

```json
{
  "export_id": "exp_001",
  "download_url": "/api/v1/exports/exp_001/download"
}
```

下载：

`GET /exports/{id}/download`

响应为 `text/csv`，短名单 CSV 至少包含 `project_requirement_id`、`candidate_id`、`name`、`total_score`、`ai_recommendation`、`human_review_decision` 和 `risks`。

### 导出面试准备表

`POST /exports/interview-pack`

请求：

```json
{
  "match_result_id": "match_001",
  "format": "csv"
}
```

响应：

```json
{
  "export_id": "exp_interview_001",
  "download_url": "/api/v1/exports/exp_interview_001/download"
}
```

下载：

`GET /exports/{id}/download`

响应为 `text/csv`，面试准备表 CSV 至少包含 `project_requirement_id`、`match_result_id`、`candidate_name`、`question_type`、`question` 和 `scoring_guide`。
## 9. 当前筛选结果导出

`POST /exports/filtered-results`

说明：创建当前筛选和排序口径下的候选人结果导出，用于 HR 将某个筛选视图交付给项目负责人或试点报告。该导出不等同于短名单，仍需人工确认推进动作。

请求示例：

```json
{
  "project_requirement_id": "prj_demo_001",
  "format": "csv",
  "match_result_ids": ["match_001", "match_002"],
  "filters": {
    "query": "Java",
    "level": "all",
    "reviewDecision": "interview",
    "sortBy": "total",
    "shortlistOnly": false
  },
  "sort_by": "总分"
}
```

响应示例：

```json
{
  "export_id": "exp_filtered_results_001",
  "download_url": "/api/v1/exports/exp_filtered_results_001/download"
}
```

下载：

`GET /exports/{id}/download`

响应为 `text/csv`，当前筛选结果 CSV 至少包含 `project_requirement_id`、`candidate_id`、`name`、`total_score`、`ai_recommendation`、`human_review_decision`、`filter_summary` 和 `sort_by`。

## 10. 人工结论统计导出

`POST /exports/review-summary`

说明：创建人工结论分布统计导出，用于试点复盘和验收报告。AI 输出仍仅作为辅助判断，统计口径以人工保存的 `review_decision` 为准。

请求示例：

```json
{
  "project_requirement_id": "prj_demo_001",
  "format": "csv",
  "candidate_count": 120,
  "decisions": {
    "pending": 115,
    "interview": 5,
    "hold": 0,
    "reject": 0
  }
}
```

响应示例：

```json
{
  "export_id": "exp_review_summary_001",
  "download_url": "/api/v1/exports/exp_review_summary_001/download"
}
```

下载：

`GET /exports/{id}/download`

响应为 `text/csv`，人工结论统计 CSV 至少包含 `decision`、`decision_label`、`candidate_count`、`candidate_total`、`share_percent` 和 `generated_at`。
