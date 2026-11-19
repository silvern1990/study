import { spawn } from 'node:child_process';

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * 어떤 입력 포맷이든 FreeSWITCH 가 바로 재생할 수 있는 16kHz mono 16bit WAV 로 변환.
 * (통화 코덱이 Opus/G.722 여도 FreeSWITCH 가 재생 시 리샘플링한다)
 */
export async function convertToWav(input: string, output: string) {
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', input,
    '-ac', '1',
    '-ar', '16000',
    '-sample_fmt', 's16',
    // 소리 크기 평준화 (방송 볼륨 일정하게)
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    output,
  ]);
}

export async function probeDurationSec(file: string): Promise<number> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const value = Number.parseFloat(out.trim());
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}
