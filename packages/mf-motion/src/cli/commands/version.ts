import { enginePins } from '../../engine/pins';
import { schemaVersions } from '../../schemas/index';
import { CLI_VERSION, defineCommand } from '../registry';

export interface VersionData {
  cli: string;
  engine: { hyperframes: string | null; gsap: string | null; three: string | null };
  schemas: Record<string, number>;
}

export const versionCommand = defineCommand({
  name: 'version',
  summary: 'Print the CLI version, the pinned engine versions and the schema versions.',
  flags: {},
  dataSchema: {
    type: 'object',
    required: ['cli', 'engine', 'schemas'],
    properties: {
      cli: { type: 'string' },
      engine: {
        type: 'object',
        required: ['hyperframes', 'gsap', 'three'],
        properties: {
          hyperframes: { type: ['string', 'null'] },
          gsap: { type: ['string', 'null'] },
          three: { type: ['string', 'null'] },
        },
      },
      schemas: { type: 'object', additionalProperties: { type: 'integer' } },
    },
  },
  handler({ log }) {
    log.debug(`mf-motion ${CLI_VERSION} on Node.js ${process.versions.node}`);
    const data: VersionData = {
      cli: CLI_VERSION,
      engine: enginePins(),
      schemas: schemaVersions(),
    };
    return { data };
  },
  human: (data) => [
    `mf-motion ${data.cli}`,
    `engine: hyperframes ${data.engine.hyperframes ?? 'not pinned'}, gsap ${data.engine.gsap ?? 'not pinned'}, three ${data.engine.three ?? 'not pinned'}`,
    `schemas: ${Object.entries(data.schemas).map(([kind, v]) => `${kind} ${v}`).join(', ') || 'none'}`,
  ],
});
