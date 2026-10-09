// "New version ready" toast. It only shows between fights (menus, garage, bracket), so a refresh
// never costs a fight in progress; an update found mid-fight waits for the result. A dismissed
// toast comes back for the next release.

import type { Input } from '../input/input';

export class UpdateToast {
  private el: HTMLElement | null = null;
  private ready = false;
  private dismissed = false;
  private calm = true;

  constructor(
    private root: HTMLElement,
    input: Input,
  ) {
    input.onAction((a) => {
      if (a === 'refresh' && this.el) location.reload();
    });
  }

  /** A newer version is live. */
  available(): void {
    this.ready = true;
    this.dismissed = false;
    this.sync();
  }

  /** The director says whether it is a safe moment to offer a refresh. */
  setCalm(calm: boolean): void {
    if (calm === this.calm) return;
    this.calm = calm;
    this.sync();
  }

  private sync(): void {
    const want = this.ready && !this.dismissed && this.calm;
    if (want && !this.el) {
      const el = document.createElement('div');
      el.className = 'update-toast';
      el.setAttribute('role', 'status');
      el.innerHTML = `
        <div class="update-toast__tag">NEW RELEASE</div>
        <div class="update-toast__text">A new version of BotBox is ready.</div>
        <button class="update-toast__go" type="button">Refresh <kbd>R</kbd></button>
        <button class="update-toast__close" type="button" aria-label="Dismiss">&times;</button>`;
      el.querySelector('.update-toast__go')!.addEventListener('click', () => location.reload());
      el.querySelector('.update-toast__close')!.addEventListener('click', () => {
        this.dismissed = true;
        this.sync();
      });
      this.root.append(el);
      requestAnimationFrame(() => el.classList.add('update-toast--in'));
      this.el = el;
    } else if (!want && this.el) {
      const el = this.el;
      this.el = null;
      el.classList.remove('update-toast--in');
      setTimeout(() => el.remove(), 300);
    }
  }
}
