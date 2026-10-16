import type { F450Entity } from './create-programmatic-f450';
import { createProgrammaticF450 } from './create-programmatic-f450';

export interface F450LoadResult {
  entity: F450Entity;
  notice: string;
}

export async function loadF450(): Promise<F450LoadResult> {
  return {
    entity: createProgrammaticF450(),
    notice: '使用程序化 F450；候选 GLB 的授权来源尚待确认。',
  };
}
