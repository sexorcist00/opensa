/**
 * Layer A (plan 097/01 decision 1): the type-byte operand reader. Every operand in an SA `.cs` stream
 * is one data-type byte followed by a correctly sized payload; this file turns that byte into a typed
 * value on a plain little-endian cursor. Pure — no opcode knowledge, no DB.
 *
 * The union is LOSSLESS: `type` keeps the raw data-type byte, so width (int8/16/32), string form
 * (fixed 8/16, length-prefixed) and string-variable kinds all survive into disassembly/re-encode.
 */
import type { Cursor } from './cursor';

export type Operand =
  /** Array element ref: `offset` (var-space base), the index variable, element size, packed flags. */
  | {
      readonly elemSize: number;
      readonly flags: number;
      readonly indexVar: number;
      readonly kind: 'array';
      readonly offset: number;
      readonly scope: VarScope;
      readonly type: number;
    }
  | { readonly index: number; readonly kind: 'var'; readonly scope: VarScope; readonly type: number }
  | { readonly kind: 'float'; readonly type: number; readonly value: number }
  | { readonly kind: 'int'; readonly type: number; readonly value: number }
  | { readonly kind: 'string'; readonly type: number; readonly value: string };

export type VarScope = 'global' | 'local';

/** Data-type bytes (the full set the corpus contains — plan 097/01 decision 1). */
export const TYPE_END = 0x00;
const TYPE_INT32 = 0x01;
const TYPE_GLOBAL_VAR = 0x02;
const TYPE_LOCAL_VAR = 0x03;
const TYPE_INT8 = 0x04;
const TYPE_INT16 = 0x05;
const TYPE_FLOAT32 = 0x06;
const TYPE_GLOBAL_ARRAY = 0x07;
const TYPE_LOCAL_ARRAY = 0x08;
const TYPE_STRING8 = 0x09;
const TYPE_GLOBAL_VAR_STRING8 = 0x0a;
const TYPE_LOCAL_VAR_STRING8 = 0x0b;
const TYPE_GLOBAL_ARRAY_STRING8 = 0x0c;
const TYPE_LOCAL_ARRAY_STRING8 = 0x0d;
const TYPE_STRING_VARLEN = 0x0e;
const TYPE_STRING16 = 0x0f;
const TYPE_GLOBAL_VAR_STRING16 = 0x10;
const TYPE_LOCAL_VAR_STRING16 = 0x11;
const TYPE_GLOBAL_ARRAY_STRING16 = 0x12;
const TYPE_LOCAL_ARRAY_STRING16 = 0x13;

const GLOBAL_VARS = new Set([TYPE_GLOBAL_VAR, TYPE_GLOBAL_VAR_STRING8, TYPE_GLOBAL_VAR_STRING16]);
const LOCAL_VARS = new Set([TYPE_LOCAL_VAR, TYPE_LOCAL_VAR_STRING8, TYPE_LOCAL_VAR_STRING16]);
const GLOBAL_ARRAYS = new Set([TYPE_GLOBAL_ARRAY, TYPE_GLOBAL_ARRAY_STRING8, TYPE_GLOBAL_ARRAY_STRING16]);
const LOCAL_ARRAYS = new Set([TYPE_LOCAL_ARRAY, TYPE_LOCAL_ARRAY_STRING8, TYPE_LOCAL_ARRAY_STRING16]);

/**
 * One operand at the cursor, or null when the byte is the 0x00 variadic terminator (consumed).
 * An unknown data-type byte is a hard located error — decode is total, never lossy.
 */
export function readOperand(cursor: Cursor): null | Operand {
  const at = cursor.offset;
  const type = cursor.u8();
  switch (type) {
    case TYPE_END:
      return null;
    case TYPE_FLOAT32:
      return { kind: 'float', type, value: cursor.f32() };
    case TYPE_INT8:
      return { kind: 'int', type, value: cursor.i8() };
    case TYPE_INT16:
      return { kind: 'int', type, value: cursor.i16() };
    case TYPE_INT32:
      return { kind: 'int', type, value: cursor.i32() };
    case TYPE_STRING8:
      return { kind: 'string', type, value: text(cursor.take(8)) };
    case TYPE_STRING16:
      return { kind: 'string', type, value: text(cursor.take(16)) };
    case TYPE_STRING_VARLEN:
      return { kind: 'string', type, value: text(cursor.take(cursor.u8())) };
    default: {
      if (GLOBAL_VARS.has(type)) {
        return { index: cursor.u16(), kind: 'var', scope: 'global', type };
      }
      if (LOCAL_VARS.has(type)) {
        return { index: cursor.u16(), kind: 'var', scope: 'local', type };
      }
      if (GLOBAL_ARRAYS.has(type)) {
        return arrayRef(cursor, type, 'global');
      }
      if (LOCAL_ARRAYS.has(type)) {
        return arrayRef(cursor, type, 'local');
      }
      throw new RangeError(`unknown operand data-type byte 0x${type.toString(16)} at offset ${at}`);
    }
  }
}

function arrayRef(cursor: Cursor, type: number, scope: VarScope): Operand {
  const offset = cursor.u16();
  const indexVar = cursor.u16();
  const elemSize = cursor.u8();
  const flags = cursor.u8();

  return { elemSize, flags, indexVar, kind: 'array', offset, scope, type };
}

/** Script text is byte-per-char (cp1252-ish identifiers in practice); NULs pad fixed forms. */
function text(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) {
    end = bytes.length;
  }
  let out = '';
  for (let index = 0; index < end; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }

  return out;
}
