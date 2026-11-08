import { History } from '../src/engine/history';

const el = () => document.createElementNS('http://www.w3.org/2000/svg', 'rect');

describe('History state ids', () => {
  it('starts at 0 and returns to the same id after undo', () => {
    const h = new History();
    const r = el();
    expect(h.stateId).toBe(0);
    r.setAttribute('x', '1');
    h.pushAttr('Move', [{ el: r, before: { x: null }, after: { x: '1' } }]);
    const a = h.stateId;
    expect(a).toBeGreaterThan(0);
    r.setAttribute('x', '2');
    h.pushAttr('Move', [{ el: r, before: { x: '1' }, after: { x: '2' } }]);
    expect(h.stateId).not.toBe(a);
    h.undo();
    expect(h.stateId).toBe(a);
    expect(r.getAttribute('x')).toBe('1');
    h.undo();
    expect(h.stateId).toBe(0);
    h.redo();
    expect(h.stateId).toBe(a);
  });

  it('drops no-op patches and exposes labels', () => {
    const h = new History();
    h.pushAttr('Nothing', [{ el: el(), before: { x: '1' }, after: { x: '1' } }]);
    expect(h.canUndo).toBe(false);
    h.pushAttr('Move', [{ el: el(), before: { x: '1' }, after: { x: '2' } }]);
    expect(h.undoLabel).toBe('Move');
    h.undo();
    expect(h.redoLabel).toBe('Move');
  });
});
