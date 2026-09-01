import { describe, expect, it } from 'vitest'
import { agentPlanningToolCatalog } from './index'
import { routeBusinessText } from './business-text'

describe('planner visibility', () => {
  it('never exposes the intake tool to the cloud planner catalog', () => {
    expect(agentPlanningToolCatalog.some((entry) => /business|import_business/iu.test(entry.name))).toBe(false)
  })
})

// All fixtures are anonymized synthetic variants. Real WeChat samples stay on
// the local machine and never enter the repository.

const anonymizedCaseMessage = [
  '■案件概要：金融系Webシステムの保守開発',
  '作業内容：詳細設計～結合テスト',
  '必須スキル：Java、Spring Boot、5年以上',
  '尚可スキル：AWS、Docker',
  '単価：～65万円（スキル・経験により相談）',
  '勤務地：東京（リモート併用）',
  '外国籍不可、日本語N2以上、年齢50歳まで'
].join('\n')

const anonymizedCandidateMessage = [
  '氏名：A.B',
  '年齢：30代前半',
  '最寄駅：西船橋',
  '単金：60万',
  '日本語：N1相当',
  '経歴：要件定義から結合テストまで一通り対応可能'
].join('\n')

const initialsOnlyCandidateMessage = [
  '人材情報',
  'イニシャル：Y.K',
  '性別：男',
  '最寄駅：横浜',
  '開始日：即日'
].join('\n')

describe('routeBusinessText', () => {
  it('routes a case message to job-case even when it carries nationality, Japanese and age requirements', () => {
    const decision = routeBusinessText(anonymizedCaseMessage)
    expect(decision.route).toBe('job-case')
    expect(decision.reason).toBe('decisive-job-case')
  })

  it('routes a case message whose requirements are written as label lines to job-case', () => {
    const decision = routeBusinessText([
      '案件名：ECサイトリニューアル',
      '必須スキル：PHP、Laravel',
      '単価：55万',
      '年齢：45歳まで',
      '国籍：不問',
      '日本語：ビジネスレベル'
    ].join('\n'))
    expect(decision.route).toBe('job-case')
  })

  it('routes a person message to candidate even when the experience mentions 要件定義', () => {
    const decision = routeBusinessText(anonymizedCandidateMessage)
    expect(decision.route).toBe('candidate')
    expect(decision.reason).toBe('decisive-candidate')
  })

  it('routes an initials-only person message with a person header to candidate', () => {
    const decision = routeBusinessText(initialsOnlyCandidateMessage)
    expect(decision.route).toBe('candidate')
  })

  it('normalizes full-width colons, full-width spaces and decorations', () => {
    const decision = routeBusinessText([
      '★氏　名：C.D',
      '●年　齢：40代',
      '▼単　金：70万',
      '希望：フルリモート'
    ].join('\n'))
    expect(decision.route).toBe('candidate')
  })

  it('returns multiple for two person records', () => {
    const decision = routeBusinessText([
      '氏名：A.B',
      '年齢：30代',
      '単金：60万',
      '',
      '氏名：C.D',
      '年齢：40代',
      '単金：70万'
    ].join('\n'))
    expect(decision.route).toBe('multiple')
    expect(decision.reason).toBe('multiple-record-roots')
  })

  it('returns multiple for a complete case block plus a complete person block', () => {
    const decision = routeBusinessText(`${anonymizedCaseMessage}\n\n${anonymizedCandidateMessage}`)
    expect(decision.route).toBe('multiple')
  })

  it('routes a WeChat-style multi-case update digest with enumerated 案件N roots to multiple', () => {
    // Anonymized structural variant of a real monthly case-update broadcast:
    // shorthand pipe-separated fields, emoji keycap numbering, mixed zh/ja,
    // section headers without colons, and trailing hiring lines.
    const decision = routeBusinessText([
      '📢 来月案件更新、🙏求人🙏',
      '',
      '♥ 9月～',
      '案件1️⃣：Go｜基本設計～テスト、日本語流暢（決済経験尚可）',
      '案件2️⃣：メインフレーム・COBOL｜JCL、要件定義～移行、リモート併用、日本語流畅',
      '案件3️⃣：組込み測試経験者，常駐、日本語流暢➡要员替换，超长期项目',
      '',
      '♥ 10月～',
      '案件1️⃣：Ruby／PHP｜フロント開発、SQL、Git、在宅多め、日本語流畅',
      '！！高単価、还差一个有识者！！',
      '① 9月~長期､データ基盤の有识者2名，都内出勤，日本語流暢。',
      '②  8月～長期、5名，C++3年以上，日本語N3可，都内出勤，面談1回。'
    ].join('\n'))
    expect(decision.route).toBe('multiple')
    expect(decision.reason).toBe('multiple-record-roots')
  })

  it('routes a digest whose records are bare 案件N lines to multiple', () => {
    // Real broadcast shape: the root is a line of its own, the body follows it,
    // and dotted rules separate the records.
    const decision = routeBusinessText([
      '案件1',
      '际物流SaaS导入支援｜物流Forwarding业务知识＋日英流畅＋Cloud SaaS开发经验｜外国籍可。',
      '………………………………………….',
      '案件2',
      '要件定義＋前后端开发＋AI Agent（LangChain/LangGraph等）＋客户对应经验｜40代まで｜商务日语',
      '……………………………………………..',
      '案件3',
      '数名募集',
      'PHP（LAMP）后端开发经验｜渋谷常驻｜即日～｜外国籍可,日语流暢'
    ].join('\n'))
    expect(decision.route).toBe('multiple')
    expect(decision.reason).toBe('multiple-record-roots')
  })

  it('routes a digest whose records are bare circled-number lines to multiple', () => {
    const decision = routeBusinessText([
      '！！継続募集！！',
      '⑥　即日/9月～長期、SE1名、【必須】英会話流暢、Snowflake3年以上、SQL/Oracle、AWS、Python等、週3～4日在宅、面談1回。',
      '',
      '⑦　9月～長期、SE1名、【必須】ClaudeCode、Terraform、PythonによるAPI、Kubernetes、生成AI、AI Agentなど、フル在宅、日本語ビジネス、面談1～2回。',
      '',
      '⑧　9月～長期、PL1名、【必須】要件定義、進捗管理、C#、AI、顧客折衝、週3出勤、日本語N1流暢、面談1回。',
      '⑨　9月～長期、SE1名、【必須】C#（ASP.NET）、基本設計～、AI、週3出勤、日本語N1流暢、面談1回。'
    ].join('\n'))
    expect(decision.route).toBe('multiple')
    expect(decision.reason).toBe('multiple-record-roots')
  })

  it('keeps numbered ordinary chat on the planner path', () => {
    // A number is not a record root: these carry no condition list, no
    // requirement label, and no period-plus-headcount.
    expect(routeBusinessText('①明日でお願いします ②リモートで').route).toBe('not-intake')
    expect(routeBusinessText('1. 買い物 2. 会議').route).toBe('not-intake')
    expect(routeBusinessText('① 明日でお願いします\n② リモートで').route).toBe('not-intake')
    expect(routeBusinessText('案件1件だけ見せて').route).toBe('not-intake')
  })

  it('keeps a single case whose fields are written as numbered lines out of multiple', () => {
    // A numbered line that is one labeled field belongs to the record it sits
    // in; it is not a second record root, however many 、 it lists.
    const decision = routeBusinessText([
      '案件名：DWH更改',
      '1. 必須スキル：Java、SQL、AWS',
      '2. 尚可スキル：Python、Docker、Go',
      '単価：60万',
      '勤務地：白山'
    ].join('\n'))
    expect(decision.route).toBe('job-case')
    expect(decision.reason).toBe('decisive-job-case')
  })

  it('routes one bare 案件N root with a structured body as a single case', () => {
    const decision = routeBusinessText([
      '案件1',
      '案件名：ECサイトリニューアル',
      '必須スキル：PHP、Laravel',
      '単価：55万'
    ].join('\n'))
    expect(decision.route).toBe('job-case')
    expect(decision.reason).toBe('decisive-job-case')
  })

  it('routes an anonymous 【…】-labeled profile to candidate', () => {
    const decision = routeBusinessText([
      '◆️男　37歳／中国籍',
      '【IT経験】15年',
      '【日本語】N1流畅 表格3-4 ',
      '【单    金】6X＋税',
      '【スキル】Java、Python、C、SQL、AWSなど',
      '【対応工程】要件定義～',
      '【アピール】',
      '・2013年に日本へ転職してからは12年間にわたり、主に銀行系システムにおけるJava開発プロジェクトに携わってまいりました。'
    ].join('\n'))
    expect(decision.route).toBe('candidate')
    expect(decision.reason).toBe('decisive-candidate')
  })

  it('returns multiple for two anonymous profiles in one message', () => {
    const profile = ['【スキル】Java、SQL', '【单    金】60万', '【日本語】N1'].join('\n')
    expect(routeBusinessText(`${profile}\n\n${profile}`).route).toBe('multiple')
  })

  it('keeps a single bracketed question on the planner path', () => {
    expect(routeBusinessText('【スキル】について教えて').route).toBe('not-intake')
  })

  it('treats a bare 案件： root with parseable fields as one decisive case', () => {
    const decision = routeBusinessText([
      '案件：ECサイトリニューアル',
      '必須スキル：PHP、Laravel',
      '単価：55万'
    ].join('\n'))
    expect(decision.route).toBe('job-case')
  })

  it('fails closed on a single enumerated shorthand line without parseable fields', () => {
    const decision = routeBusinessText('案件1️⃣：Java｜基本設計～テスト、日本語流暢')
    expect(decision.route).toBe('ambiguous-sensitive')
  })

  it('returns multiple for two case records with the same root label', () => {
    const decision = routeBusinessText([
      '案件名：基幹システム更改',
      '必須スキル：Java',
      '単価：60万',
      '案件名：ECサイト保守',
      '必須スキル：PHP',
      '単価：55万'
    ].join('\n'))
    expect(decision.route).toBe('multiple')
  })

  it('keeps a plain case search question on the planner path', () => {
    const decision = routeBusinessText('最近有什么 Java 案件？')
    expect(decision.route).toBe('not-intake')
  })

  it('keeps a booking request containing a bare person name on the planner path', () => {
    const decision = routeBusinessText('明天10点约田中面试')
    expect(decision.route).toBe('not-intake')
  })

  it('keeps a booking request with a meeting link on the planner path', () => {
    const decision = routeBusinessText('明日10時に田中さんと面接をお願いします。リンク https://zoom.us/j/1234567890')
    expect(decision.route).toBe('not-intake')
  })

  it('fails closed when a phone number appears without record structure', () => {
    const decision = routeBusinessText('请直接联系他，电话 090-1234-5678')
    expect(decision.route).toBe('ambiguous-sensitive')
    expect(decision.reason).toBe('contact-identifier-present')
  })

  it('fails closed when an email address appears without record structure', () => {
    const decision = routeBusinessText('窓口は taro.sales@example.co.jp までお願いします')
    expect(decision.route).toBe('ambiguous-sensitive')
    expect(decision.reason).toBe('contact-identifier-present')
  })

  it('fails closed when a root label appears without enough fields', () => {
    const decision = routeBusinessText('案件名：ECサイト構築')
    expect(decision.route).toBe('ambiguous-sensitive')
    expect(decision.reason).toBe('structure-without-type')
  })

  it('fails closed on a structured record of unknown type', () => {
    const decision = routeBusinessText([
      '項目A：値1',
      '項目B：値2',
      '項目C：値3'
    ].join('\n'))
    expect(decision.route).toBe('ambiguous-sensitive')
    expect(decision.reason).toBe('structure-without-type')
  })

  it('lets an explicit person tag resolve a structured record of unknown type', () => {
    const decision = routeBusinessText([
      '【人员】',
      '自己PR：バックエンド中心',
      '経験：Java 5年'
    ].join('\n'))
    expect(decision.route).toBe('candidate')
    expect(decision.reason).toBe('declared-candidate')
    expect(decision.declaredKind).toBe('candidate')
    expect(decision.businessText).not.toContain('【人员】')
  })

  it('lets an explicit case tag resolve a structured record of unknown type', () => {
    const decision = routeBusinessText([
      '【案件】',
      '内容：決済基盤の増員',
      '条件：週5稼働'
    ].join('\n'))
    expect(decision.route).toBe('job-case')
    expect(decision.reason).toBe('declared-job-case')
  })

  it('accepts the 【要員】 tag variant', () => {
    const decision = routeBusinessText([
      '【要員】',
      '自己PR：インフラ運用',
      '経験：AWS 3年'
    ].join('\n'))
    expect(decision.route).toBe('candidate')
  })

  it('returns ambiguous-sensitive when a tag contradicts decisive opposite structure', () => {
    const decision = routeBusinessText(`【人员】\n${anonymizedCaseMessage}`)
    expect(decision.route).toBe('ambiguous-sensitive')
    expect(decision.reason).toBe('tag-structure-conflict')
  })

  it('does not let a tag override multiple records', () => {
    const decision = routeBusinessText([
      '【人员】',
      '氏名：A.B',
      '単金：60万',
      '氏名：C.D',
      '単金：70万'
    ].join('\n'))
    expect(decision.route).toBe('multiple')
  })

  it('fails closed when a tag arrives without record structure', () => {
    const decision = routeBusinessText('【人员】优秀的Java工程师，五年经验，人很好')
    expect(decision.route).toBe('ambiguous-sensitive')
    expect(decision.reason).toBe('insufficient-structure-for-declared-kind')
  })

  it('keeps plain chat on the planner path', () => {
    expect(routeBusinessText('今天的匹配结果怎么样？').route).toBe('not-intake')
    expect(routeBusinessText('把刚才那个候选人的档案打开').route).toBe('not-intake')
  })

  it('does not treat date and time fragments as record structure', () => {
    const decision = routeBusinessText([
      '面接候補:',
      '8/26 10:00',
      '8/27 14:00'
    ].join('\n'))
    expect(decision.route).toBe('not-intake')
  })
})

describe('operator field aliases in routing', () => {
  it('counts an aliased partner label as the built-in case field it stands for', () => {
    const text = '案件名：物流システム追加開発\n単金：60万円\n稼働：9月～'
    // Without aliases only the root label is recognised: not enough structure to be a case.
    expect(routeBusinessText(text).route).toBe('ambiguous-sensitive')
    // 単金 → 単価 and 稼働 → 参画時期 give the two case fields a decisive case needs.
    expect(routeBusinessText(text, { aliases: { rate: ['単金'], start_date: ['稼働'] } })).toMatchObject({
      route: 'job-case', reason: 'decisive-job-case'
    })
  })
})
