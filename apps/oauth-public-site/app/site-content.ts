export type SiteLocale = 'en' | 'ja' | 'zh'
export type SitePage = 'home' | 'privacy' | 'terms'

export interface LegalSection {
  title: string
  paragraphs?: string[]
  bullets?: string[]
}

export interface SiteCopy {
  htmlLang: string
  languageLabel: string
  nav: { google: string; privacy: string; terms: string; contact: string }
  footer: { operatedBy: string; copyright: string }
  home: {
    eyebrow: string
    headline: string
    lead: string
    trust: string[]
    connectionLabel: string
    connectionTitle: string
    facts: Array<[string, string]>
    processEyebrow: string
    processTitle: string
    steps: Array<{ title: string; body: string }>
    dataEyebrow: string
    dataTitle: string
    dataBody: string
    privacyLink: string
  }
  privacy: {
    title: string
    summary: string
    updated: string
    sections: LegalSection[]
  }
  terms: {
    title: string
    summary: string
    updated: string
    sections: LegalSection[]
  }
}

export const siteCopy: Record<SiteLocale, SiteCopy> = {
  en: {
    htmlLang: 'en',
    languageLabel: 'Language',
    nav: { google: 'Google Mail', privacy: 'Privacy', terms: 'Terms', contact: 'Contact' },
    footer: { operatedBy: 'Operated by gridscale', copyright: '© 2026 gridscale' },
    home: {
      eyebrow: 'LOCAL-FIRST RECRUITING OPERATIONS',
      headline: 'Turn job-request emails into structured cases—without giving Gmail write access.',
      lead: 'SES Agent Desktop helps recruiting and sales teams connect a personal Gmail or Google Workspace mailbox, identify relevant job requests locally, and create structured cases for matching.',
      trust: ['gmail.readonly only', 'Local encrypted storage', 'No automatic sending'],
      connectionLabel: 'GOOGLE MAIL CONNECTION',
      connectionTitle: 'One clear permission',
      facts: [
        ['Account', 'Personal Gmail or Workspace'],
        ['OAuth scope', 'gmail.readonly'],
        ['Attachments', 'Not downloaded'],
        ['Compose / send', 'Not requested'],
      ],
      processEyebrow: 'WHAT THE APP DOES',
      processTitle: 'A bounded path from inbox to case',
      steps: [
        { title: 'Connect in Google', body: 'The user chooses an account in the system browser and explicitly grants read-only access. No Google Cloud setup is required for the HR user.' },
        { title: 'Process on the device', body: 'Message headers and body text within the configured time and keyword limits are minimized, redacted, and processed locally. Attachments are ignored.' },
        { title: 'Create useful records', body: 'Recognized job requests become structured cases. The app never requests Gmail compose, send, modify, or delete permissions.' },
      ],
      dataEyebrow: 'DATA TRANSPARENCY',
      dataTitle: 'Google data is used only for the features the user can see.',
      dataBody: 'gridscale does not sell Google User Data, use it for advertising or credit decisions, or use it to train general-purpose AI models. Access, storage, optional cloud processing, retention, and deletion are described in our privacy policy.',
      privacyLink: 'Read the privacy policy',
    },
    privacy: {
      title: 'Privacy Policy',
      summary: 'How SES Agent Desktop accesses, uses, stores, shares, retains, and deletes Google User Data and other product data.',
      updated: 'Effective and last updated: September 1, 2026',
      sections: [
        {
          title: '1. Operator and scope',
          paragraphs: [
            'SES Agent Desktop is operated by gridscale. This policy applies to the desktop application and its public product pages. Questions and deletion assistance requests can be sent to app_user01@gridscale.com.',
            'The application is local-first. Most business data is processed and stored on the user’s device rather than in a gridscale-hosted mailbox service.',
          ],
        },
        {
          title: '2. Google data we access',
          paragraphs: ['When a user chooses “Connect Google Mail,” the application requests only https://www.googleapis.com/auth/gmail.readonly. This scope permits read access but does not permit the application to compose, send, modify, or delete Gmail data.'],
          bullets: [
            'The connected account email address and Gmail profile metadata.',
            'Message and thread identifiers, history identifiers, labels, dates, and selected headers such as subject, sender, and Message-ID.',
            'Message body text for messages inside the configured label, time, keyword, and per-run limits.',
            'The application detects attachment presence but does not download or store Gmail attachment content.',
            'Remote images and other external HTML resources in email are not loaded by the Gmail import process.',
          ],
        },
        {
          title: '3. Why we use Google data',
          bullets: [
            'To synchronize bounded sets of job-request messages selected by the product configuration.',
            'To identify, extract, normalize, and deduplicate job-case information visible in the desktop application.',
            'To create structured job cases, maintain synchronization checkpoints, and show local audit evidence and processing results.',
            'To secure the connection, detect authorization changes, prevent duplicate re-import, and support user-requested deletion.',
          ],
        },
        {
          title: '4. Local storage and security',
          bullets: [
            'OAuth access and refresh tokens are protected by the operating system credential-protection facility. They are not stored in the application’s SQLCipher database or recovery package.',
            'Imported message metadata, minimized and redacted text, derived job-case records, synchronization state, and audit evidence are stored in an encrypted local SQLCipher database.',
            'The application uses the system browser, PKCE S256, a loopback callback, TLS, and an exact read-only scope for Google authorization.',
            'User-created encrypted recovery packages may include locally stored imported or derived records, but never Google OAuth tokens. Users are responsible for deleting old recovery copies when they delete the corresponding local data.',
          ],
        },
        {
          title: '5. Sharing, transfer, AI, and human access',
          paragraphs: [
            'Gmail import and case recognition do not send raw Gmail messages or OAuth tokens to gridscale servers or Cloud AI. gridscale cannot remotely browse the user’s local mailbox records through this connector.',
            'If a user separately invokes an optional cloud-assisted feature using a case derived from Gmail, the application applies local redaction and requires a separate, explicit review before transmitting only the approved redacted or derived fields needed for that visible feature. Raw Gmail messages, OAuth tokens, and attachments are excluded.',
          ],
          bullets: [
            'Google User Data is not sold, rented, or transferred to advertising platforms, data brokers, or information resellers.',
            'Google User Data is not used for advertising, retargeting, creditworthiness, or lending decisions.',
            'Google User Data is not used to train or improve general-purpose artificial intelligence or machine-learning models.',
            'gridscale personnel do not access Google User Data unless the user explicitly provides specific data for support, or access is required for security or legal compliance.',
            'A user may intentionally export or share a local result. Such user-directed disclosure is controlled by the user and is not an automatic Gmail action.',
          ],
        },
        {
          title: '6. Retention and deletion',
          bullets: [
            'OAuth credentials remain on the device until the user disconnects the Google account, Google or an administrator revokes access, or the credential becomes invalid.',
            'Disconnecting revokes and removes the local OAuth credential but does not automatically delete job cases and other local records already created from imported mail.',
            'Imported and derived records remain locally until the user deletes the related case or application data. A minimal local tombstone may be retained to prevent a deleted Gmail message from being imported again.',
            'Users can also revoke SES Agent Desktop from their Google Account permissions. Locally created recovery packages must be deleted separately by the user.',
            'For help locating or deleting local data, contact app_user01@gridscale.com. Because the data is local-first, gridscale normally cannot delete it remotely.',
          ],
        },
        {
          title: '7. User and administrator controls',
          bullets: [
            'Connect and disconnect the Google account from the application settings.',
            'Review the connected account, exact scope, last synchronization time, and synchronization limits.',
            'Delete job cases and associated imported records using the application’s deletion flow.',
            'Revoke access through Google Account security settings at any time.',
            'Google Workspace administrators may allow, restrict, or revoke the application for managed accounts.',
          ],
        },
        {
          title: '8. Google API Limited Use',
          paragraphs: ['The use of information received from Google Workspace APIs will adhere to the Google User Data Policy, including the Limited Use requirements. These restrictions apply to raw, aggregated, anonymized, and derived Google User Data.'],
        },
        {
          title: '9. Children, legal requirements, and changes',
          paragraphs: [
            'SES Agent Desktop is a business productivity application and is not directed to children. Users must have authority to connect the selected mailbox and process its content.',
            'We may update this policy when product behavior or legal requirements change. Material changes to Google data use will be disclosed before the new use begins and, where required, will require renewed consent.',
          ],
        },
        {
          title: '10. Contact',
          paragraphs: ['Operator: gridscale\nPrivacy and support email: app_user01@gridscale.com'],
        },
      ],
    },
    terms: {
      title: 'Terms of Use',
      summary: 'The minimum terms governing use of the SES Agent Desktop application and its Google Mail connector.',
      updated: 'Effective and last updated: September 1, 2026',
      sections: [
        { title: '1. Acceptance and operator', paragraphs: ['These Terms govern use of SES Agent Desktop, operated by gridscale. By installing or using the application, the user agrees to these Terms and the Privacy Policy. If the application is provided under a separate written order or enterprise agreement, that agreement controls where it conflicts with these Terms.'] },
        { title: '2. Service description', paragraphs: ['SES Agent Desktop is a local-first recruiting operations application. It can connect a Gmail-enabled personal Google Account or Google Workspace account with read-only permission, process bounded job-request email content locally, and create structured cases for recruiting workflows. Microsoft 365, Outlook, and generic IMAP mailboxes are not supported by the Google Mail connector.'] },
        { title: '3. Google authorization', bullets: ['The application requests only gmail.readonly and does not request Gmail compose, send, modify, or delete permissions.', 'The user must select an account they are authorized to use and must comply with their organization’s policies.', 'A Google Workspace administrator may restrict or revoke access. gridscale does not guarantee that an administrator will permit the application.', 'Google services are provided by Google under Google’s own terms and policies.'] },
        { title: '4. License and acceptable use', paragraphs: ['Subject to the applicable purchase or evaluation agreement, gridscale grants the user a limited, non-exclusive, non-transferable right to use the application for lawful internal recruiting and sales operations.'], bullets: ['Do not use the application to access a mailbox without authorization.', 'Do not use the application to send spam, evade provider limits, scrape unrelated mail, or build datasets for resale or general-purpose model training.', 'Do not bypass scope limits, security controls, local review gates, or audit records.', 'Do not reverse engineer or redistribute the application except where applicable law expressly permits it.'] },
        { title: '5. User data and privacy', paragraphs: ['The Privacy Policy explains Google User Data and local business-data handling. Users are responsible for lawful collection and use of mailbox content, candidate data, and job-case information, and for responding to data-subject or organizational requirements that apply to their work.'] },
        { title: '6. Automated extraction and employment decisions', paragraphs: ['Email classification, extraction, redaction, matching, and generated text may be incomplete or incorrect. The application assists operations; it does not make hiring, rejection, employment, legal, or compliance decisions. Users must review material outputs and remain responsible for decisions and communications.'] },
        { title: '7. Local data, backups, and deletion', paragraphs: ['Users control the device, local encrypted database, exported files, and recovery packages. Disconnecting Google removes the OAuth credential but does not erase previously created local cases. Users are responsible for deleting local records and backup copies when no longer needed.'] },
        { title: '8. Third-party and optional cloud services', paragraphs: ['Google APIs, Google Workspace administration, operating-system credential protection, and separately enabled cloud-assistance services are third-party or optional dependencies. Their availability and terms may change. Optional cloud processing requires the application’s separate privacy and review controls and is not part of the Gmail authorization itself.'] },
        { title: '9. Availability and changes', paragraphs: ['The application may be updated, suspended, or discontinued. APIs, quotas, account policies, and operating-system features may affect availability. gridscale does not promise uninterrupted operation or compatibility with every mailbox, device, or organization policy.'] },
        { title: '10. Disclaimer and liability', paragraphs: ['To the maximum extent permitted by applicable law, the application is provided without warranties not expressly stated in a signed agreement. gridscale is not liable for indirect, incidental, special, consequential, or lost-profit damages. Any mandatory rights and any liability that cannot legally be excluded remain unaffected.'] },
        { title: '11. Suspension and termination', paragraphs: ['gridscale may suspend or terminate access for material breach, unlawful use, security risk, or provider-policy violations. Users may stop using the application and disconnect Google access at any time. Provisions concerning data, intellectual property, disclaimers, liability, and disputes survive where their nature requires.'] },
        { title: '12. Governing terms and contact', paragraphs: ['The governing law and dispute forum stated in the applicable purchase, order, or enterprise agreement apply. If there is no separate agreement, mandatory applicable law determines the parties’ rights.\nOperator: gridscale\nSupport: app_user01@gridscale.com'] },
      ],
    },
  },
  ja: {
    htmlLang: 'ja',
    languageLabel: '言語',
    nav: { google: 'Google メール', privacy: 'プライバシー', terms: '利用規約', contact: 'お問い合わせ' },
    footer: { operatedBy: '運営者 gridscale', copyright: '© 2026 gridscale' },
    home: {
      eyebrow: 'ローカルファーストの採用・営業業務',
      headline: 'Gmail の書込権限を渡さず、案件メールを構造化された案件へ。',
      lead: 'SES Agent Desktop は、個人 Gmail または Google Workspace のメールボックスを接続し、関連する案件依頼を端末内で識別して、マッチング用の構造化案件を作成します。',
      trust: ['gmail.readonly のみ', '暗号化ローカル保存', '自動送信なし'],
      connectionLabel: 'GOOGLE メール接続',
      connectionTitle: '要求する権限は一つだけ',
      facts: [['アカウント', '個人 Gmail / Workspace'], ['OAuth Scope', 'gmail.readonly'], ['添付ファイル', '取得しません'], ['草稿・送信', '要求しません']],
      processEyebrow: 'アプリが行うこと', processTitle: '受信箱から案件まで、範囲を限定した処理',
      steps: [
        { title: 'Google で接続', body: 'システムブラウザでアカウントを選択し、読取専用権限を明示的に許可します。HR ユーザーによる Google Cloud 設定は不要です。' },
        { title: '端末内で処理', body: '設定された期間・キーワード・件数の範囲でヘッダーと本文を最小化・脱敏し、端末内で処理します。添付ファイルは無視します。' },
        { title: '業務レコードを作成', body: '認識した案件依頼を構造化案件にします。Gmail の草稿、送信、変更、削除権限は要求しません。' },
      ],
      dataEyebrow: 'データの透明性', dataTitle: 'Google データは、ユーザーに見える機能だけに使用します。',
      dataBody: 'gridscale は Google ユーザーデータを販売せず、広告・信用判断・汎用 AI モデルの学習にも使用しません。アクセス、保存、任意のクラウド処理、保持、削除はプライバシーポリシーに記載します。',
      privacyLink: 'プライバシーポリシーを読む',
    },
    privacy: {
      title: 'プライバシーポリシー', summary: 'SES Agent Desktop による Google ユーザーデータその他の製品データのアクセス、利用、保存、共有、保持、削除について説明します。', updated: '施行日・最終更新日：2026年9月1日',
      sections: [
        { title: '1. 運営者と適用範囲', paragraphs: ['SES Agent Desktop の運営者は gridscale です。本ポリシーはデスクトップアプリと公開製品ページに適用されます。ご質問や削除支援のご依頼は app_user01@gridscale.com へお送りください。', '本アプリはローカルファーストです。多くの業務データは gridscale のメールサービスではなく、ユーザーの端末内で処理・保存されます。'] },
        { title: '2. アクセスする Google データ', paragraphs: ['「Google メールを接続」を選ぶと、https://www.googleapis.com/auth/gmail.readonly のみを要求します。この Scope は読取を許可しますが、Gmail の草稿、送信、変更、削除は許可しません。'], bullets: ['接続アカウントのメールアドレスと Gmail Profile メタデータ。', 'メッセージ ID、Thread ID、History ID、Label、日時、件名・送信者・Message-ID などの選択されたヘッダー。', '設定された Label・期間・キーワード・件数上限内のメッセージ本文テキスト。', '添付の有無は検出しますが、Gmail 添付ファイルの内容は取得・保存しません。', 'メール内の外部画像など、外部 HTML リソースは読み込みません。'] },
        { title: '3. Google データの利用目的', bullets: ['製品設定で限定された案件依頼メールを同期するため。', 'デスクトップアプリに表示する案件情報を識別・抽出・正規化・重複排除するため。', '構造化案件、同期チェックポイント、ローカル監査証跡、処理結果を作成するため。', '接続の保護、認証変更の検出、再取込防止、ユーザー要求による削除を支援するため。'] },
        { title: '4. ローカル保存とセキュリティ', bullets: ['OAuth Access Token と Refresh Token は OS の資格情報保護機能で保護し、SQLCipher DB や復元パッケージには保存しません。', '取込メタデータ、最小化・脱敏済みテキスト、派生案件、同期状態、監査証跡は暗号化ローカル SQLCipher DB に保存します。', 'Google 認証にはシステムブラウザ、PKCE S256、Loopback Callback、TLS、厳密な読取専用 Scope を使用します。', 'ユーザーが作成する暗号化復元パッケージにはローカルの取込・派生レコードが含まれる場合がありますが、OAuth Token は含みません。関連データを削除する場合、古い復元コピーもユーザーが別途削除してください。'] },
        { title: '5. 共有・移転・AI・人によるアクセス', paragraphs: ['Gmail 取込と案件認識では、Gmail 原文や OAuth Token を gridscale サーバーまたは Cloud AI に送信しません。gridscale が本接続を通じて端末内メールレコードを遠隔閲覧することはできません。', 'ユーザーが Gmail 由来案件について任意のクラウド支援機能を別途実行する場合、アプリは端末内脱敏を行い、別の明示的確認を得たうえで、その表示機能に必要な承認済みの脱敏・派生項目だけを送信します。Gmail 原文、OAuth Token、添付は除外します。'], bullets: ['Google ユーザーデータを販売、貸与、広告事業者、データブローカー、情報再販業者へ移転しません。', '広告、リターゲティング、信用力、融資判断に使用しません。', '汎用 AI・機械学習モデルの学習や改善に使用しません。', 'ユーザーが特定データを明示的にサポートへ提供した場合、またはセキュリティ・法令対応上必要な場合を除き、gridscale 担当者は Google ユーザーデータへアクセスしません。', 'ユーザーはローカル結果を意図的に出力・共有できます。これはユーザー管理下の操作であり、Gmail の自動操作ではありません。'] },
        { title: '6. 保持と削除', bullets: ['OAuth 資格情報は、ユーザーが接続解除する、Google または管理者が取消す、または無効になるまで端末内に保持されます。', '接続解除は OAuth 資格情報を取消・削除しますが、既に作成された案件などのローカルレコードは自動削除しません。', '取込・派生レコードは、関連案件またはアプリデータをユーザーが削除するまで端末内に残ります。削除済み Gmail メッセージの再取込防止用に最小限のローカル Tombstone を保持する場合があります。', 'Google アカウントの権限画面から SES Agent Desktop を取消すこともできます。復元パッケージはユーザーが別途削除してください。', 'ローカルデータの確認・削除支援は app_user01@gridscale.com へご連絡ください。ローカルファーストのため、通常 gridscale は遠隔削除できません。'] },
        { title: '7. ユーザーと管理者の制御', bullets: ['アプリ設定から Google アカウントを接続・解除できます。', '接続アカウント、正確な Scope、最終同期時刻、同期上限を確認できます。', 'アプリの削除フローで案件と関連取込レコードを削除できます。', 'Google アカウントのセキュリティ設定からいつでも取消せます。', 'Google Workspace 管理者は管理対象アカウントで本アプリを許可・制限・取消できます。'] },
        { title: '8. Google API Limited Use', paragraphs: ['Google Workspace API から受領した情報の利用は、Limited Use 要件を含む Google User Data Policy に従います。この制限は、生データ、集約、匿名化、派生した Google ユーザーデータにも適用されます。'] },
        { title: '9. 子ども、法令、変更', paragraphs: ['SES Agent Desktop は業務用生産性アプリであり、子どもを対象としていません。ユーザーは対象メールボックスへの接続と内容処理の権限を有する必要があります。', '製品動作または法令要件の変更に応じて本ポリシーを更新する場合があります。Google データの利用目的を重要に変更する場合、開始前に開示し、必要に応じて改めて同意を取得します。'] },
        { title: '10. お問い合わせ', paragraphs: ['運営者：gridscale\nプライバシー・サポート：app_user01@gridscale.com'] },
      ],
    },
    terms: {
      title: '利用規約', summary: 'SES Agent Desktop と Google メール接続の利用に適用される最小限の条件です。', updated: '施行日・最終更新日：2026年9月1日',
      sections: [
        { title: '1. 同意と運営者', paragraphs: ['本規約は gridscale が運営する SES Agent Desktop の利用に適用されます。アプリをインストールまたは使用すると、本規約とプライバシーポリシーに同意したものとします。別途の注文書・企業契約がある場合、矛盾する範囲で当該契約が優先します。'] },
        { title: '2. サービス概要', paragraphs: ['SES Agent Desktop はローカルファーストの採用・営業業務アプリです。Gmail が有効な個人 Google アカウントまたは Google Workspace を読取専用で接続し、限定された案件依頼メールを端末内で処理して構造化案件を作成します。Microsoft 365、Outlook、一般 IMAP は Google メール接続の対象外です。'] },
        { title: '3. Google 認証', bullets: ['gmail.readonly のみを要求し、Gmail の草稿、送信、変更、削除権限は要求しません。', 'ユーザーは利用権限のあるアカウントを選択し、所属組織の規則を守る必要があります。', 'Workspace 管理者はアクセスを制限・取消できます。管理者の許可を gridscale が保証するものではありません。', 'Google サービスには Google の規約とポリシーが適用されます。'] },
        { title: '4. ライセンスと禁止行為', paragraphs: ['購入または評価契約に従い、gridscale は合法的な社内採用・営業業務のための限定的、非独占的、譲渡不能な利用権を付与します。'], bullets: ['権限のないメールボックスへアクセスしないでください。', 'Spam、Provider 制限回避、無関係メールの収集、再販データセットまたは汎用モデル学習に使用しないでください。', 'Scope 上限、セキュリティ制御、ローカル確認、監査記録を回避しないでください。', '法令が明示的に許す場合を除き、リバースエンジニアリングや再配布を行わないでください。'] },
        { title: '5. データとプライバシー', paragraphs: ['Google ユーザーデータとローカル業務データの取扱いはプライバシーポリシーに記載します。ユーザーはメール内容、候補者データ、案件情報を適法に収集・利用し、業務に適用される本人・組織の要求へ対応する責任を負います。'] },
        { title: '6. 自動抽出と雇用判断', paragraphs: ['メール分類、抽出、脱敏、マッチング、生成テキストは不完全または誤っている可能性があります。本アプリは業務を支援しますが、採用、拒否、雇用、法務、コンプライアンス判断は行いません。重要な出力を確認し、判断と通信の責任はユーザーが負います。'] },
        { title: '7. ローカルデータ、バックアップ、削除', paragraphs: ['端末、暗号化ローカル DB、出力ファイル、復元パッケージはユーザーが管理します。Google 接続解除は OAuth 資格情報を削除しますが、作成済みローカル案件は消去しません。不要なレコードとバックアップはユーザーが削除してください。'] },
        { title: '8. 第三者・任意クラウドサービス', paragraphs: ['Google API、Workspace 管理、OS 資格情報保護、別途有効化するクラウド支援は第三者または任意の依存サービスです。可用性や条件は変更される場合があります。任意クラウド処理には別途のプライバシー確認が必要で、Gmail 認証自体には含まれません。'] },
        { title: '9. 可用性と変更', paragraphs: ['アプリは更新、停止、終了される場合があります。API、Quota、アカウントポリシー、OS 機能により利用できない場合があります。中断のない動作や、すべてのメールボックス・端末・組織ポリシーとの互換性は保証しません。'] },
        { title: '10. 免責と責任制限', paragraphs: ['適用法が許す最大限の範囲で、署名済み契約に明記されない保証は行いません。間接、付随、特別、結果的損害または逸失利益について責任を負いません。法的に排除できない権利・責任には影響しません。'] },
        { title: '11. 停止と終了', paragraphs: ['重大な違反、違法利用、セキュリティリスク、Provider ポリシー違反がある場合、利用を停止・終了することがあります。ユーザーはいつでも利用を止め、Google 接続を解除できます。性質上存続すべきデータ、知的財産、免責、責任、紛争条項は存続します。'] },
        { title: '12. 準拠条件とお問い合わせ', paragraphs: ['購入・注文・企業契約に定める準拠法と紛争解決地が適用されます。別途契約がない場合、強行法規により当事者の権利が決まります。\n運営者：gridscale\nサポート：app_user01@gridscale.com'] },
      ],
    },
  },
  zh: {
    htmlLang: 'zh-CN',
    languageLabel: '语言',
    nav: { google: 'Google 邮箱', privacy: '隐私政策', terms: '使用条款', contact: '联系我们' },
    footer: { operatedBy: '运营方 gridscale', copyright: '© 2026 gridscale' },
    home: {
      eyebrow: '本地优先的招聘与销售业务',
      headline: '无需授予 Gmail 写权限，把案件邮件转成结构化案件。',
      lead: 'SES Agent Desktop 可连接个人 Gmail 或 Google Workspace 邮箱，在本机识别相关案件需求，并建立用于匹配的结构化案件。',
      trust: ['仅 gmail.readonly', '本机加密存储', '不会自动发送'],
      connectionLabel: 'GOOGLE 邮箱连接', connectionTitle: '只申请一项明确权限',
      facts: [['账号', '个人 Gmail / Workspace'], ['OAuth 权限', 'gmail.readonly'], ['附件', '不下载'], ['草稿与发送', '不申请']],
      processEyebrow: '应用会做什么', processTitle: '从收件箱到案件，全程限制范围',
      steps: [
        { title: '在 Google 登录授权', body: '用户在系统浏览器中选择账号并明确同意只读访问。HR 用户不需要进入 Google Cloud 配置。' },
        { title: '在本机处理', body: '只处理配置的时间、关键词和数量范围内的邮件头与正文，并在本机最小化和脱敏。附件会被忽略。' },
        { title: '建立业务记录', body: '识别出的案件需求会成为结构化案件。应用不会申请 Gmail 草稿、发送、修改或删除权限。' },
      ],
      dataEyebrow: '数据透明度', dataTitle: 'Google 数据只用于用户能够看到的功能。',
      dataBody: 'gridscale 不销售 Google 用户数据，不将其用于广告、信用判断，也不用于训练通用 AI 模型。访问、存储、可选云端处理、保留和删除规则详见隐私政策。',
      privacyLink: '查看隐私政策',
    },
    privacy: {
      title: '隐私政策', summary: '说明 SES Agent Desktop 如何访问、使用、存储、分享、保留和删除 Google 用户数据及其他产品数据。', updated: '生效及最后更新日期：2026年9月1日',
      sections: [
        { title: '1. 运营方和适用范围', paragraphs: ['SES Agent Desktop 的运营方为 gridscale。本政策适用于桌面应用和公开产品页面。如有问题或需要删除协助，请联系 app_user01@gridscale.com。', '本应用采用本地优先模式。大部分业务数据在用户设备上处理和保存，而不是存储在 gridscale 托管的邮箱服务中。'] },
        { title: '2. 我们访问的 Google 数据', paragraphs: ['用户选择“连接 Google 邮箱”时，应用只申请 https://www.googleapis.com/auth/gmail.readonly。该权限允许读取，但不允许应用创建草稿、发送、修改或删除 Gmail 数据。'], bullets: ['已连接账号的邮箱地址和 Gmail Profile 元数据。', '邮件和会话 ID、History ID、Label、日期，以及主题、发件人、Message-ID 等选定邮件头。', '配置的 Label、时间、关键词和单次数量限制范围内的邮件正文文本。', '应用会识别是否存在附件，但不会下载或保存 Gmail 附件内容。', 'Gmail 导入过程不会加载邮件中的远程图片或其他外部 HTML 资源。'] },
        { title: '3. 使用 Google 数据的目的', bullets: ['同步产品配置所限定的案件需求邮件。', '在桌面应用中识别、提取、标准化和去重案件信息。', '建立结构化案件、同步检查点、本机审计证据和处理结果。', '保护连接、检测授权变化、防止重复导入并支持用户请求的删除。'] },
        { title: '4. 本机存储和安全', bullets: ['OAuth Access Token 和 Refresh Token 由操作系统凭据保护机制保存，不进入应用 SQLCipher 数据库或恢复包。', '导入的邮件元数据、最小化和脱敏文本、派生案件、同步状态及审计证据保存在本机加密 SQLCipher 数据库。', 'Google 授权使用系统浏览器、PKCE S256、本机 Loopback Callback、TLS 和严格的只读权限。', '用户创建的加密恢复包可能包含本机导入或派生记录，但不会包含 Google OAuth Token。删除相关数据时，用户还需要单独删除旧恢复副本。'] },
        { title: '5. 分享、传输、AI 和人工访问', paragraphs: ['Gmail 导入和案件识别不会把 Gmail 原文或 OAuth Token 发送到 gridscale 服务器或 Cloud AI。gridscale 无法通过此连接器远程浏览用户设备中的邮箱记录。', '如果用户对 Gmail 派生案件单独启用可选云端辅助功能，应用会先在本机脱敏，并要求另一项明确确认，之后仅发送该可见功能所需、经过确认的脱敏或派生字段。Gmail 原文、OAuth Token 和附件均不发送。'], bullets: ['不会销售、出租 Google 用户数据，也不会转移给广告平台、数据经纪商或信息转售商。', '不会用于广告、重定向、信用评估或贷款决策。', '不会用于训练或改进通用人工智能或机器学习模型。', '除非用户明确提供特定数据用于支持，或因安全、法律合规需要，gridscale 人员不会访问 Google 用户数据。', '用户可以主动导出或分享本机结果；这是用户控制的操作，不是 Gmail 自动操作。'] },
        { title: '6. 保留和删除', bullets: ['OAuth 凭据会保存在设备上，直到用户断开连接、Google 或管理员撤销访问，或者凭据失效。', '断开连接会撤销并删除本机 OAuth 凭据，但不会自动删除已经建立的案件等本机记录。', '导入和派生记录会保留在本机，直到用户删除相关案件或应用数据。为了防止已删除 Gmail 邮件被再次导入，可能保留最小化的本机 Tombstone。', '用户也可以在 Google 账号权限页面撤销 SES Agent Desktop。恢复包需要由用户单独删除。', '如需查找或删除本机数据的帮助，请联系 app_user01@gridscale.com。由于采用本地优先模式，gridscale 通常无法远程删除这些数据。'] },
        { title: '7. 用户和管理员控制', bullets: ['在应用设置中连接或断开 Google 账号。', '查看已连接账号、准确权限、最后同步时间和同步限制。', '使用应用删除流程删除案件及关联导入记录。', '随时在 Google 账号安全设置中撤销访问。', 'Google Workspace 管理员可以允许、限制或撤销受管理账号对本应用的访问。'] },
        { title: '8. Google API Limited Use', paragraphs: ['从 Google Workspace API 获得的信息将遵守 Google User Data Policy，包括 Limited Use 要求。这些限制同样适用于原始、聚合、匿名化和派生的 Google 用户数据。'] },
        { title: '9. 未成年人、法律要求和政策变化', paragraphs: ['SES Agent Desktop 是企业生产力应用，不面向未成年人。用户必须有权连接所选择的邮箱并处理其中的内容。', '产品行为或法律要求变化时，我们可能更新本政策。如 Google 数据用途发生重大变化，我们会在新用途开始前进行披露，并在需要时重新取得同意。'] },
        { title: '10. 联系方式', paragraphs: ['运营方：gridscale\n隐私与支持邮箱：app_user01@gridscale.com'] },
      ],
    },
    terms: {
      title: '使用条款', summary: '适用于 SES Agent Desktop 及其 Google 邮箱连接器的最低使用条件。', updated: '生效及最后更新日期：2026年9月1日',
      sections: [
        { title: '1. 接受条款和运营方', paragraphs: ['本条款适用于由 gridscale 运营的 SES Agent Desktop。安装或使用本应用即表示用户同意本条款和隐私政策。如另有书面订单或企业协议，冲突部分以该协议为准。'] },
        { title: '2. 服务说明', paragraphs: ['SES Agent Desktop 是本地优先的招聘与销售业务应用。它可以只读连接已启用 Gmail 的个人 Google 账号或 Google Workspace 账号，在本机处理限定范围内的案件需求邮件，并建立结构化案件。Microsoft 365、Outlook 和通用 IMAP 邮箱不属于 Google 邮箱连接器的支持范围。'] },
        { title: '3. Google 授权', bullets: ['只申请 gmail.readonly，不申请 Gmail 草稿、发送、修改或删除权限。', '用户必须选择自己有权使用的账号，并遵守所属组织的政策。', 'Workspace 管理员可以限制或撤销访问；gridscale 不保证管理员一定会允许本应用。', 'Google 服务受 Google 自身条款和政策约束。'] },
        { title: '4. 许可和可接受使用', paragraphs: ['在适用购买或评估协议约束下，gridscale 授予用户有限、非独占、不可转让的权利，用于合法的内部招聘与销售业务。'], bullets: ['不得访问未经授权的邮箱。', '不得用于垃圾邮件、规避服务商限制、抓取无关邮件、建立转售数据集或训练通用模型。', '不得绕过权限范围、安全控制、本机确认或审计记录。', '除非适用法律明确允许，不得逆向工程或重新分发本应用。'] },
        { title: '5. 用户数据和隐私', paragraphs: ['Google 用户数据和本机业务数据的处理方式见隐私政策。用户负责合法收集和使用邮箱内容、候选人数据及案件信息，并负责处理适用于其工作的个人或组织数据要求。'] },
        { title: '6. 自动提取和招聘决定', paragraphs: ['邮件分类、提取、脱敏、匹配和生成文本可能不完整或不准确。本应用辅助业务处理，但不会作出录用、拒绝、雇佣、法律或合规决定。用户必须复核重要输出，并对决定和沟通负责。'] },
        { title: '7. 本机数据、备份和删除', paragraphs: ['用户控制设备、本机加密数据库、导出文件和恢复包。断开 Google 连接只删除 OAuth 凭据，不会清除已经建立的本机案件。用户负责删除不再需要的本机记录和备份副本。'] },
        { title: '8. 第三方和可选云服务', paragraphs: ['Google API、Workspace 管理、操作系统凭据保护以及单独启用的云端辅助属于第三方或可选依赖，其可用性和条款可能变化。可选云处理必须经过应用的另一套隐私与确认控制，不属于 Gmail 授权本身。'] },
        { title: '9. 可用性和变化', paragraphs: ['应用可能更新、暂停或终止。API、配额、账号政策和操作系统功能可能影响可用性。gridscale 不保证不中断运行，也不保证兼容所有邮箱、设备或组织政策。'] },
        { title: '10. 免责声明和责任限制', paragraphs: ['在适用法律允许的最大范围内，除签署协议明确约定外，不提供其他保证。gridscale 不对间接、附带、特殊、后果性损失或利润损失承担责任。法律不能排除的权利和责任不受影响。'] },
        { title: '11. 暂停和终止', paragraphs: ['如发生重大违约、违法使用、安全风险或违反服务商政策，gridscale 可以暂停或终止使用。用户可以随时停止使用并断开 Google 连接。按其性质应继续有效的数据、知识产权、免责声明、责任和争议条款继续有效。'] },
        { title: '12. 适用条件和联系方式', paragraphs: ['适用购买、订单或企业协议约定的法律和争议解决地。如无单独协议，则由适用的强制性法律决定双方权利。\n运营方：gridscale\n支持邮箱：app_user01@gridscale.com'] },
      ],
    },
  },
}

export function sitePath(locale: SiteLocale, page: SitePage): string {
  const localePrefix = locale === 'en' ? '' : `/${locale}`
  if (page === 'home') return localePrefix || '/'
  return `${localePrefix}/${page}`
}
