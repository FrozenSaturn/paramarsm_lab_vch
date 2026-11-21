import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { cfg } from "../config.js";

let asr: Promise<any> | undefined;
async function getAsr() {
  asr ??= import("@huggingface/transformers").then(({ pipeline }) =>
    pipeline("automatic-speech-recognition", cfg.whisper));
  return asr;
}

/** Decode any audio (WhatsApp voice notes are ogg/opus) to 16kHz mono float32 using bundled ffmpeg. */
function decode(buf: Buffer): Promise<Float32Array> {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegPath as unknown as string, ["-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    p.stdout.on("data", c => chunks.push(c));
    p.on("error", rej);
    p.on("close", code => {
      if (code !== 0) return rej(new Error(`ffmpeg exit ${code}`));
      const b = Buffer.concat(chunks);
      res(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
    });
    p.stdin.on("error", () => {}); p.stdin.end(buf);
  });
}

/** Local, offline transcription (Hindi/English/Hinglish are auto-detected by Whisper). */
export async function transcribe(buf: Buffer): Promise<string> {
  const [pcm, pipe] = await Promise.all([decode(buf), getAsr()]);
  const out = await pipe(pcm, { chunk_length_s: 30, stride_length_s: 5, task: "transcribe" });
  return (out.text as string).trim();
}
