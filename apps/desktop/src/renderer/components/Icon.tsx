import type { SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'tasks'
  | 'briefcase'
  | 'users'
  | 'mail'
  | 'shield'
  | 'settings'
  | 'plus'
  | 'search'
  | 'file'
  | 'upload'
  | 'sparkles'
  | 'chevron-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'check'
  | 'clock'
  | 'lock'
  | 'database'
  | 'alert'
  | 'edit'
  | 'phone'
  | 'external-link'

const paths: Record<IconName, string[]> = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v10h13V10', 'M9.5 20v-6h5v6'],
  tasks: ['M7 4h10', 'M7 8h10', 'M7 12h7', 'M5 20h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z'],
  briefcase: ['M9 6V4h6v2', 'M3 8h18v11H3z', 'M3 12h18', 'M10 12v2h4v-2'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  mail: ['M3 5h18v14H3z', 'm3 7 9 6 9-6'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 3.46-.08-.03a1.7 1.7 0 0 0-1.9.26l-.76.44a1.7 1.7 0 0 0-.84 1.7V23h-4v-.09a1.7 1.7 0 0 0-.84-1.7l-.76-.44a1.7 1.7 0 0 0-1.9-.26l-.08.03-2-3.46.06-.06A1.7 1.7 0 0 0 5 15.14v-.88a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2-3.46.08.03a1.7 1.7 0 0 0 1.9-.26l.76-.44a1.7 1.7 0 0 0 .84-1.7V6h4v.09a1.7 1.7 0 0 0 .84 1.7l.76.44a1.7 1.7 0 0 0 1.9.26l.08-.03 2 3.46-.06.06a1.7 1.7 0 0 0-.34 1.88Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4-4'],
  file: ['M6 2h8l4 4v16H6z', 'M14 2v5h5', 'M9 13h6', 'M9 17h6'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M5 20h14'],
  sparkles: ['m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4Z', 'm18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z', 'M5 14v4', 'M3 16h4'],
  'chevron-right': ['m9 18 6-6-6-6'],
  'arrow-left': ['m15 18-6-6 6-6', 'M9 12h11'],
  'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
  check: ['m5 12 4 4L19 6'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  lock: ['M5 10h14v11H5z', 'M8 10V7a4 4 0 0 1 8 0v3'],
  database: ['M4 6c0 2 16 2 16 0s-16-2-16 0Z', 'M4 6v6c0 2 16 2 16 0V6', 'M4 12v6c0 2 16 2 16 0v-6'],
  alert: ['M12 3 2.5 20h19Z', 'M12 9v4', 'M12 17h.01'],
  edit: ['M4 20h4l11-11-4-4L4 16z', 'm13.5 2.5 4 4'],
  phone: ['M6.6 3h3l1.5 4-2 1.6a16 16 0 0 0 6.3 6.3l1.6-2 4 1.5v3c0 1.1-.9 2-2 2C10.2 19.4 3.6 12.8 3.6 5a2 2 0 0 1 2-2Z'],
  'external-link': ['M14 3h7v7', 'M10 14 21 3', 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5']
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  )
}
