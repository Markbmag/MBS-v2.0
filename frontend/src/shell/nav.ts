import type { ComponentType } from 'react';
import type { IconProps } from '@chakra-ui/react';
import { BellIcon, ChartIcon, CodeIcon, FolderIcon, HomeIcon, LayoutIcon, MergeIcon, SearchIcon, ShieldIcon, TableIcon, UploadIcon } from '../icons';
import { t } from '../i18n/index.ts';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  milestone?: string; // set while the section is still a placeholder
  adminOnly?: boolean;
  end?: boolean; // active only on exactly this path (saved questions live under /questions/:id)
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: t('Home'), icon: HomeIcon },
  { to: '/search', label: t('Search'), icon: SearchIcon },
  { to: '/browse', label: t('Browse'), icon: TableIcon },
  { to: '/library', label: t('Library'), icon: FolderIcon },
  { to: '/questions', label: t('New question'), icon: ChartIcon, end: true },
  { to: '/sql', label: t('SQL editor'), icon: CodeIcon },
  { to: '/combine', label: t('Combine'), icon: MergeIcon },
  { to: '/datasets', label: t('Uploads'), icon: UploadIcon },
  { to: '/dashboards', label: t('Dashboards'), icon: LayoutIcon },
  { to: '/subscriptions', label: t('Subscriptions'), icon: BellIcon },
  { to: '/admin', label: t('Admin'), icon: ShieldIcon, adminOnly: true },
];
