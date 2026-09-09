import { describe, expect, it } from 'vitest';

import { parseVehicleAudioSettings, VEHICLE_AUDIO_COLUMNS } from './vehicle-audio.parser';

/**
 * `landstal` — the FIRST entry of the game's own compiled table, transcribed field by field.
 *
 * `AE_CAR`(0), `SND_BANK_GENRL_PATHFINDER_P`(99), `SND_BANK_GENRL_PATHFINDER_D`(98), `NORMAL`(0), 0.78, 1.0,
 * `PICKUP`(7), 1.0, `NEW`(2), 0, `RADIO_NEW_JACK_SWING`(8), `AE_RT_CIVILIAN`(0), `AE_VAT_OFFROAD`(0), 0.0 —
 * every id looked up in gta-reversed's own enums rather than guessed, so this fixture is the real thing
 * rather than a plausible one.
 */
const LANDSTAL = 'landstal 0 99 98 0 0.78 1.0 7 1.0 2 0 8 0 0 0.0';

/** An added vehicle's row, as `vehicle-installer` writes one. */
const ADDED = '106veh 9 -1 -1 0 0.7 1.0 -1 1.0 -1 0 13 1 -1 0.0';

describe('parseVehicleAudioSettings', () => {
  describe('negative cases', () => {
    it('drops a row with the wrong column count and names both counts', () => {
      const { problems, rows } = parseVehicleAudioSettings('landstal 0 17 16');

      expect(rows).toHaveLength(0);
      expect(problems).toHaveLength(1);
      expect(problems[0]?.reason).toContain(`${VEHICLE_AUDIO_COLUMNS} columns, this one has 4`);
      expect(problems[0]?.line).toBe(1);
    });

    it('drops a row with a field that is not a number, naming the column', () => {
      const { problems, rows } = parseVehicleAudioSettings(LANDSTAL.replace('0.78', 'loud'));

      expect(rows).toHaveLength(0);
      expect(problems[0]?.reason).toContain("column 6 ('loud')");
    });

    it('reads -1 as ABSENT rather than as an id, everywhere the file uses it that way', () => {
      const [row] = parseVehicleAudioSettings(ADDED).rows;

      expect(row).toMatchObject({ dummyBank: null, hornSound: null, playerBank: null });
    });

    it('keeps a row whose sound type the game has no name for, and says so', () => {
      const { problems, rows } = parseVehicleAudioSettings(LANDSTAL.replace(/^landstal 0/u, 'landstal 42'));

      expect(rows[0]).toMatchObject({ soundType: 'unknown' });
      expect(problems[0]?.reason).toContain('sound type 42');
    });

    it('takes the LAST row for a model and reports the one it shadowed', () => {
      const { problems, rows } = parseVehicleAudioSettings(`${LANDSTAL}\n${LANDSTAL.replace('0.78', '0.9')}`);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.bassFactor).toBe(0.9);
      expect(problems[0]?.reason).toContain('set more than once');
    });

    it('is an empty table rather than a throw when the file is only its legend', () => {
      expect(parseVehicleAudioSettings('; A B C\n\n;the end\n')).toEqual({ problems: [], rows: [] });
    });
  });

  describe('positive cases', () => {
    it('reads a stock row into the fourteen fields of the struct it mirrors', () => {
      const [row] = parseVehicleAudioSettings(LANDSTAL).rows;

      expect(row).toEqual({
        bassFactor: 0.78,
        bassSetting: 'normal',
        doorType: 'new',
        dummyBank: 98,
        enginePitch: 1,
        engineUpgrade: 0,
        engineVolumeOffset: 0,
        hornPitch: 1,
        hornSound: 7,
        model: 'landstal',
        playerBank: 99,
        radioStation: 8,
        radioType: 'civilian',
        soundType: 'car',
        typeForName: 0,
      });
    });

    it('reads an added vehicle the installer wrote', () => {
      const [row] = parseVehicleAudioSettings(ADDED).rows;

      expect(row).toMatchObject({
        bassFactor: 0.7,
        model: '106veh',
        radioStation: 13,
        radioType: 'special',
        soundType: 'special',
      });
    });

    it('ignores `;` comments and blank lines, and counts the LINE a problem was on', () => {
      const text = `; the legend\n\n${LANDSTAL}\n; ----- added vehicles -----\nbroken 1 2\n`;
      const { problems, rows } = parseVehicleAudioSettings(text);

      expect(rows).toHaveLength(1);
      expect(problems[0]?.line).toBe(5);
    });

    it('is case-insensitive on the model, because the loader matches by name', () => {
      const [row] = parseVehicleAudioSettings(LANDSTAL.replace('landstal', 'LandStal')).rows;

      expect(row?.model).toBe('landstal');
    });

    it('splits on commas as well as whitespace, the way the game splits every data row', () => {
      const [row] = parseVehicleAudioSettings(LANDSTAL.replace(/ /gu, ', ')).rows;

      expect(row?.model).toBe('landstal');
      expect(row?.dummyBank).toBe(98);
    });

    it('carries the volume offset a truck authors, positive and in dB', () => {
      const [row] = parseVehicleAudioSettings(LANDSTAL.replace(/0\.0$/u, '6.0')).rows;

      expect(row?.engineVolumeOffset).toBe(6);
    });
  });
});
