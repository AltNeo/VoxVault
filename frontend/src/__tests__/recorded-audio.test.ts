import { describe, expect, it, vi } from 'vitest';
import { normalizeRecordedAudio, resolveRecordingFormat } from '../services/recorded-audio';

describe('recorded audio helpers', () => {
  it('detects mp3 recordings from mime type', () => {
    expect(resolveRecordingFormat('audio/mpeg')).toEqual({
      extension: 'mp3',
      fallbackMimeType: 'audio/mpeg',
    });
  });

  it('keeps mp3 recordings unchanged', async () => {
    const blob = new Blob(['mock'], { type: 'audio/mpeg' });
    const result = await normalizeRecordedAudio(blob);

    expect(result.blob).toBe(blob);
    expect(result.extension).toBe('mp3');
    expect(result.wasConverted).toBe(false);
  });

  it('converts non-mp3 recordings through the electron bridge', async () => {
    const blob = new Blob(['webm-audio'], { type: 'audio/webm' });
    const convertAudioToMp3 = vi.fn().mockResolvedValue(new Uint8Array([0x49, 0x44, 0x33]));

    const result = await normalizeRecordedAudio(blob, { convertAudioToMp3 });

    expect(convertAudioToMp3).toHaveBeenCalledWith(expect.any(Uint8Array), 'audio/webm');
    expect(result.extension).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.wasConverted).toBe(true);
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
