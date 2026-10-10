import { Star } from 'lucide-react';

/** Read-only 1–5 star rating drawn with icons. */
export default function StarRating({ value, size = 15 }) {
  return (
    <span className="star-rating" role="img" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={n <= value ? 'on' : ''} aria-hidden="true" />)}
    </span>
  );
}
