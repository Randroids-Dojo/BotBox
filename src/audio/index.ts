// Temporary silent engine until the audio module lands. Same factory name and contract.
import type { AudioEngine } from './types';

export function createAudioEngine(): AudioEngine {
  return {
    unlock() {},
    unlocked: false,
    setEntrants() {},
    frame() {},
    setWorldActive() {},
    setTimeScale() {},
    music() {},
    stinger() {},
    ui() {},
    voice: async () => false,
    voiceBusy: () => false,
    stopVoice() {},
    voiceIds: () => [],
    voiceLine: () => undefined,
    crowd() {},
    setVolumes() {},
  };
}
