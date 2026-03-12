export interface RecordingFormat {
  extension: string;
  fallbackMimeType: string;
}

export interface RecordingConversionBridge {
  convertAudioToMp3?: (audioBytes: Uint8Array, mimeType: string) => Promise<Uint8Array>;
}

export interface NormalizedRecordedAudio {
  blob: Blob;
  extension: string;
  mimeType: string;
  wasConverted: boolean;
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  const response = new Response(blob);
  return new Uint8Array(await response.arrayBuffer());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function resolveRecordingFormat(mimeType: string): RecordingFormat {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return { extension: 'mp3', fallbackMimeType: 'audio/mpeg' };
  }
  if (normalized.includes('mp4') || normalized.includes('m4a')) {
    return { extension: 'm4a', fallbackMimeType: 'audio/mp4' };
  }
  if (normalized.includes('wav')) {
    return { extension: 'wav', fallbackMimeType: 'audio/wav' };
  }
  if (normalized.includes('ogg')) {
    return { extension: 'ogg', fallbackMimeType: 'audio/ogg' };
  }
  return { extension: 'webm', fallbackMimeType: 'audio/webm' };
}

export async function normalizeRecordedAudio(
  audioBlob: Blob,
  electronApi?: RecordingConversionBridge
): Promise<NormalizedRecordedAudio> {
  const format = resolveRecordingFormat(audioBlob.type);
  const mimeType = audioBlob.type || format.fallbackMimeType;

  if (format.extension === 'mp3' || !electronApi?.convertAudioToMp3) {
    return {
      blob: audioBlob,
      extension: format.extension,
      mimeType,
      wasConverted: false,
    };
  }

  const convertedBytes = await electronApi.convertAudioToMp3(
    await readBlobBytes(audioBlob),
    mimeType
  );
  return {
    blob: new Blob([toArrayBuffer(convertedBytes)], { type: 'audio/mpeg' }),
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    wasConverted: true,
  };
}
