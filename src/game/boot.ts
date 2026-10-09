// Boot: build the stage, audio, UI and input, load physics, then hand over to the director.

import { createAudioEngine } from '../audio';
import { Input } from '../input/input';
import { createStage } from '../render/stage';
import { loadRapier } from '../sim/rapier';
import { createBroadcastUI } from '../ui';
import { Game } from './game';
import { UpdateToast } from './toast';
import { registerServiceWorker, watchForUpdates } from './update';

export async function boot(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const root = document.getElementById('ui') as HTMLElement;
  const input = new Input();
  const audio = createAudioEngine();
  const ui = createBroadcastUI({ input, audio });
  ui.init(root);
  ui.loading(0.02, 'Sweeping the Box');

  // Mobile browsers only grant audio on a released tap or a key.
  const unlock = () => audio.unlock();
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true });

  const stage = createStage(canvas);
  window.addEventListener('resize', () => stage.resize());
  const [R] = await Promise.all([loadRapier(), stage.init((p) => ui.loading(0.05 + p * 0.9, 'Hanging the lights'))]);
  ui.loading(1, 'Ready');
  ui.loaded();

  const game = new Game(R, stage, audio, ui, input);
  const toast = new UpdateToast(root, input);
  game.onCalm = (calm) => toast.setCalm(calm);
  registerServiceWorker();
  watchForUpdates(() => toast.available());
  (window as unknown as { botbox: unknown }).botbox = { game, stage, audio, ui, input };
  await game.run();
}
