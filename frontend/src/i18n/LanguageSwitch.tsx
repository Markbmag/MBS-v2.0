import { Button, Menu, MenuButton, MenuItemOption, MenuList, MenuOptionGroup, Tooltip } from '@chakra-ui/react';
import { LANGUAGES, lang, setLang, t } from './index.ts';
import type { Lang } from './index.ts';

/** EN / RU: choosing reloads the page in that language. */
export function LanguageSwitch({ size = 'sm' }: { size?: 'xs' | 'sm' }) {
  const current = lang();
  return (
    <Menu isLazy placement="top-end">
      <Tooltip label={t('Language')} hasArrow>
        <MenuButton as={Button} size={size} variant="ghost" px={2} fontWeight={700} fontSize="xs" aria-label={t('Language')} data-testid="language-switch">
          {LANGUAGES.find((l) => l.code === current)?.short}
        </MenuButton>
      </Tooltip>
      <MenuList fontSize="sm" minW="140px">
        <MenuOptionGroup type="radio" value={current} onChange={(v) => v !== current && setLang(v as Lang)}>
          {LANGUAGES.map((l) => (
            <MenuItemOption key={l.code} value={l.code} data-testid={`language-${l.code}`}>
              {l.label}
            </MenuItemOption>
          ))}
        </MenuOptionGroup>
      </MenuList>
    </Menu>
  );
}
