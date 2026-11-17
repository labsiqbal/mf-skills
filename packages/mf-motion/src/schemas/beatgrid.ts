// The beat grid the agent writes (plan/beatgrid.json) and the resolved grid
// the CLI writes (plan/beatgrid.resolved.json). Time specs stay strings or
// numbers here; the time grammar validates and resolves them.
import * as v from 'valibot';
import { Id, RelPath, TimeSpec, documentSchema, plainRecord } from './shared';
import { SfxRole } from './sound';

const CUE_NAME = /^[a-z][a-z0-9-]*$/;

/** A resolved time: seconds and the frame it snaps to. */
export const Resolved = v.strictObject({
  sec: v.pipe(v.number(), v.minValue(0)),
  frame: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

function gridEntries<T extends v.GenericSchema>(time: T) {
  return {
    bpm: v.pipe(v.number(), v.minValue(1)),
    beatsPerBar: v.picklist([3, 4]),
    bars: v.pipe(v.number(), v.integer(), v.minValue(1)),
    tailSec: v.pipe(v.number(), v.minValue(0)),
    requestedSec: v.pipe(v.number(), v.minValue(0), v.check((value) => value > 0, 'greater than 0')),
    seed: v.pipe(v.number(), v.integer()),
    /** Sound preset id. */
    genre: v.pipe(v.string(), v.minLength(1)),
    /** "A minor"; null = the preset default. */
    key: v.nullable(v.string()),
    track: v.nullable(v.strictObject({ path: RelPath, analysis: RelPath, offsetSec: v.number() })),
    cues: v.pipe(
      plainRecord(time),
      v.check((cues) => Object.keys(cues).every((name) => CUE_NAME.test(name)), 'cue names match [a-z][a-z0-9-]*'),
    ),
    sections: v.array(
      v.strictObject({
        name: v.pipe(v.string(), v.minLength(1)),
        from: time,
        to: time,
        energy: v.pipe(v.number(), v.minValue(0)),
        riser: v.boolean(),
        drop: v.boolean(),
      }),
    ),
    shots: v.array(
      v.strictObject({
        id: Id,
        from: time,
        to: time,
        intent: v.string(),
        scene: v.string(),
        motion: v.string(),
        sound: v.string(),
      }),
    ),
    /** event names a visible element id. */
    sfx: v.array(v.strictObject({ role: SfxRole, at: time, event: v.pipe(v.string(), v.minLength(1)) })),
  };
}

function uniqueShots<T extends { shots: Array<{ id: string }> }>() {
  return v.check<T, string>((doc) => new Set(doc.shots.map((shot) => shot.id)).size === doc.shots.length, 'shot ids are unique');
}

export const beatgridSchema = v.pipe(documentSchema('beatgrid', 1, gridEntries(TimeSpec)), uniqueShots());

export const beatgridResolvedSchema = v.pipe(
  documentSchema('beatgrid-resolved', 1, {
    ...gridEntries(Resolved),
    /** Seconds per beat. */
    spb: v.pipe(v.number(), v.minValue(0), v.check((value) => value > 0, 'greater than 0')),
    lengthSec: v.pipe(v.number(), v.minValue(0)),
    frames: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
  uniqueShots(),
);
