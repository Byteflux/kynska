// Stands in for @strudel/webaudio when the soundfont loader is loaded from the
// pinned Strudel source: superdough (the npm 1.2.6 build Kynska renders with)
// plus two helpers that source expects and that build lacks.
export * from 'superdough';

/** Calls `callback` once when the source node stops playing. */
export function onceEnded(node: AudioScheduledSourceNode, callback: () => void): void {
  node.addEventListener('ended', () => callback(), { once: true });
}

/** Disconnects a node that has finished, so it can be collected. */
export function releaseAudioNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // already disconnected
  }
}
