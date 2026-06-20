import { useEffect, useState } from 'react';

let _count = 0;

export function startLoad() {
  _count++;
  window.dispatchEvent(new CustomEvent('rmg:loading', { detail: _count }));
}

export function endLoad() {
  _count = Math.max(0, _count - 1);
  window.dispatchEvent(new CustomEvent('rmg:loading', { detail: _count }));
}

export function useLoadingBar(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => setActive((e as CustomEvent<number>).detail > 0);
    window.addEventListener('rmg:loading', handler);
    return () => window.removeEventListener('rmg:loading', handler);
  }, []);
  return active;
}
