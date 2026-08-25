# Secure Talent Match AI 本地环境配置手顺

本文档基于当前仓库结构编写，适用于 `secure-talent-match-ai` v0.1.0。本项目当前是 Node.js 本地 Web/API MVP：`scripts/serve.js` 提供静态页面和本地 API，运行时数据保存在服务进程内存和浏览器 `localStorage`，尚未把数据库接入应用代码。

## 1. 当前项目结构

关键文件和目录如下：

| 路径 | 用途 |
| --- | --- |
| `package.json` | Node 脚本和依赖定义 |
| `scripts/serve.js` | 本地 HTTP 服务、API、`.env` 读取、DeepSeek 调用 |
| `src/app.js` | 浏览器端 MVP 逻辑，使用 `localStorage` 保存工作区状态 |
| `docs/development/openapi.v0.1.json` | API 契约草案 |
| `docs/development/workspace-schema.v0.2.json` | 工作区 JSON Schema |
| `docs/development/03-data-model.md` | 数据模型草案 |
| `database/sqlite/001_schema.sql` | SQLite 初始化 SQL |
| `database/postgres/001_schema.sql` | PostgreSQL 初始化 SQL |
| `docker-compose.yml` | 本地 PostgreSQL Docker Compose 配置 |
| `.env.postgres.example` | PostgreSQL 本地环境模板 |
| `.env.example` | 环境变量模板，不包含密钥 |

## 2. 前置依赖

必须安装：

- Node.js 18 以上。当前代码使用 Node 内置 `fetch`、`FormData` 和 `Blob`。
- npm。用于安装依赖和执行项目脚本。

数据库仅在需要验证 SQL 或准备后续持久化开发时安装：

- SQLite 3 CLI：执行 `database/sqlite/001_schema.sql`。
- Docker Desktop：推荐方式，用 Docker Compose 启动 PostgreSQL 并自动执行 `database/postgres/001_schema.sql`。
- PostgreSQL 14 以上及 `psql` CLI：仅在不用 Docker 时需要。

## 3. 安装依赖

在项目根目录执行：

```powershell
npm install
```

如果 `node_modules` 已存在，也建议在更换机器后重新执行一次，确保依赖与 `package-lock.json` 一致。

## 4. 环境变量

复制模板：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，只在本地填入真实密钥。不要提交 `.env` 或在文档、工单、截图中暴露 API Key。

当前 `scripts/serve.js` 实际读取以下变量：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `HOST` | 否 | `127.0.0.1` | 本地服务监听地址 |
| `PORT` | 否 | `4173` | 本地服务端口 |
| `DEEPSEEK_API_KEY` | 否 | 空 | 设置后启用 DeepSeek API；不设置则使用本地规则 fallback |
| `DEEPSEEK_KEY` | 否 | 空 | `DEEPSEEK_API_KEY` 的兼容别名 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | DeepSeek-compatible API Base URL |
| `DEEPSEEK_API_BASE_URL` | 否 | 空 | `DEEPSEEK_BASE_URL` 的兼容别名 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-chat` | 调用的模型名 |
| `DEEPSEEK_TIMEOUT_MS` | 否 | `30000` | API 超时时间，毫秒 |

注意：当前应用代码没有读取 `DATABASE_URL`、`DB_HOST`、`DB_NAME` 等数据库连接变量。数据库 SQL 是为后续持久化开发和本地 schema 验证准备的，不是当前 `npm start` 的启动前置条件。

PostgreSQL Docker Compose 使用以下变量，可通过 `.env.postgres.local` 覆盖。不要把真实密码提交到仓库：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `POSTGRES_DB` | `secure_talent_match_ai` | 本地数据库名 |
| `POSTGRES_USER` | `secure_talent_app` | 本地应用数据库用户 |
| `POSTGRES_PASSWORD` | `secure_talent_dev_password` | 本地开发默认密码，个人环境可覆盖 |
| `POSTGRES_PORT` | `5432` | 暴露到主机的端口 |

## 5. 启动应用

启动本地服务：

```powershell
npm start
```

默认访问地址：

```text
http://127.0.0.1:4173/
```

可验证的 API 地址：

```text
http://127.0.0.1:4173/api/v1
http://127.0.0.1:4173/api/v1/health
http://127.0.0.1:4173/api/v1/openapi.json
http://127.0.0.1:4173/api/v1/workspace-schema.json
```

更换端口时，在 `.env` 中修改 `PORT`，或临时执行：

```powershell
$env:PORT = "4174"; npm start
```

## 6. 数据库创建与初始化

当前版本运行不依赖数据库。以下步骤用于验证 SQL 文件、准备本地持久化库，或供后续后端接入使用。

### 6.1 SQLite

创建本地 SQLite 数据库文件：

```powershell
sqlite3 database\sqlite\secure_talent_match_ai.db ".read database/sqlite/001_schema.sql"
```

确认迁移记录：

```powershell
sqlite3 database\sqlite\secure_talent_match_ai.db "SELECT version, applied_at FROM schema_migrations;"
```

确认表已创建：

```powershell
sqlite3 database\sqlite\secure_talent_match_ai.db ".tables"
```

### 6.2 PostgreSQL（Docker Compose 推荐）

启动 PostgreSQL：

```powershell
docker compose up -d postgres
```

也可以使用 npm 辅助脚本：

```powershell
npm run db:up
```

首次启动全新 Docker volume 时，容器会自动执行：

```text
database/postgres/001_schema.sql
```

确认容器健康状态：

```powershell
docker compose ps
```

确认迁移记录：

```powershell
docker compose exec postgres psql -U secure_talent_app -d secure_talent_match_ai -c "SELECT version, applied_at FROM schema_migrations;"
```

等价的 npm 辅助脚本：

```powershell
npm run db:verify
```

确认表已创建：

```powershell
docker compose exec postgres psql -U secure_talent_app -d secure_talent_match_ai -c "\dt"
```

停止数据库但保留数据：

```powershell
docker compose down
```

也可以使用：

```powershell
npm run db:down
```

重置本地数据库并重新执行初始化 SQL：

```powershell
docker compose down -v
docker compose up -d postgres
```

如果需要覆盖默认密码或端口：

```powershell
Copy-Item .env.postgres.example .env.postgres.local
docker compose --env-file .env.postgres.local up -d postgres
```

`.env.postgres.local` 已被 `.gitignore` 忽略。

### 6.3 PostgreSQL（非 Docker）

创建数据库：

```powershell
createdb secure_talent_match_ai
```

执行初始化 SQL：

```powershell
psql -d secure_talent_match_ai -f database/postgres/001_schema.sql
```

确认迁移记录：

```powershell
psql -d secure_talent_match_ai -c "SELECT version, applied_at FROM schema_migrations;"
```

确认表已创建：

```powershell
psql -d secure_talent_match_ai -c "\dt"
```

如果使用远程 PostgreSQL，请把 `-d secure_talent_match_ai` 替换为管理员提供的连接串。连接串可能包含密码，不能提交到仓库。

## 7. SQL 文件和执行顺序

当前只有一版初始化 SQL：

1. `database/sqlite/001_schema.sql`
2. `database/postgres/001_schema.sql`

两者是同一数据模型的不同数据库方言版本。后续新增迁移时，按文件名前缀数字从小到大执行，例如 `001_schema.sql`、`002_xxx.sql`、`003_xxx.sql`。每个 SQL 文件应在成功执行后写入 `schema_migrations`，避免重复执行造成状态不清。

## 8. 验证

运行静态、逻辑、API、工作区 schema 全量检查：

```powershell
npm test
```

只检查语法和结构：

```powershell
npm run check
```

只检查 API：

```powershell
npm run test:api
```

只检查工作区 JSON Schema：

```powershell
npm run test:workspace
```

手动健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4173/api/v1/health
```

预期 `status` 为 `ok`。如果未设置 `DEEPSEEK_API_KEY`，`ai_config.configured` 会是 `false`，这是当前本地 fallback 模式的正常状态。

## 9. 常见故障

### 端口被占用

现象：启动失败或无法访问 `http://127.0.0.1:4173/`。

处理：在 `.env` 中改用其他端口，例如：

```text
PORT=4174
```

### DeepSeek API 未启用

现象：健康检查中 `ai_config.configured` 为 `false`，或需要 AI 的接口返回本地规则结果。

处理：确认 `.env` 中设置了 `DEEPSEEK_API_KEY`。如果只做本地功能验证，可以不设置。

### DeepSeek API 请求失败

现象：分析 JD 或生成面试问题时返回 provider 相关错误。

处理：检查 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、API Key 权限和网络连接。必要时增大 `DEEPSEEK_TIMEOUT_MS`。

### SQLite 命令不存在

现象：`sqlite3` 无法识别。

处理：安装 SQLite 3 CLI，并确认 `sqlite3` 在系统 PATH 中。

### PostgreSQL 连接失败

现象：`createdb` 或 `psql` 连接失败。

处理：确认 PostgreSQL 服务正在运行，当前系统用户有建库权限；远程库需要确认主机、端口、数据库名、用户名和密码。

### 数据库初始化成功但应用没有读写数据库

这是当前版本的预期行为。`scripts/serve.js` 使用内存 Map 保存 API 运行数据，浏览器端用 `localStorage` 保存工作区状态。数据库目录和 SQL 文件用于后续把 `docs/development/03-data-model.md` 的模型落到持久化存储。

## 10. 安全注意事项

- `.env` 只能放本地真实密钥，仓库中只保留 `.env.example`。
- 导出 CSV、简历文本、ATS 数据和数据库文件可能包含个人信息，应按测试数据或客户数据的保密等级处理。
- AI 输出只能作为招聘判断辅助，最终筛选、面试、录用或淘汰决策必须由人工确认。
