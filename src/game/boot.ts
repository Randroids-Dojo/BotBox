// The game director boots here. Filled in by the lead once the modules land.
export async function boot(): Promise<void> {
  document.getElementById('ui')!.innerHTML =
    '<div style="position:absolute;inset:0;display:grid;place-items:center;font:700 32px system-ui;letter-spacing:.2em">BOTBOX</div>';
}
