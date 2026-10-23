import type { VendorSite } from '@shared'
import { useLocaleText } from '../i18n'
import { Icon } from './Icon'
import './vendor-credit.css'

/** Who makes the app, with its site and the AppShelf catalog of its other apps (opened in the system browser). */
export function VendorCredit({ className }: { className?: string }) {
  const { t } = useLocaleText()
  const open = (site: VendorSite) => void window.sesAgent.openVendorSite(site).catch(() => undefined)
  return (
    <p className={['vendor-credit', className].filter(Boolean).join(' ')}>
      <span>{t('由 Gridscale 提供', 'グリッドスケール株式会社が提供')}</span>
      <button onClick={() => open('gridscale')} type="button">
        www.gridscale.com
        <Icon name="external-link" size={11} />
      </button>
      <button onClick={() => open('appshelf')} type="button">
        {t('在 AppShelf 查看更多应用', 'AppShelfで他のアプリを見る')}
        <Icon name="external-link" size={11} />
      </button>
    </p>
  )
}
