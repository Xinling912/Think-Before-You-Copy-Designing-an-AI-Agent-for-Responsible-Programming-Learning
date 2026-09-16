import { describe, expect, it } from 'vitest';
import { publicHttpsURL } from './publicHttps';

describe('publicHttpsURL', () => {
  it('upgrades public http URLs and leaves local development unchanged', () => {
    expect(publicHttpsURL({ protocol: 'http:', hostname: 'tokisaka23.nat100.top', host: 'tokisaka23.nat100.top', pathname: '/om', search: '', hash: '' })).toBe('https://tokisaka23.nat100.top/om');
    expect(publicHttpsURL({ protocol: 'http:', hostname: 'localhost', host: 'localhost:8080', pathname: '/', search: '', hash: '' })).toBeUndefined();
    expect(publicHttpsURL({ protocol: 'https:', hostname: 'tokisaka23.nat100.top', host: 'tokisaka23.nat100.top', pathname: '/', search: '', hash: '' })).toBeUndefined();
  });
});
