import { useId } from 'react'

/**
 * The SES Agent mark (assets/ses-agent-logo.svg without its tile): the owl agent whose two eyes are the case
 * (blue) and the person (green), overlapping where it brings them together.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  // useId may contain characters a url(#…) reference does not accept.
  const clipId = `${useId().replace(/[^\w-]/gu, '')}-case-eye`
  return (
    <svg aria-hidden="true" className="brand-mark" height={size} viewBox="0 0 64 64" width={size}>
      <defs>
        <clipPath id={clipId}>
          <circle cx="22.95" cy="32.6" r="11.8" />
        </clipPath>
      </defs>
      <path d="M12.7 20.3C10.2 18.2 9.4 14.5 10.5 10.8C13.6 13.4 17 14.6 20.6 15.2Z" fill="#fff" />
      <path d="M51.3 20.3C53.8 18.2 54.6 14.5 53.5 10.8C50.4 13.4 47 14.6 43.4 15.2Z" fill="#fff" />
      <ellipse cx="32" cy="32.8" fill="#fff" rx="24.1" ry="20.8" />
      <circle cx="22.95" cy="32.6" fill="#2F7BFF" r="11.8" />
      <circle cx="41.05" cy="32.6" fill="#22C58B" r="11.8" />
      <circle clipPath={`url(#${clipId})`} cx="41.05" cy="32.6" fill="#fff" r="11.8" />
      <circle cx="21.9" cy="32.8" fill="#fff" r="3.8" />
      <circle cx="42.1" cy="32.8" fill="#fff" r="3.8" />
    </svg>
  )
}
