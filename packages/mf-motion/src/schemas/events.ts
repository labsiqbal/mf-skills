import * as v from 'valibot';
import { IsoTime, plainRecord } from './shared';

export const EVENTS_VERSION = 1;

export const EVENT_TYPES = [
  'project.created',
  'brand.captured',
  'brand.picked',
  'rights.notice',
  'plan.shown',
  'approval.recorded',
  'build.done',
  'render.started',
  'render.finished',
  'measure.done',
  'gate.verdict',
  'consent.granted',
  'cloud.call',
  'delivered',
  'clean',
  'migrate',
  // Written by `mf-motion note`: agents append to the log through `approve`
  // and `note`, and a note needs its own type.
  'note.added',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const APPROVAL_SUBJECTS = ['beatgrid', 'placement', 'extra-round', 'theme', 'library-add'] as const;

/** Data shapes the contract fixes per event type; other types carry free-form data. */
export const EVENT_DATA: Partial<Record<EventType, v.GenericSchema>> = {
  'approval.recorded': v.strictObject({
    subject: v.picklist(APPROVAL_SUBJECTS),
    /** The user's words, verbatim. */
    text: v.pipe(v.string(), v.minLength(1)),
    planHash: v.pipe(v.string(), v.minLength(1)),
  }),
  'plan.shown': v.strictObject({
    subject: v.picklist(APPROVAL_SUBJECTS),
    planHash: v.pipe(v.string(), v.minLength(1)),
  }),
  'cloud.call': v.strictObject({
    module: v.string(),
    provider: v.string(),
    model: v.string(),
    host: v.string(),
    bytesUp: v.pipe(v.number(), v.minValue(0)),
    estimatedCostUsd: v.pipe(v.number(), v.minValue(0)),
  }),
};

const eventBase = v.strictObject({
  schemaVersion: v.literal(EVENTS_VERSION),
  at: IsoTime,
  /** Strictly increasing per file. */
  seq: v.pipe(v.number(), v.integer(), v.minValue(1)),
  type: v.picklist(EVENT_TYPES),
  actor: v.picklist(['cli', 'agent', 'user']),
  durationMs: v.nullable(v.pipe(v.number(), v.minValue(0))),
  round: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
  data: plainRecord(v.unknown()),
});

/** One events.jsonl line. */
export const eventSchema = v.pipe(
  eventBase,
  v.check((event) => {
    const data = EVENT_DATA[event.type];
    return data === undefined || v.safeParse(data, event.data).success;
  }, 'data must match the shape of its event type'),
);

export type EventDoc = v.InferOutput<typeof eventSchema>;
