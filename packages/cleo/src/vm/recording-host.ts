/**
 * A recording `CleoHost` (the [[engine-fake-gpu-device]] philosophy: assert DECISIONS, not API
 * calls): every facet call appends one readable line to `calls`, and canned answers make the corpus
 * scripts take their happy path headless. Tests and `cleo-run` (plan 02) share this one mock —
 * the trace IS the story ("create 14645 at x,y,z · rotate …").
 */
import type { CleoHost } from './host.interface';

export interface RecordingHost extends CleoHost {
  readonly calls: string[];
}

export interface RecordingHostOptions {
  /** Answer for camera-distance checks (default true — scripts near-gate their work on it). */
  readonly cameraWithin?: boolean;
  /** Game hour (default 12). */
  readonly hour?: number;
  /** Model name → id for `GET_MODEL_BY_NAME` (default: every name resolves, ids assigned 20000+). */
  readonly knownModels?: ReadonlyMap<string, number>;
}

export function createRecordingHost(options: RecordingHostOptions = {}): RecordingHost {
  const calls: string[] = [];
  const record = (line: string): void => {
    calls.push(line);
  };
  const namedModels = new Map(options.knownModels ?? []);
  let nextNamedModel = 20000;
  let nextObject = 1;
  const objects = new Set<number>();
  const fixed = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(3));

  return {
    calls,
    models: {
      byName(name): null | number {
        if (!namedModels.has(name)) {
          if (options.knownModels) {
            record(`models.byName ${name} -> miss`);

            return null;
          }
          namedModels.set(name, nextNamedModel);
          nextNamedModel += 1;
        }
        const model = namedModels.get(name) ?? null;
        record(`models.byName ${name} -> ${model}`);

        return model;
      },
      info(model): number {
        record(`models.info ${model}`);

        return 0x1000 + model;
      },
      isAvailable(model): boolean {
        record(`models.isAvailable ${model} -> true`);

        return true;
      },
      markUnneeded(model): void {
        record(`models.markUnneeded ${model}`);
      },
      request(model): void {
        record(`models.request ${model}`);
      },
    },
    objects: {
      connectLods(near, far): void {
        record(`objects.connectLods ${near} ${far}`);
      },
      create(model, x, y, z): number {
        const handle = nextObject;
        nextObject += 1;
        objects.add(handle);
        record(`objects.create ${model} at ${fixed(x)},${fixed(y)},${fixed(z)} -> #${handle}`);

        return handle;
      },
      delete(handle): void {
        objects.delete(handle);
        record(`objects.delete #${handle}`);
      },
      exists(handle): boolean {
        return objects.has(handle);
      },
      getCoordinates(): readonly [number, number, number] {
        return [0, 0, 0];
      },
      offsetInWorldCoords(handle, x, y, z): readonly [number, number, number] {
        return [x, y, z];
      },
      setCoordinates(handle, x, y, z): void {
        record(`objects.setCoordinates #${handle} ${fixed(x)},${fixed(y)},${fixed(z)}`);
      },
      setHeading(handle, degrees): void {
        record(`objects.setHeading #${handle} ${fixed(degrees)}`);
      },
      setRotation(handle, rx, ry, rz): void {
        record(`objects.setRotation #${handle} ${fixed(rx)},${fixed(ry)},${fixed(rz)}`);
      },
    },
    onUnimplemented(opcode, thread): void {
      record(`onUnimplemented ${opcode.toString(16).toUpperCase().padStart(4, '0')} (${thread})`);
    },
    player: {
      charCoordinates(): readonly [number, number, number] {
        return [0, 0, 0];
      },
      isPlaying(): boolean {
        return true;
      },
      playerChar(): number {
        return 1;
      },
    },
    text: {
      printNow(text, ms): void {
        record(`text.printNow '${text}' ${ms}`);
      },
    },
    vehicles: {
      anyCar(): null {
        return null;
      },
      carInSphere(): null {
        return null;
      },
      carModel(): number {
        return 0;
      },
      driverOf(): null {
        return null;
      },
      isCharInAnyCar(): boolean {
        return false;
      },
      isCharInCar(): boolean {
        return false;
      },
      storeCarCharIsIn(): number {
        return -1;
      },
    },
    world: {
      cameraWithin(): boolean {
        return options.cameraWithin ?? true;
      },
      currentHour(): number {
        return options.hour ?? 12;
      },
      drawCorona(): void {
        // visual-only; the trace does not need every frame's corona
      },
      isGameVersionOriginal(): boolean {
        return true;
      },
      isPcVersion(): boolean {
        return true;
      },
      visibleArea(): number {
        return 0;
      },
    },
  };
}
