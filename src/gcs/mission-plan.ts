/**
 * P5 網頁地面站的本機訓練航線資料。
 *
 * 這是教學規劃資料，不是已上傳 MAVLink mission；正式上傳必須由受控
 * Gateway session 與 SITL 的 mission protocol 完成。
 */
export interface TrainingWaypoint {
  sequence: number;
  eastM: number;
  northM: number;
  altitudeM: number;
  speedMps: number;
}

export interface TrainingMission {
  label: string;
  waypoints: TrainingWaypoint[];
}

export function createTrainingMission(): TrainingMission {
  return {
    label: 'P5 單機四航點訓練（尚未上傳）',
    waypoints: [
      { sequence: 1, eastM: 0, northM: 12, altitudeM: 12, speedMps: 3 },
      { sequence: 2, eastM: 12, northM: 12, altitudeM: 12, speedMps: 3 },
      { sequence: 3, eastM: 12, northM: 0, altitudeM: 12, speedMps: 3 },
      { sequence: 4, eastM: 0, northM: 0, altitudeM: 12, speedMps: 3 },
    ],
  };
}

/** 回傳教學計畫錯誤；數值是 UI 安全界線，並非民航局及格標準。 */
export function validateTrainingMission(mission: TrainingMission): string[] {
  const errors: string[] = [];
  if (mission.waypoints.length < 4) errors.push('至少需要 4 個航點');
  for (const [index, waypoint] of mission.waypoints.entries()) {
    if (waypoint.sequence !== index + 1) errors.push('航點序號必須連續');
    if (!Number.isFinite(waypoint.altitudeM) || waypoint.altitudeM <= 0) errors.push(`航點 ${index + 1} 高度必須大於 0`);
    if (!Number.isFinite(waypoint.speedMps) || waypoint.speedMps <= 0) errors.push(`航點 ${index + 1} 速度必須大於 0`);
  }
  return errors;
}
