import { Box, Code, Heading, Link, ListItem, OrderedList, Text, UnorderedList } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { parseMarkdown } from './logic';
import type { Inline } from './logic';

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.t === 'b') return <b key={i}>{it.v}</b>;
        if (it.t === 'i') return <i key={i}>{it.v}</i>;
        if (it.t === 'code') return <Code key={i} fontSize="0.9em">{it.v}</Code>;
        if (it.t === 'link')
          return it.href.startsWith('/') ? (
            <Link key={i} as={RouterLink} to={it.href} color="brand.400">
              {it.v}
            </Link>
          ) : (
            <Link key={i} href={it.href} isExternal color="brand.400">
              {it.v}
            </Link>
          );
        return <span key={i}>{it.v}</span>;
      })}
    </>
  );
}

/** Text cards: headings, paragraphs, lists, bold/italic/code and links. Rendered as React elements, never as HTML. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <Box fontSize="sm" lineHeight="1.6" sx={{ '& > * + *': { mt: 2 } }}>
      {blocks.map((b, i) => {
        if (b.t === 'h')
          return (
            <Heading key={i} as={`h${b.level + 2}` as 'h3'} fontSize={b.level === 1 ? 'lg' : b.level === 2 ? 'md' : 'sm'}>
              <Inlines items={b.v} />
            </Heading>
          );
        if (b.t === 'p')
          return (
            <Text key={i}>
              <Inlines items={b.v} />
            </Text>
          );
        const List = b.t === 'ul' ? UnorderedList : OrderedList;
        return (
          <List key={i} pl={1}>
            {b.items.map((item, j) => (
              <ListItem key={j}>
                <Inlines items={item} />
              </ListItem>
            ))}
          </List>
        );
      })}
    </Box>
  );
}
