// Registry of website section types. Each type declares the fields the editor shows,
// the layout variants templates can render, and default content. Section content is
// stored per wedding (website_sections table), never inside a template, so switching
// templates or hiding a section never loses what the couple wrote.

export const SECTION_TYPES = {
  hero: {
    name: 'Welcome', icon: '✦', description: 'Your names, date and cover photo.', mvp: true, required: true,
    layouts: [['centered', 'Centred'], ['split', 'Photo beside text'], ['fullbleed', 'Full-screen photo']],
    fields: [
      { key: 'eyebrow', label: 'Small line above your names', type: 'text', placeholder: 'We are getting married' },
      { key: 'heading', label: 'Headline', type: 'text', placeholder: 'Leave blank to show your names' },
      { key: 'subheading', label: 'Tagline', type: 'textarea', placeholder: 'Uses your wedding tagline when blank' },
      { key: 'show_date', label: 'Show the wedding date', type: 'toggle' },
      { key: 'show_location', label: 'Show the location', type: 'toggle' },
      { key: 'cta_label', label: 'Button label', type: 'text', placeholder: 'RSVP' }
    ],
    defaults: () => ({ eyebrow: 'We are getting married', heading: '', subheading: '', show_date: true, show_location: true, cta_label: 'RSVP' })
  },
  story: {
    name: 'Our story', icon: '❦', description: 'How you met, told in moments.', mvp: true,
    layouts: [['timeline', 'Timeline'], ['alternating', 'Alternating photos'], ['simple', 'Simple text']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'intro', label: 'Introduction', type: 'textarea' },
      { key: 'milestones', label: 'Moments', type: 'list', itemLabel: 'moment', itemFields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'date_label', label: 'When', type: 'text', placeholder: 'Summer 2021' },
        { key: 'text', label: 'Story', type: 'textarea' },
        { key: 'image', label: 'Photo', type: 'image' }
      ] }
    ],
    defaults: () => ({
      title: 'Our story',
      intro: 'Every love story is beautiful, but ours is our favourite.',
      milestones: [
        { title: 'How we met', date_label: '', text: 'Tell your guests where it all began.', image: null },
        { title: 'The proposal', date_label: '', text: 'Share the moment you said yes.', image: null }
      ]
    })
  },
  countdown: {
    name: 'Countdown', icon: '◷', description: 'A live countdown to the big day.', mvp: true,
    layouts: [['boxes', 'Boxes'], ['minimal', 'Minimal']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'message', label: 'Message after the day', type: 'text' },
      { key: 'show_seconds', label: 'Show seconds', type: 'toggle' }
    ],
    defaults: () => ({ title: 'Counting down to forever', message: 'We are married! Thank you for celebrating with us.', show_seconds: false })
  },
  details: {
    name: 'Wedding details', icon: '❖', description: 'Ceremony, reception and schedule.', mvp: true,
    layouts: [['cards', 'Cards'], ['timeline', 'Schedule timeline']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'intro', label: 'Introduction', type: 'textarea' },
      { key: 'events', label: 'Events', type: 'list', itemLabel: 'event', itemFields: [
        { key: 'name', label: 'Event name', type: 'text', required: true },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'start_time', label: 'Starts', type: 'time' },
        { key: 'end_time', label: 'Ends', type: 'time' },
        { key: 'venue', label: 'Venue', type: 'text' },
        { key: 'address', label: 'Address', type: 'textarea' },
        { key: 'map_url', label: 'Map link', type: 'url', placeholder: 'https://maps.google.com/…' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'restricted', label: 'Private event (only guests with an invitation code see it)', type: 'toggle' }
      ] }
    ],
    defaults: (w = {}) => ({
      title: 'The celebration',
      intro: '',
      events: [
        { id: 'ceremony', name: 'Ceremony', date: (w.wedding_date_local || '').slice(0, 10), start_time: (w.wedding_date_local || '').slice(11, 16), end_time: '', venue: w.location || '', address: '', map_url: '', description: '', restricted: false },
        { id: 'reception', name: 'Reception', date: (w.wedding_date_local || '').slice(0, 10), start_time: '', end_time: '', venue: '', address: '', map_url: '', description: 'Dinner, dancing and celebration.', restricted: false }
      ]
    })
  },
  gallery: {
    name: 'Photo gallery', icon: '▦', description: 'Your favourite photos together.', mvp: true,
    layouts: [['grid', 'Grid'], ['masonry', 'Masonry'], ['carousel', 'Slideshow']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'intro', label: 'Introduction', type: 'textarea' },
      { key: 'show_captions', label: 'Show captions', type: 'toggle' }
    ],
    defaults: () => ({ title: 'Moments', intro: '', show_captions: true })
  },
  rsvp: {
    name: 'RSVP', icon: '✉', description: 'Collect responses from your guests.', mvp: true,
    layouts: [['card', 'Card'], ['split', 'Beside a photo']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'intro', label: 'Introduction', type: 'textarea' },
      { key: 'success_message', label: 'Thank-you message', type: 'textarea' },
      { key: 'closed_message', label: 'Message after the RSVP deadline', type: 'textarea' }
    ],
    defaults: () => ({
      title: 'Will you join us?',
      intro: 'Please let us know if you can make it.',
      success_message: 'Thank you! Your response has been saved.',
      closed_message: 'RSVPs are now closed. Please contact us directly if your plans have changed.'
    })
  },
  party: {
    name: 'Wedding party', icon: '♛', description: 'Introduce the people standing beside you.',
    layouts: [['grid', 'Grid']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'members', label: 'People', type: 'list', itemLabel: 'person', itemFields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'role', label: 'Role', type: 'text', placeholder: 'Maid of honour' },
        { key: 'bio', label: 'A line about them', type: 'textarea' },
        { key: 'image', label: 'Photo', type: 'image' }
      ] }
    ],
    defaults: () => ({ title: 'Wedding party', members: [{ name: '', role: 'Best man', bio: '', image: null }, { name: '', role: 'Maid of honour', bio: '', image: null }] })
  },
  dresscode: {
    name: 'Dress code', icon: '✂', description: 'What to wear and colours to avoid.',
    layouts: [['simple', 'Simple']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'code', label: 'Dress code', type: 'text', placeholder: 'Black tie optional' },
      { key: 'description', label: 'Details', type: 'textarea' },
      { key: 'colours', label: 'Colours (comma separated hex codes)', type: 'text', placeholder: '#7b1e3a, #b08d57' }
    ],
    defaults: () => ({ title: 'Dress code', code: 'Formal', description: '', colours: '' })
  },
  venue: {
    name: 'Venue & directions', icon: '⌖', description: 'Help guests find their way.',
    layouts: [['simple', 'Simple']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'name', label: 'Venue name', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'map_url', label: 'Map link', type: 'url' },
      { key: 'directions', label: 'Directions', type: 'textarea' },
      { key: 'parking', label: 'Parking', type: 'textarea' }
    ],
    defaults: (w = {}) => ({ title: 'Getting there', name: w.location || '', address: '', map_url: '', directions: '', parking: '' })
  },
  travel: {
    name: 'Travel & stay', icon: '✈', description: 'Hotels and transport for guests.',
    layouts: [['simple', 'Simple']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'intro', label: 'Introduction', type: 'textarea' },
      { key: 'hotels', label: 'Places to stay', type: 'list', itemLabel: 'place', itemFields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'url', label: 'Website', type: 'url' },
        { key: 'distance', label: 'Distance', type: 'text', placeholder: '10 minutes by car' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ] },
      { key: 'transport', label: 'Getting around', type: 'textarea' }
    ],
    defaults: () => ({ title: 'Travel & accommodation', intro: '', hotels: [], transport: '' })
  },
  registry: {
    name: 'Gift registry', icon: '❀', description: 'Link to registries or share gift details.',
    layouts: [['simple', 'Simple']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'intro', label: 'Message', type: 'textarea' },
      { key: 'links', label: 'Registries', type: 'list', itemLabel: 'registry', itemFields: [
        { key: 'label', label: 'Name', type: 'text' },
        { key: 'url', label: 'Link', type: 'url' },
        { key: 'description', label: 'Description', type: 'text' }
      ] },
      { key: 'details', label: 'Other gift details', type: 'textarea' }
    ],
    defaults: () => ({ title: 'Gifts', intro: 'Your presence is the greatest gift. If you would like to give something, here are a few ideas.', links: [], details: '' })
  },
  faq: {
    name: 'Questions', icon: '?', description: 'Answer the questions guests always ask.',
    layouts: [['accordion', 'Accordion'], ['list', 'List']],
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'items', label: 'Questions', type: 'list', itemLabel: 'question', itemFields: [
        { key: 'q', label: 'Question', type: 'text' },
        { key: 'a', label: 'Answer', type: 'textarea' }
      ] }
    ],
    defaults: () => ({ title: 'Questions & answers', items: [
      { q: 'Can I bring a plus-one?', a: 'Your invitation will say if a plus-one is included.' },
      { q: 'Are children welcome?', a: '' }
    ] })
  },
  guestbook: { name: 'Guestbook', icon: '✎', description: 'Messages from guests.', comingSoon: true, layouts: [['simple', 'Simple']], fields: [], defaults: () => ({ title: 'Guestbook' }) },
  games: { name: 'Wedding games', icon: '♠', description: 'Quizzes and games for guests.', comingSoon: true, layouts: [['simple', 'Simple']], fields: [], defaults: () => ({ title: 'Games' }) },
  programme: { name: 'Digital programme', icon: '☰', description: 'Order of service for the day.', comingSoon: true, layouts: [['simple', 'Simple']], fields: [], defaults: () => ({ title: 'Programme' }) }
};

export const SECTION_ORDER = ['hero', 'countdown', 'story', 'details', 'gallery', 'party', 'dresscode', 'venue', 'travel', 'registry', 'faq', 'rsvp', 'guestbook', 'games', 'programme'];

export const DEFAULT_SECTIONS = ['hero', 'countdown', 'story', 'details', 'gallery', 'rsvp'];

export function isKnownSection(type) {
  return Object.prototype.hasOwnProperty.call(SECTION_TYPES, type);
}

// Drop unknown keys and coerce values to the declared field types so stored content
// always has a predictable shape. Used on the server before saving.
export function sanitizeContent(type, content) {
  const def = SECTION_TYPES[type];
  if (!def || typeof content !== 'object' || content === null) return def ? def.defaults() : {};
  return sanitizeFields(def.fields, content);
}

function sanitizeFields(fields, src) {
  const out = {};
  for (const f of fields) out[f.key] = sanitizeValue(f, src[f.key]);
  if (typeof src.id === 'string') out.id = src.id.slice(0, 64);
  return out;
}

function sanitizeValue(field, v) {
  switch (field.type) {
    case 'toggle': return v === true || v === 'true' || v === 1;
    case 'list': {
      if (!Array.isArray(v)) return [];
      return v.slice(0, 50).map((item, i) => {
        const clean = sanitizeFields(field.itemFields, item && typeof item === 'object' ? item : {});
        if (!clean.id) clean.id = (item && typeof item.id === 'string' && item.id) || `${field.key}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        return clean;
      });
    }
    case 'image': return typeof v === 'string' && /^[a-z0-9-]{8,64}$/i.test(v) ? v : null;
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    case 'time': return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : '';
    case 'url': {
      if (typeof v !== 'string' || !v.trim()) return '';
      const s = v.trim().slice(0, 500);
      return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
    }
    case 'textarea': return typeof v === 'string' ? v.slice(0, 5000) : '';
    default: return typeof v === 'string' ? v.slice(0, 300) : '';
  }
}

export function sanitizeSettings(type, settings) {
  const def = SECTION_TYPES[type];
  const layouts = def ? def.layouts.map((l) => l[0]) : [];
  const s = settings && typeof settings === 'object' ? settings : {};
  return { layout: layouts.includes(s.layout) ? s.layout : null };
}
