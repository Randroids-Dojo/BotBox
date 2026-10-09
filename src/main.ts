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
  void import('./game/boot').then((m) => m.boot());
}
