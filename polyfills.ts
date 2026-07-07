import { Buffer as BufferPolyfill } from "buffer";

const globals = globalThis as typeof globalThis & {
  Buffer?: typeof BufferPolyfill;
};

globals.Buffer ??= BufferPolyfill;
