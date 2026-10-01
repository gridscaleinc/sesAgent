/**
 * onnxruntime-node 1.21 aborts in its native static destructors whenever the process exits after a session was
 * created, even once the session is released (macOS, arm64 and x64; Intel Macs show a crash report). The fixed
 * 1.30 no longer ships Intel Mac binaries, so model workers end without running those destructors. The process
 * holds no files or state that need flushing; the OS reclaims its memory.
 */
export function exitModelWorker(): never {
  process.kill(process.pid, 'SIGKILL')
  throw new Error('unreachable')
}
