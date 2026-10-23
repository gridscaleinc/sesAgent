import { useState } from 'react'
import { requestAiBalance, requestAiSignIn, useLocaleText, type AiServiceProblem } from '../i18n'
import './ai-problem-actions.css'

/**
 * What the operator can do about an AI service problem, offered right where it is reported: check the balance
 * or add credits when credits ran out, sign in when the sign-in is missing. Nothing for network or timeouts.
 */
export function AiServiceProblemActions({ problem }: { problem: AiServiceProblem | null }) {
  const { t } = useLocaleText()
  const [opening, setOpening] = useState(false)
  if (problem === 'sign-in')
    return (
      <span className="ai-problem-actions">
        <button className="ai-problem-action" type="button" onClick={requestAiSignIn}>
          {t('登录 AI 会员', 'AI会員にログイン')}
        </button>
      </span>
    )
  if (problem !== 'quota') return null
  return (
    <span className="ai-problem-actions">
      <button className="ai-problem-action" type="button" onClick={requestAiBalance}>
        {t('查看余额', '残高を確認')}
      </button>
      <button
        className="ai-problem-action is-primary"
        disabled={opening}
        type="button"
        onClick={() => {
          setOpening(true)
          // Credits are bought in the Member Center; where it cannot open, the AI member dialog says why.
          void window.sesAgent
            .openAiCommerceMemberCenter()
            .catch(requestAiBalance)
            .finally(() => setOpening(false))
        }}
      >
        {t('充值额度', 'クレジットを追加')}
      </button>
    </span>
  )
}
