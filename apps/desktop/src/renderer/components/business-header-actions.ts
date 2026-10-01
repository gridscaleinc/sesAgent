import { createContext, type ReactNode } from 'react'

/**
 * Handed by the HR shell to a page that shows the shell's page-level actions (privacy badge, 问 Agent) at the
 * end of its own toolbar row instead of under a separate page header. null means the shell keeps them.
 * chatOpen: the 问 Agent drawer has the side, so the page's own detail pane steps back as the shell's panel does.
 */
export const BusinessHeaderActionsContext = createContext<{ actions: ReactNode; chatOpen: boolean } | null>(null)
