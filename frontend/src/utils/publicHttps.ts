type PublicLocation = Pick<Location, 'protocol' | 'hostname' | 'host' | 'pathname' | 'search' | 'hash'>;

export function publicHttpsURL(location: PublicLocation): string | undefined {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
  if (location.protocol !== 'http:' || local) {
    return undefined;
  }
  return `https://${location.host}${location.pathname}${location.search}${location.hash}`;
}
