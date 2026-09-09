import { describe, expect, it, vi } from 'vitest';

import type { AudioContextLike, GestureTarget } from './audio-host.interface';

import { AudioHost } from './audio-host';
import { FakeAudioContext } from './test/fake-context';

/** A gesture target that counts what is listening to it, so "attached once" is assertable. */
class FakeTarget implements GestureTarget {
  get listenerCount(): number {
    return [...this.handlers.values()].reduce((total, set) => total + set.size, 0);
  }

  private readonly handlers = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const set = this.handlers.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.handlers.set(type, set);
  }

  fire(type: string): void {
    for (const listener of [...(this.handlers.get(type) ?? [])]) {
      listener();
    }
  }

  removeEventListener(type: string, listener: () => void): void {
    this.handlers.get(type)?.delete(listener);
  }
}

/** Let the gesture handler's fire-and-forget `resume` settle before anything is asserted. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('AudioHost', () => {
  describe('negative cases', () => {
    it('reports an environment with no Web Audio as unsupported, with ONE line and no throw', () => {
      const log = vi.fn();

      const host = new AudioHost({
        createContext: (): AudioContextLike => {
          throw new Error('this environment has no AudioContext');
        },
        log,
      });

      expect(host.state.availability).toBe('unsupported');
      expect(host.audioContext).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toMatch(/no audio on this surface/u);
    });

    it('lets every call through on an unsupported host rather than making callers branch', async (): Promise<void> => {
      const host = new AudioHost({
        createContext: (): AudioContextLike => {
          throw new Error('nope');
        },
        log: vi.fn(),
      });
      const target = new FakeTarget();

      const detach = host.attachGestures(target);
      await host.resume();
      await host.suspend();
      await host.dispose();
      detach();

      expect(target.listenerCount).toBe(0);
      expect(host.state.resumeAttempts).toBe(0);
    });

    it('COUNTS a refused resume and keeps the gesture wired, since the page can still be woken', async (): Promise<void> => {
      // The failure this separates: a browser that turned the gesture down looks exactly like a page nobody
      // has touched, and a host that unsubscribed on the first attempt could never be woken again.
      const context = new FakeAudioContext();
      context.refuseResume = true;
      const log = vi.fn();
      const host = new AudioHost({ createContext: (): AudioContextLike => context, log });
      const target = new FakeTarget();
      host.attachGestures(target);

      target.fire('pointerdown');
      await settle();

      expect(host.state.availability).toBe('waiting');
      expect(host.state.resumeAttempts).toBe(1);
      expect(host.state.resumesRefused).toBe(1);
      expect(target.listenerCount).toBe(2);
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('refuses to resume once disposed, and disposing twice is not an error', async (): Promise<void> => {
      const context = new FakeAudioContext();
      const host = new AudioHost({ createContext: (): AudioContextLike => context });

      await host.dispose();
      await host.dispose();
      await host.resume();

      expect(host.state.availability).toBe('closed');
      expect(host.state.resumeAttempts).toBe(0);
    });

    it('survives a context that refuses to close', async (): Promise<void> => {
      const context = new FakeAudioContext();
      context.close = (): Promise<void> => Promise.reject(new Error('already torn down'));
      const host = new AudioHost({ createContext: (): AudioContextLike => context });

      await expect(host.dispose()).resolves.toBeUndefined();
      expect(host.state.availability).toBe('closed');
    });
  });

  describe('positive cases', () => {
    it('starts suspended and says it is waiting for a touch, carrying the rate', () => {
      const host = new AudioHost({ createContext: (): AudioContextLike => new FakeAudioContext() });

      expect(host.state).toEqual({
        availability: 'waiting',
        resumeAttempts: 0,
        resumesRefused: 0,
        sampleRate: 48_000,
      });
    });

    it('READS a context that is already running rather than assuming it is not', () => {
      const context = new FakeAudioContext();
      context.state = 'running';

      const host = new AudioHost({ createContext: (): AudioContextLike => context });

      expect(host.state.availability).toBe('running');
    });

    it('wakes on the first pointer gesture and drops the listeners once sound is on', async (): Promise<void> => {
      const host = new AudioHost({ createContext: (): AudioContextLike => new FakeAudioContext() });
      const target = new FakeTarget();
      host.attachGestures(target);

      target.fire('pointerdown');
      await settle();

      expect(host.state.availability).toBe('running');
      expect(host.state.resumeAttempts).toBe(1);
      expect(target.listenerCount).toBe(0);
    });

    it('wakes on a key too — the keyboard half of the cross-platform rule', async (): Promise<void> => {
      const host = new AudioHost({ createContext: (): AudioContextLike => new FakeAudioContext() });
      const target = new FakeTarget();
      host.attachGestures(target);

      target.fire('keydown');
      await settle();

      expect(host.state.availability).toBe('running');
    });

    it('attaches once however many times it is asked, so a remount cannot double the wiring', async (): Promise<void> => {
      const host = new AudioHost({ createContext: (): AudioContextLike => new FakeAudioContext() });
      const target = new FakeTarget();

      host.attachGestures(target);
      host.attachGestures(target);

      expect(target.listenerCount).toBe(2);
      target.fire('pointerdown');
      await settle();
      expect(host.state.resumeAttempts).toBe(1);
    });

    it('tells `suspended` from `waiting` — one ran and stopped, the other never started', async (): Promise<void> => {
      const host = new AudioHost({ createContext: (): AudioContextLike => new FakeAudioContext() });

      await host.resume();
      await host.suspend();

      expect(host.state.availability).toBe('suspended');
    });

    it('notifies a subscriber when the state moves, and not when it does not', async (): Promise<void> => {
      const host = new AudioHost({ createContext: (): AudioContextLike => new FakeAudioContext() });
      const seen: string[] = [];
      const stop = host.subscribe((state) => seen.push(state.availability));

      await host.resume();
      await host.resume();
      stop();
      await host.suspend();

      // Two resumes, two readings: the second changes `resumeAttempts` even though the availability holds,
      // which is a real move and not a duplicate. Nothing after `stop()`.
      expect(seen).toEqual(['running', 'running']);
    });

    it('detaches on request, and a detached target no longer wakes it', async (): Promise<void> => {
      const host = new AudioHost({ createContext: (): AudioContextLike => new FakeAudioContext() });
      const target = new FakeTarget();

      const detach = host.attachGestures(target);
      detach();
      target.fire('pointerdown');
      await settle();

      expect(target.listenerCount).toBe(0);
      expect(host.state.availability).toBe('waiting');
    });
  });
});
