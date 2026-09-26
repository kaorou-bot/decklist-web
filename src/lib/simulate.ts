// 起手模拟：按份数做无放回抽卡（对齐 Android domain/model/OpeningHand.kt）
//
// App 端是对主牌 pool 做「票券法」抽样：每张牌按 quantity 占 N 张票，
// 每次随机取一张票，取中后该牌票数 -1，避免把整副牌展开成 60 个元素的数组。

export interface PoolCard {
  name: string
  quantity: number
}

export function drawOpeningHand<T extends PoolCard>(cards: T[], size = 7): T[] {
  const pool = cards.filter((c) => c.quantity > 0)
  const remaining = pool.map((c) => c.quantity)
  let total = remaining.reduce((a, b) => a + b, 0)
  if (total < size) throw new Error(`主牌仅 ${total} 张，至少需要 ${size} 张才能模拟起手`)
  const out: T[] = []
  for (let i = 0; i < size; i++) {
    let ticket = Math.floor(Math.random() * total)
    let index = 0
    while (ticket >= remaining[index]) {
      ticket -= remaining[index]
      index++
    }
    remaining[index] -= 1
    total -= 1
    out.push(pool[index])
  }
  return out
}
