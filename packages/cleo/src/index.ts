export { Cursor } from './core/cursor';
export { CleoDecodeError, type DecodedScript, decodeScript, type Instruction, NEGATED_BIT } from './core/decode';
export { disassemble, formatInstruction } from './core/disasm';
export { type OpcodeDef, opcodeDef, opcodeTable } from './core/opcode-table';
export { type Operand, readOperand, TYPE_END, type VarScope } from './core/operands';
export type {
  CleoHost,
  CleoModelFacet,
  CleoObjectFacet,
  CleoPlayerFacet,
  CleoTextFacet,
  CleoVehicleFacet,
  CleoWorldFacet,
} from './vm/host.interface';
export { createRecordingHost, type RecordingHost, type RecordingHostOptions } from './vm/recording-host';
export { type HandlerContext, HandlerRegistry, type OpcodeHandler, type OpcodeResult } from './vm/registry';
export { ScriptRunner, type ScriptRunnerOptions, type ThreadFaultRecord } from './vm/runner';
export { CleoThread, ThreadFault } from './vm/thread';
export { VarSpace } from './vm/var-space';
