# Secure Talent Match AI 环境配置手册

本文档说明本项目的本地开发、AI 服务、数据库和文件存储配置。当前 MVP 服务主要以内存和本地文件演示为主，数据库 SQL 已按产品数据模型提前准备，用于后续后端持久化接入。

## 1. 前置条件

- Node.js 18 或更高版本。
- npm。
- 可选：SQLite 3，用于本地 PoC 数据库。
- 可选：PostgreSQL 15 或更高版本，用于多人试点或企业环境。

## 2. 安装依赖

在项目根目录执行：

```powershell
npm install
```

启动本地服务：

```powershell
npm start
```

默认访问地址：

```text
http://127.0.0.1:4173/
```

## 3. 环境变量文件

项目根目录已有 `.env`，服务启动时会自动读取它。新增环境时不要复制真实密钥到文档或仓库，建议从 `.env.example` 创建本地配置：

```powershell
Copy-Item .env.example .env
```

核心配置如下：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| HOST | 127.0.0.1 | 本地服务监听地址。 |
| PORT | 4173 | 本地服务端口。 |
| NODE_ENV | development | 运行环境。 |
| DEEPSEEK_API_KEY | replace-with-your-key | DeepSeek API 密钥，只能放在本地 `.env`。 |
| DEEPSEEK_BASE_URL | https://api.deepseek.com | DeepSeek API 地址。 |
| DEEPSEEK_MODEL | deepseek-chat | 默认模型。 |
| DEEPSEEK_TIMEOUT_MS | 30000 | AI 请求超时时间，单位毫秒。 |
| DB_CLIENT | sqlite | 数据库类型，可选 `sqlite` 或 `postgres`。 |
| DATABASE_URL | file:./data/secure-talent-match-ai.sqlite | 数据库连接字符串。 |
| DB_MIGRATIONS_DIR | ./database/sqlite | SQL 初始化文件目录。 |
| STORAGE_ROOT | ./data/storage | 业务文件存储根目录。 |
| UPLOAD_ROOT | ./data/uploads | 上传文件目录。 |
| EXPORT_ROOT | ./data/exports | 导出文件目录。 |
| LOG_LEVEL | info | 日志级别。 |

## 4. AI 服务配置

最小配置：

```text
DEEPSEEK_API_KEY=replace-with-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

如果没有配置 `DEEPSEEK_API_KEY`，当前服务会使用本地规则兜底模式，适合静态演示和基础联调；需要真实 JD 分析和面试题生成时必须配置 API key。

## 5. SQLite 本地数据库

SQLite 适合单机 PoC、离线演示和个人开发。

推荐配置：

```text
DB_CLIENT=sqlite
DATABASE_URL=file:./data/secure-talent-match-ai.sqlite
DB_MIGRATIONS_DIR=./database/sqlite
```

初始化：

```powershell
New-Item -ItemType Directory -Force data | Out-Null
sqlite3 .\data\secure-talent-match-ai.sqlite ".read .\database\sqlite\001_schema.sql"
```

检查表是否创建成功：

```powershell
sqlite3 .\data\secure-talent-match-ai.sqlite ".tables"
```

## 6. PostgreSQL 试点数据库

PostgreSQL 适合多人协作、企业试点和需要更强审计能力的环境。

推荐配置：

```text
DB_CLIENT=postgres
DATABASE_URL=postgresql://secure_talent_app:replace-with-password@127.0.0.1:5432/secure_talent_match_ai
DB_SSL=false
DB_POOL_MIN=1
DB_POOL_MAX=10
DB_MIGRATIONS_DIR=./database/postgres
```

初始化数据库和用户的参考流程：

```powershell
psql -U postgres
```

```sql
CREATE DATABASE secure_talent_match_ai;
CREATE USER secure_talent_app WITH PASSWORD 'replace-with-password';
GRANT ALL PRIVILEGES ON DATABASE secure_talent_match_ai TO secure_talent_app;
```

执行表结构 SQL：

```powershell
psql "postgresql://secure_talent_app:replace-with-password@127.0.0.1:5432/secure_talent_match_ai" -f .\database\postgres\001_schema.sql
```

检查表是否创建成功：

```powershell
psql "postgresql://secure_talent_app:replace-with-password@127.0.0.1:5432/secure_talent_match_ai" -c "\dt"
```

## 7. SQL 文件说明

| 文件 | 用途 |
| --- | --- |
| `database/sqlite/001_schema.sql` | SQLite 初始化表结构和索引。 |
| `database/postgres/001_schema.sql` | PostgreSQL 初始化类型、表结构和索引。 |

两套 SQL 都覆盖以下核心业务对象：

- 项目需求：`project_requirements`
- 匹配条件：`requirement_criteria`
- 候选人：`candidates`
- 简历文件：`resume_documents`
- 技能标签：`candidate_skills`
- 项目经历：`project_experiences`
- 证据片段：`evidence_snippets`
- 匹配结果：`match_results`
- 分项评分：`match_score_items`
- 面试问题：`interview_question_sets`
- 审计日志：`audit_logs`

## 8. 文件存储目录

建议本地创建以下目录：

```powershell
New-Item -ItemType Directory -Force data, data\storage, data\uploads, data\exports | Out-Null
```

推荐约定：

- 原始上传文件放在 `UPLOAD_ROOT`。
- 解析后的文本、脱敏文本和中间产物放在 `STORAGE_ROOT`。
- CSV、审计报告、面试包等导出物放在 `EXPORT_ROOT`。
- 数据库只保存文件路径、解析状态、审计元数据和结构化结果。

## 9. 验证命令

检查代码语法：

```powershell
npm run check
```

运行本地测试：

```powershell
npm test
```

检查 API：

```powershell
npm run test:api
```

健康检查：

```text
http://127.0.0.1:4173/api/v1/health
```

返回中的 `mode` 字段可确认 AI 模式：

- `deepseek`：已经配置 API key。
- `local_rule_fallback`：未配置 API key，使用本地规则兜底。

## 10. 安全注意事项

- `.env` 只放本机真实配置，不要提交真实 API key、数据库密码或生产地址。
- `.env.example` 只放占位符。
- 简历、联系方式、原始 JD 和审计日志都可能包含敏感信息，试点环境需要限制文件系统和数据库访问权限。
- 对外演示时优先使用脱敏文本和 `docs/test data` 下的样例数据。
- 审计日志应按追加方式写入，不建议修改历史记录。
