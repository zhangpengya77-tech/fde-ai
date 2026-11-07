/**
 * REA 考照模擬器：示範飛行語音解說（2026-11-08）。
 *
 * - 使用瀏覽器內建語音合成（Web Speech API，speechSynthesis），不連外部服務、不需金鑰、不收費。
 * - 優先挑「台灣國語女聲」（Windows：HsiaoChen 曉臻／HsiaoYu 曉雨；Apple：Mei-Jia 美佳；
 *   Android／Chrome：Google 國語（臺灣））；找不到時用其他 zh-TW 聲音，再不行用任何中文聲音。
 * - 瀏覽器不支援語音時不出聲，只在畫面字幕顯示解說文字。
 * - 解說文字由科目步驟自動產生：示範＝評分依據，所以解說內容和評等標準永遠一致。
 */

import type { Step, Subject, Vec2 } from './courses';

/** 台灣女聲的常見名稱（依偏好排序；比對時不分大小寫、只要名稱包含即可）。 */
const TW_FEMALE_HINTS = ['hsiaochen', '曉臻', 'hsiaoyu', '曉雨', 'mei-jia', 'meijia', '美佳', 'google 國語', 'yating', '雅婷', 'hanhan', '涵涵'];
/** 明顯是男聲的名稱：避免選到（例如 Yunjhe 雲哲、Zhiwei 志偉）。 */
const MALE_HINTS = ['yunjhe', '雲哲', 'zhiwei', '志偉', 'male'];

export interface VoiceLike {
  name: string;
  lang: string;
}

/** 挑選解說聲音：台灣女聲 → 其他台灣聲音（排除男聲）→ 任何台灣聲音 → 其他中文聲音。 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  const lang = (v: VoiceLike) => v.lang.replace('_', '-').toLowerCase();
  const name = (v: VoiceLike) => v.name.toLowerCase();
  const tw = voices.filter((v) => lang(v) === 'zh-tw' || lang(v).startsWith('zh-hant'));
  for (const hint of TW_FEMALE_HINTS) {
    const hit = tw.find((v) => name(v).includes(hint)) ?? voices.find((v) => name(v).includes(hint));
    if (hit) return hit;
  }
  const notMale = tw.find((v) => !MALE_HINTS.some((m) => name(v).includes(m)));
  if (notMale) return notMale;
  if (tw[0]) return tw[0];
  return voices.find((v) => lang(v).startsWith('zh')) ?? null;
}

const HEADING_WORDS: Record<number, string> = { 0: '朝外', 90: '朝右', 180: '朝內', 270: '朝左' };

function headingWord(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return HEADING_WORDS[d] ?? `${d} 度`;
}

/** 數字念法：避免語音把「5 秒」念成英文或「五點零」。 */
const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function zhNum(n: number): string {
  const r = Math.round(n);
  if (r >= 0 && r <= 10) return NUM[r];
  if (r < 20) return `十${NUM[r - 10]}`;
  if (r < 100) return `${NUM[Math.floor(r / 10)]}十${r % 10 ? NUM[r % 10] : ''}`;
  return String(r);
}

/**
 * 把字幕文字轉成「念起來自然」的文字（只給語音用，字幕維持原樣）：
 *  P1–P4 → P1 到 P4；12×5 m → 十二乘五公尺；5 秒 → 五秒；1.5 公尺 → 一點五公尺。
 */
export function toSpeech(text: string): string {
  return text
    .replace(/P(\d)\s*[–—-]\s*P(\d)/g, 'P$1 到 P$2')
    .replace(/(\d+)\s*[×x]\s*(\d+)\s*m(?![a-zA-Z])/g, (_m, a, b) => `${zhNum(Number(a))}乘${zhNum(Number(b))}公尺`)
    .replace(/(\d+)\.(\d)\s*(公尺|m(?![a-zA-Z]))/g, (_m, a, b) => `${zhNum(Number(a))}點${NUM[Number(b)]}公尺`)
    .replace(/(\d+)\s*(秒|公尺|度|圈)/g, (_m, d, u) => `${zhNum(Number(d))}${u}`)
    .replace(/(\d+)\s*m(?![a-zA-Z])/g, (_m, d) => `${zhNum(Number(d))}公尺`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 科目開場白：科目名稱＋規範重點。 */
export function introNarration(subject: Subject): string {
  return `現在示範「${subject.name}」。${subject.brief} 請注意看無人機的位置、高度和機頭方向。`;
}

/** 每一步的解說：先講動作，再補一句操作要領（依步驟種類）。 */
export function stepNarration(step: Step, _anchor?: Vec2): string {
  const what = step.label;
  switch (step.kind) {
    case 'takeoff':
      return `${what}。油門慢慢推高，垂直起飛到大約一點五公尺，起飛時不要前後左右飄移。`;
    case 'hold':
      return `${what}。保持高度和位置不動，${headingWord(step.heading)}停穩${zhNum(step.seconds)}秒，眼睛盯著機身，小幅修正就好。`;
    case 'yaw':
      return `${what}。用左手方向舵原地慢慢轉，轉的時候高度和位置都要維持。`;
    case 'fly':
      return step.alt && step.alt > 5
        ? `${what}。保持高度、速度平穩，沿著航線直線飛行。`
        : `${what}。保持一點五公尺的高度，速度放慢、走直線，快到目標前提早減速。`;
    case 'arc':
      return `${what}。一邊前進一邊配合方向舵轉彎，機頭始終對準前進方向，盡量貼著圓圈飛。`;
    case 'climb':
      return `${what}。原地垂直爬升，位置不要飄。`;
    case 'land':
      return `${what}。先在降落點正上方對準，再慢慢收油門下降，落地後把油門收到底。`;
    case 'emergency-return':
      return `${what}。聽到緊急返航口令，先立刻停住，再用最短路線飛回降落。`;
  }
}

export interface NarratorOptions {
  /** 語速：1 為正常。示範給學員看，略慢比較清楚。 */
  rate?: number;
}

/** 示範解說播放器：步驟換了就打斷上一句，避免解說落後畫面。 */
export class Narrator {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private readonly synth: SpeechSynthesis | null;
  private readonly rate: number;

  constructor(opts: NarratorOptions = {}) {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.rate = opts.rate ?? 0.95;
    if (this.synth) {
      const load = () => { this.voice = pickVoice(this.synth!.getVoices()); };
      load();
      // Chrome 的聲音清單是非同步載入的
      this.synth.addEventListener?.('voiceschanged', load);
    }
  }

  /** 是否能真的發出聲音（否則只顯示字幕）。 */
  get canSpeak(): boolean {
    return !!this.synth;
  }

  /** 目前選到的聲音名稱（顯示在設定裡，方便老師確認是不是台灣女聲）。 */
  get voiceName(): string {
    return this.voice ? this.voice.name : '';
  }

  /** 開始念某一句時通知畫面（顯示字幕）。 */
  onText: (text: string) => void = () => undefined;
  private speaking = false;
  /** 正在念的時候又來新步驟：只留「最新的一句」，舊的跳過，避免解說越來越落後畫面。 */
  private next: string | null = null;
  /** 目前在念的那一句：被打斷的舊句子稍後才觸發結束事件，要忽略它。 */
  private current: SpeechSynthesisUtterance | null = null;

  /**
   * 念一句解說。
   * interrupt = true：立刻打斷（開場、結束）；false：等目前這句念完再念（步驟解說）。
   */
  speak(text: string, interrupt = false): void {
    if (!this.enabled) return;
    if (!this.synth) { this.onText(text); return; } // 不支援語音：只顯示字幕
    if (interrupt) { this.next = null; this.current = null; this.synth.cancel(); this.speaking = false; }
    if (this.speaking) { this.next = text; return; }
    this.say(text);
  }

  private say(text: string): void {
    const synth = this.synth!;
    const u = new SpeechSynthesisUtterance(toSpeech(text));
    u.lang = 'zh-TW';
    // 指定聲音失敗（少數瀏覽器）就用預設中文聲音，不能讓示範中斷
    try { if (this.voice) u.voice = this.voice; } catch { /* 用預設聲音 */ }
    u.rate = this.rate;
    u.pitch = 1.05;
    const done = () => {
      if (this.current !== u) return;
      this.current = null;
      this.speaking = false;
      const n = this.next;
      this.next = null;
      if (n) this.say(n);
    };
    u.onend = done;
    u.onerror = done;
    this.speaking = true;
    this.current = u;
    this.onText(text);
    synth.speak(u);
  }

  stop(): void {
    this.next = null;
    this.current = null;
    this.speaking = false;
    this.synth?.cancel();
  }
}
