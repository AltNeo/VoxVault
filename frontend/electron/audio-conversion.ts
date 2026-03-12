import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function inferExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return '.mp3';
  }
  if (normalized.includes('mp4') || normalized.includes('m4a')) {
    return '.m4a';
  }
  if (normalized.includes('wav')) {
    return '.wav';
  }
  if (normalized.includes('ogg')) {
    return '.ogg';
  }
  if (normalized.includes('webm')) {
    return '.webm';
  }
  return '.bin';
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      windowsHide: true,
    });
    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || 'ffmpeg conversion failed'));
    });
  });
}

export async function convertAudioToMp3(
  audioBytes: Uint8Array | ArrayBuffer,
  mimeType: string
): Promise<Uint8Array> {
  const inputBytes = audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'voxvault-recording-'));
  const inputPath = path.join(tempDir, `input${inferExtension(mimeType)}`);
  const outputPath = path.join(tempDir, 'output.mp3');

  try {
    await writeFile(inputPath, Buffer.from(inputBytes));
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-ac',
      '1',
      '-ar',
      '16000',
      outputPath,
    ]);

    const outputBytes = await readFile(outputPath);
    return new Uint8Array(outputBytes);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new Error('ffmpeg is required to convert recordings to mp3');
    }
    throw error;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}
