// Your Year in Coffee's story slides (backlog 65, docs/api/recaps.md §11c):
// one figure each, in order, skipping any the year's figures left out, and
// ending on a summary card. Unit-tested in yearSlides.test.ts.
import { formatCaffeine } from './caffeine';
import type { Ranked, YearFigures } from './yearInCoffee';

export interface Slide {
  key: string;
  kicker: string; // the line above the figure
  value: string; // the figure
  sub?: string; // a line under it
  list?: Array<{ name: string; detail: string }>;
  bars?: number[]; // brews per month, for the month slide
  link?: { name: string; params: Record<string, string> }; // a route to the brew
}
export interface SlideContext {
  mine: boolean; // only the person's own brews, or the bar's year
  inProgress: boolean; // the year isn't over ("so far")
  volume: (ml: number) => string;
  weight: (grams: number) => string;
  person: (userId: string) => string; // "You", a name, or a stand-in like "Member 2"
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const stars = (r: number) => `${r % 1 ? r.toFixed(1) : r} ★`;
const approx = (estimated: boolean) => (estimated ? '≈ ' : '');
export const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
const shortDay = (day: string) => {
  const [, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]!.slice(0, 3)}`;
};
const rankedList = (list: Ranked[]) => list.map((r) => ({ name: r.name, detail: plural(r.brews, 'brew') }));

export function yearSlides(f: YearFigures, ctx: SlideContext): Slide[] {
  const r = f.recap;
  const whose = ctx.mine ? 'Your' : "The bar's";
  const out: Slide[] = [{ key: 'intro', kicker: `${whose} year in coffee`, value: String(f.year), sub: ctx.inProgress ? 'So far' : undefined }];
  if (!r.brews) {
    out.push({ key: 'empty', kicker: ctx.inProgress ? 'Nothing brewed yet' : 'Nothing brewed', value: 'No brews', sub: `in ${f.year}${ctx.mine ? ' by you' : ''}` });
    return out;
  }
  const add = (s: Slide | null | false) => {
    if (s) out.push(s);
  };

  const was = r.previousBrews ? `${plural(r.previousBrews, 'brew')} in ${f.year - 1}` : null;
  add({ key: 'brews', kicker: ctx.mine ? 'You brewed' : 'The bar brewed', value: plural(r.brews, 'brew'), sub: [`on ${plural(r.daysBrewed, 'day')}`, was].filter(Boolean).join(' · ') });
  add(f.streak && { key: 'streak', kicker: 'Longest streak', value: `${f.streak.days} days in a row`, sub: `${shortDay(f.streak.start)} – ${shortDay(f.streak.end)}` });
  add(f.busiestMonth && { key: 'month', kicker: 'Busiest month', value: MONTH_NAMES[f.busiestMonth.month]!, sub: plural(f.busiestMonth.brews, 'brew'), bars: f.months });
  add(f.busiestWeekday && f.favouriteHour && { key: 'when', kicker: ctx.mine ? 'Your usual' : "The bar's usual", value: `${WEEKDAYS[f.busiestWeekday.weekday]}s, ${hourLabel(f.favouriteHour.hour)}`, sub: 'the busiest day, and the favourite hour' });
  add({ key: 'coffee', kicker: 'Coffee used', value: ctx.weight(r.coffeeGrams), sub: r.rating ? `rated ${r.rating.mean.toFixed(1)} / 5 on average` : undefined });
  add(r.volume && { key: 'volume', kicker: ctx.mine ? 'You drank' : 'Drunk', value: `${approx(r.volume.estimated)}${ctx.volume(r.volume.ml)}`, sub: r.caffeineMg !== null ? `and ${formatCaffeine(r.caffeineMg)} of caffeine` : undefined });
  add(
    r.forOthers && {
      key: 'others',
      kicker: 'Brewed for others',
      value: `${approx(r.forOthers.estimated)}${ctx.volume(r.forOthers.ml)}`,
      sub: plural(r.forOthers.brews, 'brew'),
      list: r.forOthers.guests.slice(0, 5).map((g) => ({ name: g.name, detail: plural(g.brews, 'brew') })),
    },
  );
  add(r.beansBrewed.length > 0 && { key: 'beans', kicker: 'Top beans', value: r.beansBrewed[0]!.label, list: r.beansBrewed.slice(0, 5).map((b) => ({ name: b.label, detail: plural(b.brews, 'brew') })) });
  add(f.origins.length > 0 && { key: 'origins', kicker: 'Where it came from', value: f.origins[0]!.name, list: rankedList(f.origins) });
  add(f.roasters.length > 0 && { key: 'roasters', kicker: 'Top roasters', value: f.roasters[0]!.name, list: rankedList(f.roasters) });
  add(f.processes.length > 0 && { key: 'processes', kicker: 'Top processes', value: f.processes[0]!.name, list: rankedList(f.processes) });
  add(f.varieties.length > 0 && { key: 'varieties', kicker: 'Top varieties', value: f.varieties[0]!.name, list: rankedList(f.varieties) });
  add(f.flavors.length > 0 && { key: 'flavors', kicker: ctx.mine ? 'Flavors you picked most' : 'Flavors picked most', value: f.flavors[0]!.name, list: rankedList(f.flavors) });
  add(r.topRecipe && { key: 'recipe', kicker: 'Most brewed recipe', value: r.topRecipe.name, sub: [plural(r.topRecipe.brews, 'brew'), r.topBrewer ? `mostly on the ${r.topBrewer.name}` : null].filter(Boolean).join(' · ') });
  const best = r.best[0];
  add(
    best && {
      key: 'best',
      kicker: 'Best cup',
      value: `${stars(best.rating)} ${best.bean}`,
      sub: [shortDay(best.day), best.recipe, f.bestCupBy ? `by ${ctx.person(f.bestCupBy)}` : null].filter(Boolean).join(' · '),
      link: { name: 'journal-entry', params: { id: best.brewId } },
    },
  );
  add(f.mostImproved && { key: 'improved', kicker: `Most improved ${f.mostImproved.kind}`, value: f.mostImproved.name, sub: `${f.mostImproved.from.toFixed(1)} → ${f.mostImproved.to.toFixed(1)} ★ over ${plural(f.mostImproved.brews, 'rated brew')}` });
  const newBits = [r.beansAdded.length ? plural(r.beansAdded.length, 'new bean') : null, r.newRecipes.length ? plural(r.newRecipes.length, 'new recipe') : null].filter((x): x is string => x !== null);
  add(newBits.length > 0 && { key: 'new', kicker: 'New this year', value: newBits.join(', '), sub: r.beansFinished.length ? `and ${plural(r.beansFinished.length, 'bag')} finished` : undefined });
  add(f.people.length > 0 && { key: 'people', kicker: 'Who brewed', value: ctx.person(f.people[0]!.userId), sub: 'brewed most', list: f.people.slice(0, 5).map((p) => ({ name: ctx.person(p.userId), detail: plural(p.brews, 'brew') })) });

  out.push({ key: 'summary', kicker: `${whose} ${f.year} in coffee`, value: plural(r.brews, 'brew'), list: summaryLines(f, ctx) });
  return out;
}

// The summary card's lines (and, later, its shareable image).
export function summaryLines(f: YearFigures, ctx: SlideContext): Array<{ name: string; detail: string }> {
  const r = f.recap;
  const lines: Array<{ name: string; detail: string } | null> = [
    { name: 'Days brewed', detail: r.daysBrewed.toLocaleString() },
    { name: 'Coffee used', detail: ctx.weight(r.coffeeGrams) },
    r.volume && { name: ctx.mine ? 'You drank' : 'Drunk', detail: `${approx(r.volume.estimated)}${ctx.volume(r.volume.ml)}` },
    f.streak && { name: 'Longest streak', detail: plural(f.streak.days, 'day') },
    r.beansBrewed[0] ? { name: 'Top bean', detail: r.beansBrewed[0].label } : null,
    f.origins[0] ? { name: 'Top origin', detail: f.origins[0].name } : null,
    r.topRecipe && { name: 'Top recipe', detail: r.topRecipe.name },
    r.best[0] ? { name: 'Best cup', detail: stars(r.best[0].rating) } : null,
  ];
  return lines.filter((l): l is { name: string; detail: string } => l !== null);
}

// How people are named on the bar's year: "You", others by their name
// (auth.md §1, "Name"), and anyone without one "Member 1", "Member 2"… in
// the order they brewed most. Emails are never shown here.
export function personLabels(people: ReadonlyArray<{ userId: string }>, me: string | null, nameOf: (userId: string) => string | null = () => null): (userId: string) => string {
  const unnamed = people.map((p) => p.userId).filter((id) => id !== me && !nameOf(id));
  return (userId) => (userId === me ? 'You' : (nameOf(userId) ?? `Member ${unnamed.indexOf(userId) + 1 || unnamed.length + 1}`));
}

// How long a slide stays before the next one starts by itself
// (docs/api/recaps.md §11c "Moving on"): long enough to read it.
export const SLIDE_MS = { intro: 4000, base: 5000, sub: 1500, row: 700, max: 12000 };
export function slideDuration(slide: Slide): number {
  if (slide.key === 'intro') return SLIDE_MS.intro;
  const ms = SLIDE_MS.base + (slide.sub ? SLIDE_MS.sub : 0) + (slide.list?.length ?? 0) * SLIDE_MS.row;
  return Math.min(SLIDE_MS.max, ms);
}
