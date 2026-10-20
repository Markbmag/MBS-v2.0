/** Russian texts, one file per area of the app; keys are the English texts. */
import { ADMIN } from './admin.ts';
import { ANALYSIS } from './analysis.ts';
import { AUTOMATION } from './automation.ts';
import { LIBRARY } from './library.ts';
import { QUERY } from './query.ts';
import { SHELL } from './shell.ts';
import { VIZ } from './viz.ts';

export const RU: Record<string, string> = { ...SHELL, ...QUERY, ...VIZ, ...LIBRARY, ...ANALYSIS, ...AUTOMATION, ...ADMIN };
