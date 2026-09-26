// 套牌里每张卡选中的印刷版本，跟套牌一起存进 localStorage
//
// key 用「主备 + 归一化牌名」，主牌与备牌里的同名卡可以各选各的版本。
import { matchingKey } from './deckImport'

export interface CardVersion {
  imageUrl: string | null
  /** 双面牌背面的图，保证正反面是同一个印刷版本 */
  backImageUrl?: string | null
  setCode: string | null
  setNameZh?: string | null
  collectorNumber: string | null
  rarity?: string | null
}

/** 版本字典：key = versionKey(name, sideboard) */
export type VersionMap = Record<string, CardVersion>

export function versionKey(name: string, sideboard: boolean): string {
  return `${sideboard ? 's' : 'm'}:${matchingKey(name)}`
}

/** 卡名改动（如英文名转中文名）后把版本 key 一起迁过去，避免版本丢失 */
export function remapVersions(
  versions: VersionMap | undefined,
  pairs: { from: string; to: string; sideboard: boolean }[],
): VersionMap {
  if (!versions) return {}
  const out: VersionMap = {}
  for (const { from, to, sideboard } of pairs) {
    const v = versions[versionKey(from, sideboard)]
    if (v) out[versionKey(to, sideboard)] = v
  }
  return out
}
