import { describe, expect, it } from 'vitest';
import { EXAM_FIELD_TEMPLATES, TRAINING_TEMPLATES, getTrainingTemplate, validateTrainingTemplate } from '../../src/rea/training-template';

describe('J6 training templates', () => {
  it('keeps field geometry configurable and explicitly non-official', () => {
    for (const field of Object.values(EXAM_FIELD_TEMPLATES)) {
      expect(field.classification).toBe('TRAINING_TEMPLATE');
      expect(field.teacherZone).toBeDefined();
      expect(field.safetyBoundary).toEqual(field.bounds);
      expect(field.runway.surface).toBe('asphalt');
    }
  });

  it('declares all teaching templates without claiming official pass/fail', () => {
    expect(TRAINING_TEMPLATES.map((t) => t.id)).toEqual([
      'takeoff-land', 'hover', 'translate', 'orientation', 'circle', 'waypoints', 'emergency',
    ]);
    for (const template of TRAINING_TEMPLATES) {
      expect(template.classification).toBe('TRAINING_TEMPLATE');
      expect(validateTrainingTemplate(template)).toEqual([]);
      expect(template.teacherReview).toContain('教師');
    }
  });

  it('rejects a template with missing geometry, conditions or safety limits', () => {
    const invalid = { ...TRAINING_TEMPLATES[0], targetPoints: [], completion: [], failure: [] };
    expect(validateTrainingTemplate(invalid)).toContain('至少需要一個目標點');
    expect(validateTrainingTemplate(invalid)).toContain('至少需要一項完成條件');
    expect(validateTrainingTemplate(invalid)).toContain('至少需要一項失敗條件');
  });

  it('retrieves templates by ID without inventing a fallback task', () => {
    expect(getTrainingTemplate('circle')?.name).toContain('圓形');
    expect(getTrainingTemplate('not-a-task')).toBeUndefined();
  });
});
