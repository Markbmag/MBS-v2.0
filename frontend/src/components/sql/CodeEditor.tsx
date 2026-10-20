import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { Box, useColorMode } from '@chakra-ui/react';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { MariaSQL, MSSQL, MySQL, PostgreSQL, SQLite, StandardSQL, sql } from '@codemirror/lang-sql';
import type { SQLDialect } from '@codemirror/lang-sql';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder,
} from '@codemirror/view';
import { t } from '../../i18n/index.ts';

export interface CodeEditorHandle {
  insert: (text: string) => void;
  setText: (text: string) => void;
  focus: () => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: (sql: string, isSelection: boolean) => void;
  engine: string | undefined;
  schema: Record<string, string[]>; // table -> columns, for autocomplete
  editorRef?: Ref<CodeEditorHandle>;
}

const DIALECTS: Record<string, SQLDialect> = {
  mysql: MySQL, mariadb: MariaSQL, postgresql: PostgreSQL, mssql: MSSQL, sqlite: SQLite,
};

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace", lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '&.cm-focused': { outline: 'none' },
  '.cm-tooltip-autocomplete': { borderRadius: '8px' },
});

/** CodeMirror 6, set up for SQL: highlighting, schema-aware autocomplete, Ctrl/Cmd+Enter to run. */
export function CodeEditor({ value, onChange, onRun, engine, schema, editorRef }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun });
  const language = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const { colorMode } = useColorMode();

  useEffect(() => {
    callbacks.current = { onChange, onRun };
  }, [onChange, onRun]);

  // Create the editor once.
  useEffect(() => {
    if (!host.current) return;
    const runKey = Prec.highest(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: (v) => {
            const sel = v.state.selection.main;
            const text = sel.empty ? v.state.doc.toString() : v.state.sliceDoc(sel.from, sel.to);
            callbacks.current.onRun(text, !sel.empty);
            return true;
          },
        },
      ]),
    );
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          runKey,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          placeholder(t('SELECT … — Ctrl/Cmd + Enter runs it (or just the selected part)')),
          baseTheme,
          language.current.of([]),
          theme.current.of([]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ 'aria-label': t('SQL editor'), 'data-testid': 'sql-editor' }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // value is only the initial document; later changes come from setText / typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dialect and schema (autocomplete) follow the database.
  useEffect(() => {
    view.current?.dispatch({
      effects: language.current.reconfigure(
        sql({ dialect: DIALECTS[engine ?? ''] ?? StandardSQL, schema, upperCaseKeywords: true }),
      ),
    });
  }, [engine, schema]);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(colorMode === 'dark' ? oneDark : []) });
  }, [colorMode]);

  useImperativeHandle(
    editorRef,
    () => ({
      insert: (text: string) => {
        const v = view.current;
        if (!v) return;
        const { from, to } = v.state.selection.main;
        v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
        v.focus();
      },
      setText: (text: string) => {
        const v = view.current;
        if (!v) return;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return <Box ref={host} h="100%" overflow="hidden" sx={{ '.cm-editor': { height: '100%' } }} />;
}
