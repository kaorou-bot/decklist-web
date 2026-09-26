// 与 Android 端 util/CardLayouts.kt 保持一致
//
// 真双面牌：物理一张牌有正反面 —— 需要「查看其他部分」翻面 + 切换卡图
// 多部分牌：历险/连体/余波等 —— 所有部分同页展示，不翻面、不切图

export const TRUE_DUAL_FACE_LAYOUTS = new Set([
  'transform',
  'modal', // Forge API 取值（Scryfall 为 modal_dfc）
  'modal_dfc',
  'meld',
  'flip',
  'reversible_card',
  'double_faced_token',
  'double_sided',
])

export const MULTI_PART_LAYOUTS = new Set([
  'adventure',
  'split',
  'aftermath',
  'fuse',
  'classify',
  'prototype',
  'saga',
])

export function isTrueDualFace(layout?: string | null): boolean {
  return !!layout && TRUE_DUAL_FACE_LAYOUTS.has(layout.toLowerCase())
}

export function isMultiPart(layout?: string | null): boolean {
  return !!layout && MULTI_PART_LAYOUTS.has(layout.toLowerCase())
}

/** 无 layout 时的回退判定：有背面图即视为双面 */
export function looksDualFaced(backImageUrl?: string | null): boolean {
  return !!backImageUrl
}
