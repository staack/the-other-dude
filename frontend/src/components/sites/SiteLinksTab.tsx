import { WirelessLinksTable } from '@/components/wireless/WirelessLinksTable'

interface SiteLinksTabProps {
  tenantId: string
  siteId: string
}

export function SiteLinksTab({ tenantId, siteId }: SiteLinksTabProps) {
  return <WirelessLinksTable tenantId={tenantId} siteId={siteId} showUnknownClients />
}
