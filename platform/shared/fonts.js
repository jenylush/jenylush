// Supported font pairings. Only these can be chosen, so every published site loads a
// small, known set of Google Fonts. `tier: 'premium'` pairings need the premium plan.

export const FONT_PAIRINGS = [
  { id: 'classic', name: 'Classic serif', heading: 'Cormorant Garamond', body: 'Lato', script: null, tier: 'free',
    google: 'family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Lato:wght@400;700' },
  { id: 'modern', name: 'Modern sans', heading: 'Montserrat', body: 'Inter', script: null, tier: 'free',
    google: 'family=Montserrat:wght@500;600&family=Inter:wght@400;600' },
  { id: 'romantic', name: 'Romantic script', heading: 'Playfair Display', body: 'Source Sans 3', script: 'Great Vibes', tier: 'free',
    google: 'family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=Source+Sans+3:wght@400;600&family=Great+Vibes' },
  { id: 'editorial', name: 'Editorial', heading: 'DM Serif Display', body: 'DM Sans', script: null, tier: 'free',
    google: 'family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;600' },
  { id: 'luxe', name: 'Luxe', heading: 'Cinzel', body: 'Raleway', script: 'Pinyon Script', tier: 'premium',
    google: 'family=Cinzel:wght@500;600&family=Raleway:wght@400;600&family=Pinyon+Script' },
  { id: 'playful', name: 'Playful', heading: 'Fredoka', body: 'Nunito', script: 'Pacifico', tier: 'premium',
    google: 'family=Fredoka:wght@500;600&family=Nunito:wght@400;700&family=Pacifico' },
  { id: 'garden', name: 'Garden party', heading: 'Libre Baskerville', body: 'Work Sans', script: 'Parisienne', tier: 'premium',
    google: 'family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Work+Sans:wght@400;600&family=Parisienne' }
];

export function getPairing(id) {
  return FONT_PAIRINGS.find((p) => p.id === id) || FONT_PAIRINGS[0];
}

export function googleFontsHref(pairing) {
  return `https://fonts.googleapis.com/css2?${pairing.google}&display=swap`;
}
