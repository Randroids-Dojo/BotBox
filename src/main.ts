// Entry. `?lab=<name>` opens a module workbench from src/dev/lab-<name>.ts; otherwise the game.
import './styles.css';

const labs = import.meta.glob('./dev/lab-*.ts');
const lab = new URLSearchParams(location.search).get('lab');

if (lab) {
  const load = labs[`./dev/lab-${lab}.ts`];
  if (!load) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<pre style="position:fixed;top:12px;left:12px;color:#fff">No lab "${lab}". Labs: ${Object.keys(labs)
        .map((k) => k.replace('./dev/lab-', '').replace('.ts', ''))
        .join(', ')}</pre>`,
    );
  } else {
    void load();
  }
} else {
  // A page opened while a release is going out can ask for chunks that are not there yet (or are
  // gone). Reload once to pick up a consistent build instead of showing a dead screen.
  const KEY = 'botbox:chunk-reload';
  const retry = () => {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
    location.reload();
  };
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    retry();
  });
  import('./game/boot').then(
    (m) => {
      // Loaded fine: allow a future retry after the game has been up for a while.
      setTimeout(() => sessionStorage.removeItem(KEY), 15000);
      m.boot().catch((err) => console.error(err));
    },
    (err) => {
      console.error(err);
      retry();
    },
  );
}
