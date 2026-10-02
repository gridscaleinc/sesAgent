import './ai-working.css'

/** Shown where HR is working while the cloud AI answers: three pulsing dots, the label and a running bar. */
export function AiWorking({ label }: { label: string }) {
  return (
    <div className="ai-working" role="status" aria-live="polite">
      <span className="ai-working-line">
        <span className="ai-working-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {label}
      </span>
      <span className="ai-working-bar" aria-hidden="true" />
    </div>
  )
}
