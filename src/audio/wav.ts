// WAV encoding (16-bit PCM) and decoding (8/16/24/32-bit PCM, 32/64-bit float).

export function encodeWav(channels: Float32Array[], sampleRate: number): Buffer {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = frames * count * 2;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(count, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * count * 2, 28);
  out.writeUInt16LE(count * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(bytes, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      out.writeInt16LE(Math.round(x < 0 ? x * 32768 : x * 32767), offset);
      offset += 2;
    }
  }
  return out;
}

export function decodeWav(data: Buffer): { channels: Float32Array[]; sampleRate: number } {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let format = 0;
  let count = 0;
  let sampleRate = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = data.readUInt16LE(body);
      count = data.readUInt16LE(body + 2);
      sampleRate = data.readUInt32LE(body + 4);
      bits = data.readUInt16LE(body + 14);
      if (format === 0xfffe) format = data.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      if (!count) throw new Error('WAV data before its format');
      const bytesPer = bits / 8;
      const end = Math.min(body + size, data.length);
      const frames = Math.floor((end - body) / (bytesPer * count));
      const channels = Array.from({ length: count }, () => new Float32Array(frames));
      const read =
        format === 3
          ? bits === 32
            ? (o: number) => data.readFloatLE(o)
            : (o: number) => data.readDoubleLE(o)
          : bits === 8
            ? (o: number) => (data.readUInt8(o) - 128) / 128
            : bits === 16
              ? (o: number) => data.readInt16LE(o) / 32768
              : bits === 24
                ? (o: number) => data.readIntLE(o, 3) / 8388608
                : (o: number) => data.readInt32LE(o) / 2147483648;
      if (format !== 1 && format !== 3) throw new Error(`unsupported WAV format ${format}`);
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < count; c++) channels[c][i] = read(body + (i * count + c) * bytesPer);
      }
      return { channels, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data');
}
