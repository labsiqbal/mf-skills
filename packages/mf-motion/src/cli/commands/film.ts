// Film commands. Later tickets add themes, theme, build and round here.
import { BRIEF_KEYS, INTERVIEW_QUESTIONS, editBrief } from '../../film/brief';
import { findProjectRoot } from '../../paths/index';
import { CLI_VERSION, defineCommand } from '../registry';

export const filmBriefCommand = defineCommand({
  name: 'film brief',
  summary: 'Record interview answers in plan/brief.json (--set key=value) and report what is still missing (--check).',
  flags: {
    set: { type: 'string', multiple: true, value: '<key>=<value>', description: `a brief field: ${BRIEF_KEYS.join(', ')}` },
    check: { type: 'boolean', description: 'report missing fields and render plan/brief.md' },
  },
  dataSchema: {
    type: 'object',
    required: ['brief', 'missing'],
    properties: {
      brief: { type: 'object' },
      missing: { type: 'array', items: { type: 'string' } },
      md: { type: 'string' },
      questions: { type: 'array', description: 'the interview questions for the missing fields' },
    },
  },
  async handler({ flags, cwd, global, log }) {
    const project = findProjectRoot(cwd, global.project);
    const result = await editBrief(project, flags.set ?? [], { cliVersion: CLI_VERSION, onWarn: (message) => log.warn(message) });
    const questions = INTERVIEW_QUESTIONS.filter((question) => question.fills.some((key) => (result.missing as string[]).includes(key))).map((question) => question.text);
    const next = result.missing.length > 0 ? ['mf-motion film brief --set <key>=<value> --check --json'] : [];
    return { data: { brief: result.brief, missing: result.missing, md: result.md, questions }, next };
  },
});
