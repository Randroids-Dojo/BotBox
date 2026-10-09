"""Spectral and timing checks on rendered WAVs (16-bit PCM from tools/render.ts).

  python3 src/audio/tools/analyze.py spectrum FILE [FILE ...]     band energy, centroid, harmonics
  python3 src/audio/tools/analyze.py onsets FILE BPM [OFFSET]     onset alignment to the 16th grid
  python3 src/audio/tools/analyze.py seam FILE AT                 level step around a time (crossfade)
  python3 src/audio/tools/analyze.py levels FILE [WIN]            short-term RMS curve

Needs numpy only.
"""
import struct
import sys

import numpy as np


def read(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:4] == b'RIFF' and data[8:12] == b'WAVE'
    pos = 12
    ch = rate = None
    while pos < len(data):
        cid, size = data[pos:pos + 4], struct.unpack('<I', data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            _, ch, rate = struct.unpack('<HHI', body[:8])
        elif cid == b'data':
            x = np.frombuffer(body, dtype='<i2').astype(np.float64) / 32768.0
            return x.reshape(-1, ch), rate
        pos += 8 + size
    raise ValueError('no data')


BANDS = [(20, 100), (100, 500), (500, 2000), (2000, 5000), (5000, 10000), (10000, 20000)]


def spectrum(path):
    x, rate = read(path)
    m = x.mean(axis=1)
    n = 1 << int(np.floor(np.log2(min(len(m), rate * 4))))
    # Average power spectrum over windows.
    hop = n // 2
    acc = None
    count = 0
    w = np.hanning(n)
    for i in range(0, max(1, len(m) - n), hop):
        seg = m[i:i + n]
        if len(seg) < n:
            break
        p = np.abs(np.fft.rfft(seg * w)) ** 2
        acc = p if acc is None else acc + p
        count += 1
    if acc is None:
        seg = np.pad(m, (0, n - len(m)))
        acc = np.abs(np.fft.rfft(seg * w)) ** 2
        count = 1
    p = acc / count
    f = np.fft.rfftfreq(n, 1 / rate)
    total = p[(f >= 20)].sum() + 1e-20
    bands = []
    for lo, hi in BANDS:
        e = p[(f >= lo) & (f < hi)].sum()
        bands.append(10 * np.log10(e / total + 1e-20))
    cen = (f * p).sum() / (p.sum() + 1e-20)
    # Strongest peaks below 3 kHz, to see a harmonic series.
    sel = (f > 30) & (f < 3000)
    pf, pp = f[sel], p[sel]
    peaks = []
    for i in np.argsort(pp)[::-1]:
        if all(abs(pf[i] - q) > 12 for q, _ in peaks):
            peaks.append((pf[i], 10 * np.log10(pp[i] / pp.max())))
        if len(peaks) >= 8:
            break
    peaks.sort()
    rms = 20 * np.log10(np.sqrt((m ** 2).mean()) + 1e-12)
    print(f'{path.split("/")[-1]:42s} rms {rms:6.1f}  centroid {cen:6.0f} Hz  bands(dB of total) ' + ' '.join(f'{lo}-{hi}:{b:5.1f}' for (lo, hi), b in zip(BANDS, bands)))
    print('    peaks: ' + ', '.join(f'{a:.0f}Hz({b:.0f})' for a, b in peaks))


def onsets(path, bpm, offset=0.0):
    x, rate = read(path)
    m = np.abs(x.mean(axis=1))
    hop = int(rate * 0.005)
    env = np.array([m[i:i + hop].max() for i in range(0, len(m) - hop, hop)])
    db = 20 * np.log10(env + 1e-9)
    # Onsets: rise of more than 9 dB over 20 ms.
    on = []
    for i in range(4, len(db)):
        if db[i] - db[i - 4] > 9 and db[i] > -40 and (not on or i * hop / rate - on[-1] > 0.06):
            on.append(i * hop / rate)
    step = 60 / bpm / 4
    errs = [((t - offset) / step - round((t - offset) / step)) * step * 1000 for t in on]
    errs = np.array(errs) if errs else np.zeros(1)
    print(f'{path.split("/")[-1]}: {len(on)} onsets, grid error ms: mean {np.mean(np.abs(errs)):.1f}, 95th {np.percentile(np.abs(errs), 95):.1f}, max {np.max(np.abs(errs)):.1f}')


def seam(path, at):
    x, rate = read(path)
    m = x.mean(axis=1)
    win = int(rate * 0.05)
    levels = []
    for k in range(-40, 40):
        i = int((at + k * 0.05) * rate)
        seg = m[i:i + win]
        levels.append(20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9))
    steps = np.abs(np.diff(levels))
    print(f'{path.split("/")[-1]}: 50 ms RMS steps around {at}s: max {steps.max():.1f} dB, near seam {steps[36:44].max():.1f} dB; before {np.mean(levels[:35]):.1f} dB after {np.mean(levels[45:]):.1f} dB')
    # Discontinuity: largest sample to sample jump near the seam vs elsewhere.
    i0, i1 = int((at - 0.2) * rate), int((at + 0.2) * rate)
    jump = np.abs(np.diff(m[i0:i1])).max()
    ref = np.abs(np.diff(m)).max()
    print(f'    max sample step near seam {jump:.3f}, whole file {ref:.3f}')


def dyn(path, win=0.1):
    """Short-term RMS percentiles: the bed (p10, p50) against the events (p95, p99)."""
    x, rate = read(path)
    m = x.mean(axis=1)
    n = int(rate * win)
    v = np.array([20 * np.log10(np.sqrt((m[i:i + n] ** 2).mean()) + 1e-9) for i in range(0, len(m) - n + 1, n)])
    v = v[v > -100]
    p = np.percentile(v, [10, 50, 90, 95, 99])
    print(f'{path.split("/")[-1]}: {int(win * 1000)} ms RMS p10 {p[0]:.1f}  p50 {p[1]:.1f}  p90 {p[2]:.1f}  p95 {p[3]:.1f}  p99 {p[4]:.1f}  (events over bed: {p[4] - p[1]:.1f} dB)')


def levels(path, win=1.0):
    x, rate = read(path)
    m = x.mean(axis=1)
    n = int(rate * win)
    out = []
    for i in range(0, len(m) - n + 1, n):
        seg = m[i:i + n]
        out.append(20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9))
    print(f'{path.split("/")[-1]}: ' + ' '.join(f'{v:.0f}' for v in out))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'spectrum':
        for p in sys.argv[2:]:
            spectrum(p)
    elif cmd == 'onsets':
        onsets(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]) if len(sys.argv) > 4 else 0.0)
    elif cmd == 'seam':
        seam(sys.argv[2], float(sys.argv[3]))
    elif cmd == 'dyn':
        for p in sys.argv[2:]:
            dyn(p)
    elif cmd == 'levels':
        levels(sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
