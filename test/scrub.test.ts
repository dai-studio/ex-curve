import { installScrub, scrubTarget, scrubValue, startValue } from '../src/app/scrub';

describe('scrubValue', () => {
  const none = { shift: false, alt: false };
  it('moves one step per 2px, either direction', () => {
    expect(scrubValue(10, 9, 1, none)).toBe(14);
    expect(scrubValue(10, -9, 1, none)).toBe(6);
  });
  it('applies Shift ×10 and Alt ×0.1 without float noise', () => {
    expect(scrubValue(10, 6, 1, { shift: true, alt: false })).toBe(40);
    expect(scrubValue(1, 6, 1, { shift: false, alt: true })).toBe(1.3);
    expect(scrubValue(0.1, 4, 0.1, none)).toBe(0.3);
  });
  it('clamps to min / max', () => {
    expect(scrubValue(50, 400, 5, none, 0, 100)).toBe(100);
    expect(scrubValue(3, -100, 1, none, 3)).toBe(3);
  });
});

describe('scrub targets', () => {
  it('finds the number input itself or the one inside a label', () => {
    document.body.innerHTML = '<label id="l"><span id="g">W</span><input id="n" type="number"></label><input id="t" type="text">';
    const n = document.getElementById('n');
    expect(scrubTarget(n)).toBe(n);
    expect(scrubTarget(document.getElementById('g'))).toBe(n);
    expect(scrubTarget(document.getElementById('l'))).toBe(n);
    expect(scrubTarget(document.getElementById('t'))).toBeNull();
  });
  it('starts from the value, else a numeric placeholder, else nothing', () => {
    const i = document.createElement('input');
    i.type = 'number';
    i.placeholder = '960';
    expect(startValue(i)).toBe(960);
    i.value = '12';
    expect(startValue(i)).toBe(12);
    i.value = '';
    i.placeholder = 'Mixed';
    expect(startValue(i)).toBeNull();
  });
});

describe('installScrub', () => {
  it('drags a value with input events and ends with one change; Esc restores', () => {
    document.body.innerHTML = '<div id="root"><label><span id="g">W</span><input id="n" type="number" step="1" value="10"></label></div>';
    const root = document.getElementById('root')!;
    const n = document.getElementById('n') as HTMLInputElement;
    const g = document.getElementById('g')!;
    const off = installScrub(root);
    const log: string[] = [];
    n.addEventListener('input', () => log.push(`input:${n.value}:${n.dataset.scrubbing ?? ''}`));
    n.addEventListener('change', () => log.push(`change:${n.value}`));
    // jsdom has no PointerEvent constructor: a MouseEvent with pointerId works for the handlers.
    const pe = (type: string, x: number) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 }), { pointerId: 1, pointerType: 'mouse' });
    g.dispatchEvent(pe('pointerdown', 100));
    document.dispatchEvent(pe('pointermove', 101)); // below the drag threshold
    document.dispatchEvent(pe('pointermove', 110));
    document.dispatchEvent(pe('pointerup', 110));
    expect(log).toEqual(['input:15:1', 'change:15']);
    expect(n.dataset.scrubbing).toBeUndefined();

    log.length = 0;
    g.dispatchEvent(pe('pointerdown', 100));
    document.dispatchEvent(pe('pointermove', 120));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(n.value).toBe('15');
    expect(log).toEqual(['input:25:1', 'input:15:1', 'change:15']);
    off();
  });
});
