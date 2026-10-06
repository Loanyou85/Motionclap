import { describe, expect, it } from 'vitest';
import { lerpColor, opaqueHex, parseColor, toHex, toRgbaString, withAlpha } from '../color';

describe('couleurs', () => {
  it('analyse les formats hexadécimaux', () => {
    expect(parseColor('#1E5EFF')).toEqual({ r: 30, g: 94, b: 255, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#00000080').a).toBeCloseTo(0.502, 2);
  });

  it('analyse rgb() et rgba()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10,20,30,0.5)').a).toBe(0.5);
    expect(parseColor('none').a).toBe(0);
  });

  it('sérialise en hexadécimal', () => {
    expect(toHex({ r: 30, g: 94, b: 255, a: 1 })).toBe('#1E5EFF');
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
    expect(toRgbaString(parseColor('#1E5EFF'))).toBe('rgba(30, 94, 255, 1)');
  });

  it('interpole entre deux couleurs', () => {
    expect(lerpColor('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(lerpColor('#1E5EFF', '#0A1F44', 0)).toBe('#1E5EFF');
    expect(lerpColor('#1E5EFF', '#0A1F44', 1)).toBe('#0A1F44');
  });

  it('ne grise pas en passant par une couleur transparente', () => {
    const mid = parseColor(lerpColor('#FF000000', '#FF0000', 0.5));
    expect(mid.r).toBe(255);
    expect(mid.g).toBe(0);
    expect(mid.a).toBeCloseTo(0.5, 1);
  });

  it('manipule l’alpha', () => {
    expect(opaqueHex('#1E5EFF80')).toBe('#1E5EFF');
    expect(withAlpha('#1E5EFF', 0)).toBe('#1E5EFF00');
  });
});
