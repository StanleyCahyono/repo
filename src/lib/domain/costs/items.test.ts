import { describe, expect, it } from 'vitest'
import { adultRank, audienceOf, categoryFits, isAdultDayLiftTicket, lessonKindOf, rentalItemMatches, rentalKindOf, rentalTier, weekdaysNamed } from './items'

describe('audience and category', () => {
  it('reads adult wording with ages, and rejects child, senior, college, club and family rates', () => {
    expect(audienceOf('adult')).toBe('adult')
    expect(audienceOf('Adult (13-69)')).toBe('adult')
    expect(audienceOf('adult (19–64)')).toBe('adult')
    expect(audienceOf(null)).toBe('unstated')
    expect(audienceOf('Price shown (age category not captured)')).toBe('unstated')
    for (const c of ['Child (6 and under)', 'Ages 6 and under', 'College', 'Adult (club member)', 'Senior 65+', 'Family purchase: 2nd-4th family member aged 7-22', 'Junior 7-12']) {
      expect(audienceOf(c), c).toBe('other')
    }
  })

  it('categoryFits("adult") accepts adult and unstated categories, unless the item names another audience', () => {
    expect(categoryFits('Adult (13-69)', 'Full-day lift ticket', 'adult')).toBe(true)
    expect(categoryFits(null, 'Day ticket', 'adult')).toBe(true)
    expect(categoryFits(null, 'Lift ticket, ages 6 and under', 'adult')).toBe(false)
    expect(categoryFits('College', 'College Wednesday lift ticket', 'adult')).toBe(false)
    expect(categoryFits('child (6–12)', 'Day ticket', 'child')).toBe(true)
    expect(categoryFits('adult', 'Day ticket', 'child')).toBe(false)
  })
})

describe('adultRank', () => {
  it('puts the standard adult price first', () => {
    expect(adultRank('Adult')).toBe(0)
    expect(adultRank('adult (23+)')).toBe(1)
    expect(adultRank('Adult (19–64)')).toBe(1)
    expect(adultRank('Young adult (19–22)')).toBe(2)
    expect(adultRank(null)).toBe(3)
    expect(adultRank('Child (5–12)')).toBe(9)
  })
})

describe('isAdultDayLiftTicket', () => {
  const day = (item: string, category: string | null = 'adult') => ({ item, category })

  it('accepts the adult full-day tickets researchers record', () => {
    for (const item of [
      'Adult 1-day lift ticket, weekend',
      '1-day adult lift pass (16–64)',
      'Adult (13-64) 8-hour lift ticket (Song-Labrador)',
      'Kitzsteinhorn/Maiskogel day ticket (main season, from 8 am)',
      'SkiStar Åre adult 1-day lift pass (high season, week 8)',
      'Full-day lift ticket, weekday non-holiday, bought within 7 days',
      'Full-day lift ticket, weekday non-holiday, bought 7+ days ahead',
      '1-day ski pass Sölden (main season)',
      'Your lift ticket estimate',
    ]) {
      expect(isAdultDayLiftTicket(day(item)), item).toBe(true)
    }
  })

  it('leaves out half-day, twilight, night, multi-day, packs, lesson bundles and special rates', () => {
    for (const [item, category] of [
      ['Twilight ticket (4 PM-close), bought in advance', 'Adult'],
      ['Adult lift ticket', 'adult (half day)'],
      ['Half-day lift ticket (12:30-close)', 'adult'],
      ['3-day lift ticket pack', null],
      ['Quad Pack: four transferable all-mountain lift tickets (price per ticket)', null],
      ['Red Jug Pub College Night (Monday night ticket)', 'College'],
      ['Ski-club group rate, adult 1-day (Onondaga Ski Club members)', 'Adult (club member)'],
      ['Lift ticket, ages 6 and under', 'Child (6 and under)'],
      ['Learn-to-ski package: lift ticket + lesson + rental', 'adult'],
      ['Adult 4-hour ticket', 'adult'],
    ] as const) {
      expect(isAdultDayLiftTicket(day(item, category)), item).toBe(false)
    }
  })

  it('a ticket sold for named weekdays only applies on those days', () => {
    expect(weekdaysNamed('All-day lift ticket, Tuesdays')).toEqual([2])
    expect(weekdaysNamed('Adult (18+) 1-day lift ticket, Friday (non-holiday)')).toEqual([5])
    expect(weekdaysNamed('Adult lift ticket, Monday to Friday')).toEqual([])
    const tue = day('All-day lift ticket, Tuesdays', null)
    expect(isAdultDayLiftTicket(tue, '2027-01-19')).toBe(true) // Tuesday
    expect(isAdultDayLiftTicket(tue, '2027-01-20')).toBe(false) // Wednesday
  })
})

describe('rentals', () => {
  it('reads readable rental names into the basket options', () => {
    expect(rentalKindOf('Adult ski + boots + poles, per day')).toBe('full-package')
    expect(rentalKindOf('Adult ski package (skis, boots, poles)')).toBe('full-package')
    expect(rentalKindOf('Ski rental package, adult, 1 day')).toBe('full-package')
    expect(rentalKindOf('Performance ski package')).toBe('full-package')
    expect(rentalKindOf('Adult skis only')).toBe('skis-only')
    expect(rentalKindOf('Skis + poles (no boots)')).toBe('skis-only')
    expect(rentalKindOf('Adult ski boots')).toBe('boots-only')
    expect(rentalKindOf('Boots only')).toBe('boots-only')
    expect(rentalKindOf('Snowboard + boots, adult')).toBe('snowboard')
    // Option ids (your own estimates) still match.
    expect(rentalKindOf('full-package')).toBe('full-package')
    expect(rentalKindOf('skis-only')).toBe('skis-only')
  })

  it('leaves out children’s, half-day, multi-day, lesson bundles and accessories', () => {
    expect(rentalKindOf('Junior ski package (7-12)')).toBeNull()
    expect(rentalKindOf('Adult ski package', 'child')).toBeNull()
    expect(rentalKindOf('Adult ski package, half day')).toBeNull()
    expect(rentalKindOf('Adult ski package, 3 days')).toBeNull()
    expect(rentalKindOf('Beginner lesson + lift + rental')).toBeNull()
    expect(rentalKindOf('Helmet')).toBeNull()
  })

  it('matches an option and ranks premium gear after standard', () => {
    expect(rentalItemMatches('Adult ski + boots + poles, per day', 'full-package')).toBe(true)
    expect(rentalItemMatches('Adult ski + boots + poles, per day', 'skis-only')).toBe(false)
    expect(rentalTier('Sport ski package')).toBe(0)
    expect(rentalTier('Premium demo ski package')).toBe(1)
  })
})

describe('lessons', () => {
  it('tells group from private lessons and leaves children’s programmes out', () => {
    expect(lessonKindOf('Adult group lesson, 2 hours')).toBe('group')
    expect(lessonKindOf('Private lesson (1 hour)')).toBe('private')
    expect(lessonKindOf('Ski school group class', 'adult')).toBe('group')
    expect(lessonKindOf('Kids ski camp (4-12)')).toBeNull()
    expect(lessonKindOf('Group lesson', 'child')).toBeNull()
  })
})
