// The dev server needs localhost connections for HMR; a packaged renderer never does.
export const devServerConnectSources = ' ws://localhost:* http://localhost:*'

export function productionContentSecurityPolicy() {
  return {
    name: 'ses-production-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      if (!html.includes(devServerConnectSources))
        throw new Error('Renderer CSP no longer lists the dev-server connect sources; update productionContentSecurityPolicy.')
      return html.replace(devServerConnectSources, '')
    }
  }
}
