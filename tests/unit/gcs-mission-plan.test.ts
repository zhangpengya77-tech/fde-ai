import { describe, expect, it } from 'vitest';
import { createTrainingMission, validateTrainingMission } from '../../src/gcs/mission-plan';

describe('P5 單機地面站訓練航線', () => {
  it('提供四個有序且可讀的本機訓練航點', () => {
    const mission = createTrainingMission();

    expect(mission.waypoints).toHaveLength(4);
    expect(mission.waypoints.map((waypoint) => waypoint.sequence)).toEqual([1, 2, 3, 4]);
    expect(validateTrainingMission(mission)).toEqual([]);
  });

  it('拒絕少於四個航點，避免把不完整計畫顯示為可上傳任務', () => {
    const mission = createTrainingMission();
    mission.waypoints.pop();

    expect(validateTrainingMission(mission)).toContain('至少需要 4 個航點');
  });
});
