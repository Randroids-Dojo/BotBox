// Placeholder boot until the stage and audio modules land. Offers updates like the real one.
import { Input } from '../input/input';
import { UpdateToast } from './toast';
import { registerServiceWorker, watchForUpdates } from './update';

export async function boot(): Promise<void> {
  const root = document.getElementById('ui')!;
  root.innerHTML =
    '<div style="position:absolute;inset:0;display:grid;place-items:center;font:700 32px system-ui;letter-spacing:.2em">BOTBOX</div>';
  const toast = new UpdateToast(root, new Input());
  registerServiceWorker();
  watchForUpdates(() => toast.available());
}
