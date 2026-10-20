// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  RunQueue, addTab, applyLayout, editorParams, filterId, fittingParams, newKey, parseInline, parseMarkdown, placeNew, removeTab,
  runValues, shownValue, suggestMapping, toDefinition, valuesFromSearch, valuesToSearch,
} from '../src/dashboards/logic.ts';
import type { CardQuestion, DashCard, DashFilter, Definition } from '../src/dashboards/types.ts';

const FILTERS: DashFilter[] = [
  { id: 'period', label: 'Period', type: 'date_range', default: ['2026-01-01', '2026-12-31'] },
  { id: 'region', label: 'Region', type: 'category' },
  { id: 'q', label: 'Search', type: 'text' },
];
const card = (key: string, extra: Partial<DashCard> = {}): DashCard => ({ key, kind: 'question', question_id: 1, layout: { x: 0, y: 0, w: 6, h: 4 }, ...extra });

describe('filter values', () => {
  test('what is sent: only chosen values, in the shape of the filter type', () => {
    assert.deepEqual(runValues(FILTERS, { period: ['2026-02-01', ''], region: 'EU, US', q: '' }), {
      period: ['2026-02-01', ''],
      region: ['EU', 'US'],
    });
    assert.deepEqual(runValues(FILTERS, {}), {}); // defaults are applied by the server
  });

  test('what is shown: the default until something is chosen', () => {
    assert.deepEqual(shownValue(FILTERS[0], {}), ['2026-01-01', '2026-12-31']);
    assert.deepEqual(shownValue(FILTERS[1], {}), []);
    assert.equal(shownValue(FILTERS[2], { q: 'abc' }), 'abc');
  });

  test('URL round trip keeps other keys and an open range start', () => {
    const search = valuesToSearch({ period: ['', '2026-03-31'], region: ['EU', 'US'], q: '' }, new URLSearchParams('tab=t2'));
    assert.equal(search.toString(), 'tab=t2&f.period=&f.period=2026-03-31&f.region=EU&f.region=US');
    assert.deepEqual(valuesFromSearch(search), { period: ['', '2026-03-31'], region: ['EU', 'US'] });
  });
});

describe('cards, tabs and layout', () => {
  test('new cards go below the others; keys stay unique', () => {
    // next to the first card when there is room, otherwise below
    assert.deepEqual(placeNew([card('a', { layout: { x: 0, y: 0, w: 6, h: 4 } })], 6, 8), { x: 6, y: 0, w: 6, h: 8 });
    assert.deepEqual(placeNew([card('a', { layout: { x: 0, y: 0, w: 6, h: 4 } }), card('b', { layout: { x: 6, y: 2, w: 6, h: 5 } })], 6, 8), { x: 0, y: 4, w: 6, h: 8 });
    assert.deepEqual(placeNew([card('a', { layout: { x: 0, y: 0, w: 12, h: 1 } })], 12, 1), { x: 0, y: 1, w: 12, h: 1 });
    assert.deepEqual(placeNew([], 6, 8), { x: 0, y: 0, w: 6, h: 8 });
    assert.equal(newKey('c', ['c1', 'c3']), 'c4');
    assert.equal(newKey('c', ['c3', 'c2', 'c1']), 'c4');
  });

  test('grid positions update only what moved', () => {
    const cards = [card('a'), card('b', { layout: { x: 6, y: 0, w: 6, h: 4 } })];
    assert.equal(applyLayout(cards, [{ i: 'a', x: 0, y: 0, w: 6, h: 4 }]), cards); // same object: nothing changed
    const moved = applyLayout(cards, [{ i: 'a', x: 0, y: 4, w: 12, h: 4 }]);
    assert.deepEqual(moved[0].layout, { x: 0, y: 4, w: 12, h: 4 });
    assert.equal(moved[1], cards[1]);
  });

  test('the first tab collects every card; removing a tab moves its cards', () => {
    const def: Definition = { filters: [], tabs: [], settings: {}, cards: [card('a'), card('b', { layout: { x: 0, y: 4, w: 6, h: 2 } })] };
    const two = addTab(def, 'Details');
    assert.deepEqual(two.tabs.map((t) => t.name), ['Overview', 'Details']);
    assert.ok(two.cards.every((c) => c.tab === two.tabs[0].id));
    const moved = { ...two, cards: [two.cards[0], { ...two.cards[1], tab: two.tabs[1].id, layout: { x: 0, y: 0, w: 6, h: 2 } }] };
    const three = addTab(moved, 'More');
    const back = removeTab(three, three.tabs[1].id);
    assert.deepEqual(back.tabs.map((t) => t.name), ['Overview', 'More']);
    assert.equal(back.cards[1].tab, back.tabs[0].id);
    assert.equal(back.cards[1].layout.y, 4); // placed under the cards already there
    const none = removeTab(removeTab(back, back.tabs[1].id), back.tabs[0].id);
    assert.deepEqual(none.tabs, []);
    assert.ok(none.cards.every((c) => c.tab === null));
  });

  test('the saved definition drops server-only fields and stale mappings', () => {
    const def: Definition = {
      filters: [{ id: 'region', label: 'Region', type: 'category', default: '' }],
      tabs: [],
      settings: { refresh: 60 },
      cards: [
        card('a', { question: { state: 'ok', name: 'X' }, mappings: { region: { field: 'o.region' }, gone: { param: 'p' } } }),
        { key: 't', kind: 'text', text: 'hi', layout: { x: 6, y: 0, w: 6, h: 2 } },
      ],
    };
    assert.deepEqual(toDefinition(def), {
      filters: [{ id: 'region', label: 'Region', type: 'category', default: null, required: false }],
      tabs: [],
      settings: { refresh: 60 },
      cards: [
        { key: 'a', kind: 'question', layout: { x: 0, y: 0, w: 6, h: 4 }, tab: null, question_id: 1, mappings: { region: { field: 'o.region' } } },
        { key: 't', kind: 'text', layout: { x: 6, y: 0, w: 6, h: 2 }, tab: null, text: 'hi' },
      ],
    });
  });
});

describe('mapping filters to questions', () => {
  const question: CardQuestion = {
    state: 'ok',
    kind: 'sql',
    parameters: [
      { name: 'since', type: 'date', label: 'Period' },
      { name: 'region', type: 'text' },
      { name: 'min_total', type: 'number' },
    ],
  };

  test('only parameters of a fitting type are offered', () => {
    assert.deepEqual(fittingParams('date_range', question).map((p) => p.name), ['since']);
    assert.deepEqual(fittingParams('category', question).map((p) => p.name), ['region', 'min_total']);
  });

  test('a parameter with the same name or label is suggested', () => {
    assert.deepEqual(suggestMapping(FILTERS[0], question), { param: 'since' }); // label "Period"
    assert.deepEqual(suggestMapping(FILTERS[1], question), { param: 'region' });
    assert.equal(suggestMapping(FILTERS[2], question), null);
    assert.equal(suggestMapping(FILTERS[1], { state: 'hidden' }), null);
  });

  test('filter ids and "open in editor" values', () => {
    assert.equal(filterId('Order date!', []), 'order_date');
    assert.equal(filterId('Region', ['region']), 'region_2');
    const c = card('a', { mappings: { region: { param: 'region' }, period: { field: 'o.created_at' } } });
    assert.equal(editorParams(c, FILTERS, { region: ['EU', 'US'] }).toString(), 'p.region=EU&p.region=US');
  });
});

describe('markdown', () => {
  test('blocks and inline marks', () => {
    const blocks = parseMarkdown('# Title\n\nSome **bold** and *it* text\ncontinued `code`.\n\n- one\n- two [docs](https://example.com)\n\n1. first');
    assert.deepEqual(blocks.map((b) => b.t), ['h', 'p', 'ul', 'ol']);
    assert.deepEqual(parseInline('a **b** *c* `d`'), [
      { t: 'text', v: 'a ' }, { t: 'b', v: 'b' }, { t: 'text', v: ' ' }, { t: 'i', v: 'c' }, { t: 'text', v: ' ' }, { t: 'code', v: 'd' },
    ]);
  });

  test('links only to http(s), mailto and app paths', () => {
    assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ t: 'text', v: 'x' }, { t: 'text', v: ')' }]);
    assert.deepEqual(parseInline('[d](/dashboards/2)'), [{ t: 'link', v: 'd', href: '/dashboards/2' }]);
  });
});

describe('run queue', () => {
  test('never more than the limit at once, first come first served', async () => {
    const queue = new RunQueue(2);
    const order: string[] = [];
    const job = async (name: string, ms: number) => {
      const release = await queue.acquire();
      order.push(`start ${name}`);
      assert.ok(queue.active <= 2);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${name}`);
      release();
      release(); // releasing twice is harmless
    };
    await Promise.all([job('a', 20), job('b', 5), job('c', 1), job('d', 1)]);
    assert.deepEqual(order.slice(0, 2), ['start a', 'start b']);
    assert.ok(order.indexOf('start c') > order.indexOf('end b'));
    assert.equal(queue.active, 0);
    assert.equal(queue.queued, 0);
  });
});
