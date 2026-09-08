/**
 * What the battery was doing while a window was measured (201/9, §6).
 *
 * **Every thermal argument in this chain has been made without a number.** *"The device had not moved"*,
 * *"it was not throttling"*, *"the baseline was re-flown so it cannot be heat"* — all of them rest on
 * re-flying a baseline rather than on a reading, because no capture in this repository has ever recorded
 * the battery, the charging state or the temperature. That is the §6 line this module closes on the app's
 * side; the panel closes the other half, because the browser has no temperature at all.
 *
 * **The field that decides most rows is `charging`, not the level.** A phone on the charger is a phone with
 * a different thermal envelope and a different governor, and two arms taken on opposite sides of a cable
 * are not an A/B — which nothing in a capture could say until now. `chargingChanged` is the same fact
 * inside one window: plugged in halfway through, the row is void for any claim about heat, and its own
 * numbers are the only evidence of it.
 *
 * **The level pair is deliberately modest.** Chrome reports `level` in whole percent, so a 60-second window
 * usually ends where it started and `levelStart − levelEnd` is 0 — that is the instrument's resolution and
 * not a battery figure. It is here for the LONG session ([4/02](../../../../docs/plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md)),
 * where a two-hour capture measures something real, and for the shape 4/01's render-on-demand claim owes:
 * a battery delta nobody recorded is a claim nobody can check.
 *
 * **Absent is a state, never a zero.** Firefox and Safari removed the API and the desk may not have a
 * battery at all, so an unsupported reading says `supported: false` and carries nulls — a report that
 * invented `level: 1` would be a phone at full charge that nobody measured.
 */

/** The live half of the Battery Status API — the two properties, and the event that says one moved. */
interface BatteryManager extends EventTarget {
  readonly charging: boolean;
  /** 0..1. Chrome quantizes this to whole percent, which is why a short window's delta is usually 0. */
  readonly level: number;
}

/**
 * `navigator.getBattery` where it exists.
 *
 * Declared here because TypeScript's DOM lib does not carry the Battery Status API at all — Chrome on
 * Android has it and two other engines removed it, so the honest type is an OPTIONAL method on the real
 * `Navigator` rather than a parallel shape a caller has to cast into.
 */
declare global {
  interface Navigator {
    getBattery?: () => Promise<BatteryManager>;
  }
}

/** What the monitor needs of a navigator — the one method, so a test can hand it an object literal. */
export interface NavigatorWithBattery {
  getBattery?: Navigator['getBattery'];
}

/** What a capture records about the power state it was taken under. */
export interface PowerReport {
  /** Whether the device was on a charger at report time. `null` when the API is absent. */
  readonly charging: boolean | null;
  /** Whether the charger came or went DURING the window — a row this is true on may not carry a thermal or
   *  battery claim, whatever its other fields say. */
  readonly chargingChanged: boolean;
  /** Battery level 0..1 at report time, and when the window opened. `null` when the API is absent. */
  readonly levelEnd: null | number;
  readonly levelStart: null | number;
  /** Whether the browser answered at all. False carries nulls rather than a fabricated full battery. */
  readonly supported: boolean;
}

/** What an unsupported browser reports — stated once, so no caller has to build it. */
const UNSUPPORTED: PowerReport = {
  charging: null,
  chargingChanged: false,
  levelEnd: null,
  levelStart: null,
  supported: false,
};

/**
 * Holds the battery for the life of a capture window.
 *
 * {@link PowerMonitor.attach} is fire-and-forget from boot: it resolves the manager once and never blocks a
 * frame. After that the two properties are LIVE, so {@link PowerMonitor.report} stays synchronous and can be
 * called from the same place every other report field is read.
 */
export class PowerMonitor {
  private battery: BatteryManager | null = null;
  private chargingChanged = false;
  private levelStart: null | number = null;

  constructor(private readonly source: NavigatorWithBattery) {}

  /** Resolve the battery, if this browser has one. Safe to call once; a rejection leaves it unsupported. */
  async attach(): Promise<void> {
    const getBattery = this.source.getBattery;
    if (!getBattery) {
      return;
    }
    try {
      const battery = await getBattery.call(this.source);
      this.battery = battery;
      this.levelStart = battery.level;
      // A window that crossed the cable is the one this whole block exists to catch, and it is invisible in
      // a pair of end-of-window readings: plugged in and unplugged again reads exactly like never plugged.
      battery.addEventListener('chargingchange', () => {
        this.chargingChanged = true;
      });
    } catch {
      // A browser that has the method and refuses it (a permissions policy, a headless profile) is the same
      // state as one without it: absent, and said so.
      this.battery = null;
    }
  }

  report(): PowerReport {
    const battery = this.battery;
    if (!battery) {
      return UNSUPPORTED;
    }

    return {
      charging: battery.charging,
      chargingChanged: this.chargingChanged,
      levelEnd: battery.level,
      levelStart: this.levelStart,
      supported: true,
    };
  }
}
