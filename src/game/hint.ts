// Controls card for the countdown: what each button does for this robot, on this device.

import type { BotSpec } from '../contract';
import type { Device } from '../input/input';

const KEYS: Record<'keyboard' | 'gamepad', { drive: string; weapon: string; right: string; cam: string; pause: string }> = {
  keyboard: { drive: 'WASD', weapon: 'SPACE', right: 'E', cam: 'C', pause: 'ESC' },
  gamepad: { drive: 'L STICK', weapon: 'RT / A', right: 'B', cam: 'Y', pause: 'START' },
};

function weaponText(spec: BotSpec): string {
  switch (spec.weapon.kind) {
    case 'vdisk':
    case 'drum':
    case 'hbar':
    case 'shell':
      return 'Spin the weapon up (press again to coast)';
    case 'flipper':
      return `Fire the flipper (${spec.weapon.shots} shots of gas)`;
    case 'axe':
      return 'Swing the axe';
    case 'lifter':
      return 'Hold to lift, carry them to a hazard';
    default:
      return 'No weapon: shove them into the saws';
  }
}

export function showControls(root: HTMLElement, spec: BotSpec, device: Device, seconds = 6): void {
  root.querySelector('.ctl-card')?.remove();
  const touch = device === 'touch';
  const k = KEYS[device === 'gamepad' ? 'gamepad' : 'keyboard'];
  const rows: [string, string][] = touch
    ? [
        ['STICK', 'Drive (left thumb)'],
        ['WEAPON', weaponText(spec)],
        ...(spec.selfRight && !spec.invertible ? ([['RIGHT', 'Self-right when flipped']] as [string, string][]) : []),
        ['CAM', 'Change camera'],
      ]
    : [
        [k.drive, 'Drive'],
        [k.weapon, weaponText(spec)],
        ...(spec.selfRight && !spec.invertible ? ([[k.right, 'Self-right when flipped']] as [string, string][]) : []),
        [k.cam, 'Change camera'],
        [k.pause, 'Pause or tap out'],
      ];
  const el = document.createElement('div');
  el.className = 'ctl-card';
  el.innerHTML =
    `<div class="ctl-card__tag">YOUR CONTROLS</div>` +
    rows.map(([key, what]) => `<div class="ctl-card__row"><kbd>${key}</kbd><span>${what}</span></div>`).join('');
  root.append(el);
  requestAnimationFrame(() => el.classList.add('ctl-card--in'));
  setTimeout(() => {
    el.classList.remove('ctl-card--in');
    setTimeout(() => el.remove(), 400);
  }, seconds * 1000);
}
