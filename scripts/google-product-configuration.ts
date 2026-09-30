import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const clientId = z.string().regex(/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/u)
const desktopConfiguration = z.object({
  installed: z.object({
    client_id: clientId,
    client_secret: z.string().min(1),
    auth_uri: z.literal('https://accounts.google.com/o/oauth2/auth'),
    token_uri: z.literal('https://oauth2.googleapis.com/token')
  })
})

/** Publisher configuration only. End users sign in; they never supply an OAuth client. */
export function loadGoogleProductBuildVariables(root: string, env: NodeJS.ProcessEnv): Record<string, string> {
  if (env.SES_GOOGLE_OAUTH_CLIENT_ID?.trim()) {
    const id = clientId.safeParse(env.SES_GOOGLE_OAUTH_CLIENT_ID.trim())
    if (!id.success) throw new Error('Product Google OAuth Client ID is invalid.')
    return {
      SES_GOOGLE_OAUTH_CLIENT_ID: id.data,
      ...(env.SES_GOOGLE_OAUTH_CLIENT_SECRET?.trim() ? { SES_GOOGLE_OAUTH_CLIENT_SECRET: env.SES_GOOGLE_OAUTH_CLIENT_SECRET.trim() } : {})
    }
  }
  const explicitPath = env.SES_GOOGLE_OAUTH_CONFIG_FILE?.trim()
  const file = resolve(root, explicitPath || '.local/google-oauth-desktop.json')
  if (!existsSync(file)) {
    if (explicitPath) throw new Error('Product Google OAuth configuration file does not exist.')
    return {}
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error('Product Google OAuth configuration file could not be read.')
  }
  const parsed = desktopConfiguration.safeParse(raw)
  if (!parsed.success)
    throw new Error(
      'Product Google OAuth configuration must be the Desktop app JSON downloaded from Google Cloud. Web application credentials cannot be used here.'
    )
  return {
    SES_GOOGLE_OAUTH_CLIENT_ID: parsed.data.installed.client_id,
    SES_GOOGLE_OAUTH_CLIENT_SECRET: parsed.data.installed.client_secret
  }
}

export function requireGoogleProductBuildConfiguration(values: Record<string, string>): void {
  if (!values.SES_GOOGLE_OAUTH_CLIENT_ID)
    throw new Error(
      'Cannot build a distributable without Google mailbox connection. Publisher: provide .local/google-oauth-desktop.json or SES_GOOGLE_OAUTH_CONFIG_FILE. HR must not configure OAuth.'
    )
}
