import { existsSync, readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import { privateGoogleLoopbackRedirectSchema } from '@mail'
import { googleWorkspaceOAuthClientIdSchema } from '@shared'

const clientSchema = z.object({
  client_id: googleWorkspaceOAuthClientIdSchema,
  client_secret: z.string().min(8).max(512),
  auth_uri: z.literal('https://accounts.google.com/o/oauth2/auth'),
  token_uri: z.literal('https://oauth2.googleapis.com/token')
})
const privateConfigurationSchema = z.object({
  version: z.enum(['google-private-client-v1', 'google-private-web-v1']),
  accountEmail: z.string().email().max(254),
  redirectUri: privateGoogleLoopbackRedirectSchema.optional(),
  installed: clientSchema.optional(),
  web: clientSchema.extend({
    redirect_uris: z.array(z.string()).min(1).max(50)
  }).optional()
}).refine(value => value.web
  ? !value.installed && Boolean(value.redirectUri && value.web.redirect_uris.includes(value.redirectUri))
  : Boolean(value.installed && !value.redirectUri))

/** Operator-owned local configuration; never read or embedded by distribution builds. */
export function loadPrivateGoogleConfiguration(file: string, packaged: boolean) {
  if (packaged || !existsSync(file)) return null
  try {
    const stat = statSync(file)
    if (stat.size > 32_768 || !stat.isFile() ||
      (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
      throw new Error('Invalid private configuration file permissions.')
    }
    const configuration = privateConfigurationSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    const client = configuration.installed ?? configuration.web!
    return {
      clientId: client.client_id,
      clientSecret: client.client_secret,
      accountEmail: configuration.accountEmail,
      workspaceDomain: configuration.accountEmail.split('@')[1],
      ...(configuration.web ? { privateLocalWeb: { redirectUri: configuration.redirectUri!, accountEmail: configuration.accountEmail } } : {})
    }
  } catch {
    throw new Error('Private Google configuration is invalid. Check its registered local callback, mailbox and file permissions.')
  }
}
