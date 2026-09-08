import { describe, expect, it } from 'vitest';

import { PowerMonitor } from './power';

/** A battery whose two properties move, and which fires the one event the monitor listens for. */
function fakeBattery(level: number, charging: boolean): EventTarget & { charging: boolean; level: number } {
  const target = new EventTarget() as EventTarget & { charging: boolean; level: number };
  target.charging = charging;
  target.level = level;

  return target;
}

describe('PowerMonitor', () => {
  describe('negative cases', () => {
    it('reports absent rather than a full battery nobody measured', async () => {
      const monitor = new PowerMonitor({});
      await monitor.attach();

      expect(monitor.report()).toEqual({
        charging: null,
        chargingChanged: false,
        levelEnd: null,
        levelStart: null,
        supported: false,
      });
    });

    it('treats a browser that refuses the call as absent, not as an error a boot has to handle', async () => {
      const monitor = new PowerMonitor({ getBattery: (): Promise<never> => Promise.reject(new Error('policy')) });
      await monitor.attach();

      expect(monitor.report().supported).toBe(false);
    });

    it('reports nothing before attach has resolved', () => {
      const battery = fakeBattery(0.5, false);
      const monitor = new PowerMonitor({ getBattery: (): Promise<typeof battery> => Promise.resolve(battery) });

      expect(monitor.report().supported).toBe(false);
    });

    it('says the charger moved DURING the window, which a pair of end readings cannot', async () => {
      const battery = fakeBattery(0.5, false);
      const monitor = new PowerMonitor({ getBattery: (): Promise<typeof battery> => Promise.resolve(battery) });
      await monitor.attach();

      // Plugged in and unplugged again: both readings say `false`, and the window is still not comparable.
      battery.charging = true;
      battery.dispatchEvent(new Event('chargingchange'));
      battery.charging = false;
      battery.dispatchEvent(new Event('chargingchange'));

      expect(monitor.report()).toMatchObject({ charging: false, chargingChanged: true });
    });
  });

  describe('positive cases', () => {
    it('records the level the window opened at and the one it ended at', async () => {
      const battery = fakeBattery(0.62, false);
      const monitor = new PowerMonitor({ getBattery: (): Promise<typeof battery> => Promise.resolve(battery) });
      await monitor.attach();
      battery.level = 0.61;

      expect(monitor.report()).toEqual({
        charging: false,
        chargingChanged: false,
        levelEnd: 0.61,
        levelStart: 0.62,
        supported: true,
      });
    });

    it('says the device was on a charger, which is the field most rows are decided by', async () => {
      const battery = fakeBattery(1, true);
      const monitor = new PowerMonitor({ getBattery: (): Promise<typeof battery> => Promise.resolve(battery) });
      await monitor.attach();

      expect(monitor.report()).toMatchObject({ charging: true, chargingChanged: false, supported: true });
    });
  });
});
