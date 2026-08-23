import { describe, expect, it, vi } from 'vitest';

import { buildJob, JobRunner } from './jobs.mjs';

/** A runner over this repository, collecting what it printed. */
function runner() {
  const lines = [];

  return { lines, runner: new JobRunner({ cwd: process.cwd(), onLine: (line) => lines.push(line) }) };
}

/** A job that prints and exits, and one that stays up — both plain node, so the test needs no fixtures. */
const PRINTS = {
  args: ['-e', "console.log('from the job')"],
  command: 'node',
  dropped: [],
  env: {},
  id: 'test-print',
  label: 'print',
  long: false,
};
const STAYS = {
  args: ['-e', 'setInterval(() => {}, 1000)'],
  command: 'node',
  dropped: [],
  env: {},
  id: 'test-stay',
  label: 'stay',
  long: true,
};

describe('phone console jobs', () => {
  describe('negative cases', () => {
    it('refuses a job it does not have, and names the ones it does', () => {
      expect(() => buildJob('rm-rf')).toThrow(/unknown job 'rm-rf' — known: districts, phone, pull, setup/);
    });

    it('drops a knob that is not this job DIRECTLY rather than passing it on', () => {
      // A shell script ignores an env var it does not read, silently. Here the page is told.
      const plan = buildJob('phone', { DISTRICT: 'ganton', NOT_A_KNOB: '1' });

      expect(plan.env).toEqual({ DISTRICT: 'ganton' });
      expect(plan.dropped).toEqual(['NOT_A_KNOB (not a knob of this job)']);
    });

    it('drops a value that is not the shape the knob takes', () => {
      const plan = buildJob('phone', { RECT: '8;-8;11;-5', TEXTURES: 'jpeg' });

      expect(plan.env).toEqual({});
      expect(plan.dropped).toEqual([
        'RECT=8;-8;11;-5 (not the shape RECT takes)',
        'TEXTURES=jpeg (not the shape TEXTURES takes)',
      ]);
    });

    it('carries no env at all into a job that has no knobs', () => {
      expect(buildJob('pull', { DISTRICT: 'ganton' })).toMatchObject({
        dropped: ['DISTRICT (not a knob of this job)'],
        env: {},
      });
    });

    it('refuses a second job while one is running, and names the one that is', async () => {
      const { runner: jobs } = runner();
      jobs.start(STAYS);

      expect(() => jobs.start(PRINTS)).toThrow(/'test-stay' is still running/);
      jobs.stop();
      await vi.waitFor(() => expect(jobs.status().running).toBe(false));
    });
  });

  describe('positive cases', () => {
    it('builds the phone run out of the form', () => {
      const plan = buildJob('phone', {
        DISTRICT: 'los-santos-centre',
        MODELS: '0',
        OUT: './build/phone-ls',
        TEXTURES: 'rgba8',
      });

      expect(plan.command).toBe('npm');
      expect(plan.args).toEqual(['run', 'phone']);
      expect(plan.env).toEqual({
        DISTRICT: 'los-santos-centre',
        MODELS: '0',
        OUT: './build/phone-ls',
        TEXTURES: 'rgba8',
      });
      expect(plan.long).toBe(true);
    });

    it('ignores an empty field instead of passing an empty value down', () => {
      expect(buildJob('phone', { DISTRICT: '  ', TEXTURES: 'astc' }).env).toEqual({ TEXTURES: 'astc' });
    });

    it('keeps what a job printed, so a page that reconnects still sees it', async () => {
      const { lines, runner: jobs } = runner();
      jobs.start(PRINTS);
      await vi.waitFor(() => expect(jobs.status().running).toBe(false));

      expect(lines.some((line) => line.includes('from the job'))).toBe(true);
      expect(jobs.backlog().some((line) => line.startsWith('$ node'))).toBe(true);
      expect(jobs.backlog().some((line) => line.includes('finished'))).toBe(true);
    });

    it('caps the buffer so a long convert cannot grow without bound', () => {
      const jobs = new JobRunner({ cwd: process.cwd(), onLine: () => undefined, ringLines: 3 });
      for (const line of ['a', 'b', 'c', 'd', 'e']) {
        jobs.push(line);
      }

      expect(jobs.backlog()).toEqual(['c', 'd', 'e']);
    });

    it('says nothing is running when nothing is', () => {
      expect(runner().runner.status()).toEqual({ running: false });
      expect(runner().runner.stop()).toEqual({ running: false });
    });
  });
});
