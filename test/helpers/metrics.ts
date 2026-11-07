import type { Counter, Histogram } from 'prom-client';

// the value of a counter, or the count of a histogram, for labels (all the series matching them, added)
export const metricValue = async (
  metric: Counter | Histogram,
  labels: Record<string, string | number> = {}
): Promise<number> => {
  const { type, values } = await metric.get();
  const histogram = String(type) === 'histogram';
  return values
    .filter(value => {
      // a histogram has a value per bucket, the sum and the count
      const { metricName } = value as { metricName?: string };
      if (histogram && !metricName?.endsWith('_count')) {
        return false;
      }
      const valueLabels = new Map(Object.entries(value.labels));
      return Object.entries(labels).every(([name, expected]) => String(valueLabels.get(name)) === String(expected));
    })
    .reduce((total, { value }) => total + value, 0);
};
