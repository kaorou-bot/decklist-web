// 纯逻辑冒烟：套牌统计口径 + 起手抽卡分布 + 牌表解析
import { computeStats, type StatCard } from '../src/lib/deckStats'
import { drawOpeningHand } from '../src/lib/simulate'
import { parseDeckText } from '../src/lib/deckImport'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL: ' + msg)
    process.exitCode = 1
  } else {
    console.log('ok  - ' + msg)
  }
}

const deck: StatCard[] = [
  { name: 'Plains', quantity: 20, sideboard: false, manaCost: '', manaValue: 0, typeLineZh: '基本地～平原' },
  { name: 'Solitude', quantity: 4, sideboard: false, manaCost: '{3}{W}{W}', manaValue: 5, typeLineZh: '生物～元素／化身', colors: ['W'] },
  { name: 'Lightning Bolt', quantity: 4, sideboard: false, manaCost: '{R}', manaValue: 1, typeLineZh: '瞬间', colors: ['R'] },
  { name: 'Wear // Tear', quantity: 2, sideboard: false, manaCost: '{1}{R}{W}', manaValue: 3, typeLineZh: '瞬间', colors: ['R', 'W'] },
  { name: 'Disenchant', quantity: 2, sideboard: true, manaCost: '{1}{W}', manaValue: 2, typeLineZh: '瞬间' },
]

const s = computeStats(deck, true)
assert(s.totalCards === 32, `含备牌总数 32，实际 ${s.totalCards}`)
assert(computeStats(deck, false).totalCards === 30, '仅主牌总数 30')
assert(s.curve.find((c) => c.bucket === 1)?.count === 4, '1费曲线=4（闪电击）')
assert(s.curve.find((c) => c.bucket === 5)?.count === 4, '5费曲线=4（幽寂）')
assert(s.colorCount.find((c) => c.code === 'R')?.count === 6, '红色计入 6 张（含混色）')
assert(s.colorCount.find((c) => c.code === 'B')?.count === 0, '黑色为 0')
assert(s.typeCount.find((t) => t.key === 'land')?.count === 20, '地 20 张')
assert(s.typeCount.find((t) => t.key === 'creature')?.count === 4, '生物 4 张')
assert(s.typeCount.find((t) => t.key === 'instant')?.count === 8, '瞬间 8 张（含 Wear // Tear 2 张）')

// 中英文类别都能识别
assert(computeStats([{ name: 'X', quantity: 1, sideboard: false, manaValue: 2, typeLine: 'Legendary Creature - Angel' }], true).creatureCount === 1, '英文类别行识别为生物')

// 无放回抽 7 张：单卡张数不超过上限，且总量守恒
let ok = true
for (let i = 0; i < 500; i++) {
  const hand = drawOpeningHand(deck.filter((c) => !c.sideboard), 7)
  if (hand.length !== 7) ok = false
  const counts = new Map<string, number>()
  for (const c of hand) counts.set(c.name, (counts.get(c.name) ?? 0) + 1)
  for (const c of deck.filter((x) => !x.sideboard)) {
    if ((counts.get(c.name) ?? 0) > c.quantity) ok = false
  }
}
assert(ok, '500 次抽起手均满足「不超过该牌张数」')

try {
  drawOpeningHand([{ name: 'A', quantity: 3 }], 7)
  assert(false, '牌不足时应抛错')
} catch (e) {
  assert(String((e as Error).message).includes('至少需要'), '牌不足时抛错并给出提示')
}

const parsed = parseDeckText(['4 Solitude', 'SB: 2 Disenchant', ''].join('\n'))
assert(parsed.cards.length === 2, '解析 2 条')
assert(parsed.cards.find((c) => c.name === 'Disenchant')?.sideboard === true, 'SB: 前缀识别为备牌')
console.log('逻辑冒烟完成')
