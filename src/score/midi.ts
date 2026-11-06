// Standard MIDI files: read the notes, tempo and metre of a reference, and write
// small files for tests and excerpts. Covers formats 0 and 1 with ticks per
// quarter note; SMPTE time division is refused.

export type MidiNote = {
  /** Index of the track chunk the note is in. */
  track: number;
  /** 0-based: channel 9 is General MIDI percussion. */
  channel: number;
  pitch: number;
  velocity: number;
  /** In ticks from the start. */
  start: number;
  end: number;
};

export type MidiTrack = { index: number; name?: string; programs: Record<number, number> };
export type TempoChange = { tick: number; bpm: number };
export type TimeSignature = { tick: number; numerator: number; denominator: number };

export type MidiFile = {
  format: number;
  /** Ticks per quarter note. */
  ticksPerQuarter: number;
  tracks: MidiTrack[];
  notes: MidiNote[];
  tempos: TempoChange[];
  timeSignatures: TimeSignature[];
  /** The last tick of any track. */
  endTick: number;
};

class Reader {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get done() {
    return this.pos >= this.bytes.length;
  }
  byte(): number {
    if (this.pos >= this.bytes.length) throw new Error('MIDI file ends in the middle of an event');
    return this.bytes[this.pos++];
  }
  u16() {
    return (this.byte() << 8) | this.byte();
  }
  u32() {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }
  /** A variable-length quantity: 7 bits per byte, high bit set on all but the last. */
  vlq() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.byte();
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new Error('MIDI variable-length number longer than 4 bytes');
  }
  text(length: number) {
    return new TextDecoder('latin1').decode(this.take(length));
  }
  take(length: number) {
    if (this.pos + length > this.bytes.length) throw new Error('MIDI file ends in the middle of a chunk');
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }
}

/** Data bytes after a channel status byte, by its high nibble. */
const DATA_BYTES: Record<number, number> = { 0x80: 2, 0x90: 2, 0xa0: 2, 0xb0: 2, 0xc0: 1, 0xd0: 1, 0xe0: 2 };

export function readMidi(bytes: Uint8Array): MidiFile {
  const r = new Reader(bytes);
  if (r.text(4) !== 'MThd') throw new Error('not a standard MIDI file (no MThd header)');
  const headerLength = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.pos += headerLength - 6;
  if (division & 0x8000) throw new Error('MIDI files timed in SMPTE frames are not supported, only ticks per quarter note');
  if (format > 1) throw new Error(`MIDI format ${format} (independent sequences) is not supported, only formats 0 and 1`);

  const tracks: MidiTrack[] = [];
  const notes: MidiNote[] = [];
  const tempos: TempoChange[] = [];
  const timeSignatures: TimeSignature[] = [];
  let endTick = 0;
  for (let index = 0; index < trackCount && !r.done; ) {
    const id = r.text(4);
    const length = r.u32();
    const end = r.pos + length;
    if (id !== 'MTrk') {
      r.pos = end; // an unknown chunk: skip it
      continue;
    }
    const track: MidiTrack = { index, programs: {} };
    // Sounding notes per channel and pitch, oldest first: a note-off ends the earliest.
    const open = new Map<number, { start: number; velocity: number }[]>();
    let tick = 0;
    let running = 0;
    while (r.pos < end) {
      tick += r.vlq();
      let status = r.byte();
      if (status < 0x80) {
        if (!running) throw new Error(`track ${index}: data byte with no running status at byte ${r.pos - 1}`);
        r.pos--; // running status: this byte is data
        status = running;
      }
      if (status === 0xff) {
        const type = r.byte();
        const data = r.take(r.vlq());
        if (type === 0x03 && track.name === undefined) track.name = new TextDecoder('latin1').decode(data).trim();
        else if (type === 0x51 && data.length >= 3) tempos.push({ tick, bpm: 60_000_000 / ((data[0] << 16) | (data[1] << 8) | data[2]) });
        else if (type === 0x58 && data.length >= 2) timeSignatures.push({ tick, numerator: data[0], denominator: 2 ** data[1] });
        else if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        r.take(r.vlq());
        continue;
      }
      if (status >= 0xf0) throw new Error(`track ${index}: unexpected status byte 0x${status.toString(16)}`);
      running = status;
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const a = r.byte();
      const b = DATA_BYTES[kind] === 2 ? r.byte() : 0;
      const key = channel * 128 + a;
      if (kind === 0x90 && b > 0) {
        open.set(key, [...(open.get(key) ?? []), { start: tick, velocity: b }]);
      } else if (kind === 0x80 || kind === 0x90) {
        const started = open.get(key)?.shift();
        if (started) notes.push({ track: index, channel, pitch: a, velocity: started.velocity, start: started.start, end: tick });
      } else if (kind === 0xc0) {
        track.programs[channel] ??= a;
      }
    }
    r.pos = end;
    // A note never released ends with its track.
    for (const [key, started] of open) for (const s of started) notes.push({ track: index, channel: Math.floor(key / 128), pitch: key % 128, velocity: s.velocity, start: s.start, end: tick });
    endTick = Math.max(endTick, tick);
    tracks.push(track);
    index++;
  }
  notes.sort((x, y) => x.start - y.start || x.pitch - y.pitch);
  tempos.sort((x, y) => x.tick - y.tick);
  timeSignatures.sort((x, y) => x.tick - y.tick);
  return { format, ticksPerQuarter: division, tracks, notes, tempos, timeSignatures, endTick };
}

// ---- Writing ----

export type WriteTrack = {
  name?: string;
  notes?: { pitch: number; start: number; end: number; channel?: number; velocity?: number }[];
  programs?: Record<number, number>;
};
export type WriteOptions = {
  ticksPerQuarter?: number;
  tempos?: TempoChange[];
  timeSignatures?: TimeSignature[];
  tracks: WriteTrack[];
};

const vlqBytes = (value: number) => {
  const out = [value & 0x7f];
  for (let v = Math.floor(value / 128); v > 0; v = Math.floor(v / 128)) out.unshift((v & 0x7f) | 0x80);
  return out;
};

const u32Bytes = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** A format 1 file: track 0 carries tempo and metre, then one chunk per track given. */
export function writeMidi(options: WriteOptions): Uint8Array {
  const tpq = options.ticksPerQuarter ?? 480;
  type Ev = { tick: number; order: number; bytes: number[] };
  const chunk = (events: Ev[]) => {
    const body: number[] = [];
    let last = 0;
    for (const e of events.sort((a, b) => a.tick - b.tick || a.order - b.order)) {
      body.push(...vlqBytes(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    body.push(0, 0xff, 0x2f, 0);
    return [...[0x4d, 0x54, 0x72, 0x6b], ...u32Bytes(body.length), ...body];
  };
  const meta: Ev[] = [
    ...(options.timeSignatures ?? [{ tick: 0, numerator: 4, denominator: 4 }]).map((t) => ({
      tick: t.tick,
      order: 0,
      bytes: [0xff, 0x58, 4, t.numerator, Math.log2(t.denominator), 24, 8],
    })),
    ...(options.tempos ?? [{ tick: 0, bpm: 120 }]).map((t) => {
      const us = Math.round(60_000_000 / t.bpm);
      return { tick: t.tick, order: 1, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] };
    }),
  ];
  const chunks = [chunk(meta)];
  for (const t of options.tracks) {
    const name = t.name ? [...new TextEncoder().encode(t.name)] : undefined;
    const events: Ev[] = [
      ...(name ? [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlqBytes(name.length), ...name] }] : []),
      ...Object.entries(t.programs ?? {}).map(([ch, p]) => ({ tick: 0, order: 1, bytes: [0xc0 | Number(ch), p] })),
      // Note-offs sort before note-ons at the same tick, so a repeated pitch restarts cleanly.
      ...(t.notes ?? []).flatMap((n) => [
        { tick: n.start, order: 3, bytes: [0x90 | (n.channel ?? 0), n.pitch, n.velocity ?? 80] },
        { tick: n.end, order: 2, bytes: [0x80 | (n.channel ?? 0), n.pitch, 0] },
      ]),
    ];
    chunks.push(chunk(events));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32Bytes(6), 0, 1, 0, chunks.length, (tpq >> 8) & 0xff, tpq & 0xff];
  return Uint8Array.from([...header, ...chunks.flat()]);
}
