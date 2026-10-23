import { describe, expect, it } from 'vitest';
import {
  cycleCameraView,
  deriveControlAvailability,
  deriveExamStep,
  deriveFlightStatus,
  deriveStatusLabel,
  nextHintKey,
} from '../../src/exam/flow';

describe('流程 — 目前步驟（步驟條高亮）', () => {
  it('未選科目 → ①選科目', () => {
    expect(deriveExamStep({ subjectSelected: false, flightStatus: 'grounded', reportOpen: false })).toBe('select');
  });

  it('已選科目、尚未起飛 → ②起飛', () => {
    expect(deriveExamStep({ subjectSelected: true, flightStatus: 'grounded', reportOpen: false })).toBe('takeoff');
  });

  it('飛行中 → ③執行', () => {
    expect(deriveExamStep({ subjectSelected: true, flightStatus: 'flying', reportOpen: false })).toBe('execute');
  });

  it('已降落 → ⑤成績單（下一步提示按 Enter 或選下一科）', () => {
    expect(deriveExamStep({ subjectSelected: true, flightStatus: 'landed', reportOpen: false })).toBe('report');
    expect(nextHintKey({ subjectSelected: true, flightStatus: 'landed', reportOpen: false })).toBe('afterSubjectDone');
  });

  it('成績單開啟中 → ⑤（提示按 Esc 返回）', () => {
    expect(deriveExamStep({ subjectSelected: true, flightStatus: 'landed', reportOpen: true })).toBe('report');
    expect(nextHintKey({ subjectSelected: true, flightStatus: 'landed', reportOpen: true })).toBe('reportOpen');
  });

  it('未選科目時的提示為「請先選科目」', () => {
    expect(nextHintKey({ subjectSelected: false, flightStatus: 'grounded', reportOpen: false })).toBe('selectSubjectFirst');
  });
});

describe('流程 — 飛行狀態與狀態標籤', () => {
  it('idle／armed → 未起飛；flying → 飛行中；landed → 已降落', () => {
    expect(deriveFlightStatus('idle', 0)).toBe('grounded');
    expect(deriveFlightStatus('armed', 0)).toBe('grounded');
    expect(deriveFlightStatus('flying', 1.5)).toBe('flying');
    expect(deriveFlightStatus('landed', 0)).toBe('landed');
  });

  it('離地高度 > 0.15m 一律視為飛行中（即使狀態尚未更新）', () => {
    expect(deriveFlightStatus('armed', 0.4)).toBe('flying');
  });

  it('起飛中／降落中標籤由飛控程序旗標細分', () => {
    expect(deriveStatusLabel('flying', true, false)).toBe('takingOff');
    expect(deriveStatusLabel('flying', false, true)).toBe('landing');
    expect(deriveStatusLabel('flying', false, false)).toBe('flying');
    expect(deriveStatusLabel('grounded', false, false)).toBe('grounded');
    expect(deriveStatusLabel('landed', false, false)).toBe('landed');
  });
});

describe('流程 — 控制列按鈕可用性（驗收狀態表）', () => {
  it('地面待命：可起飛，懸停／降落停用', () => {
    expect(deriveControlAvailability('grounded', false, false)).toEqual({ takeoff: true, hover: false, land: false });
  });

  it('已落地：可再起飛，懸停／降落停用', () => {
    expect(deriveControlAvailability('landed', false, false)).toEqual({ takeoff: true, hover: false, land: false });
  });

  it('起飛中：起飛停用、懸停停用、降落可用（可中止）', () => {
    expect(deriveControlAvailability('flying', true, false)).toEqual({ takeoff: false, hover: false, land: true });
  });

  it('飛行／懸停：懸停、降落可用', () => {
    expect(deriveControlAvailability('flying', false, false)).toEqual({ takeoff: false, hover: true, land: true });
  });

  it('降落中：全部停用', () => {
    expect(deriveControlAvailability('flying', false, true)).toEqual({ takeoff: false, hover: false, land: false });
  });
});

describe('流程 — 視角循環', () => {
  it('考生 → 追隨 → 俯視全景 → 考生', () => {
    expect(cycleCameraView('examinee')).toBe('follow');
    expect(cycleCameraView('follow')).toBe('overview');
    expect(cycleCameraView('overview')).toBe('examinee');
  });
});
