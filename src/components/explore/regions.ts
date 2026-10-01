/**
 * Explore's region groups, in the order the region filter and the map's views offer them (pure — shared by the
 * Explore read model and the client map). North America by coast, the Alps by country, then the other ski regions.
 */
export const REGION_GROUP_ORDER = [
  'Northeast US',
  'Eastern Canada',
  'Western US',
  'Western Canada',
  'Austria',
  'Switzerland',
  'France',
  'Italy',
  'Germany',
  'Andorra & Spain',
  'Scandinavia',
  'Other Europe',
  'Japan',
  'South Korea',
  'Australia & New Zealand',
  'South America',
  'International',
] as const
