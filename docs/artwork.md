# Page Grove artwork

## Banner

Saved asset: `public/grove-banner.webp`.
Generated using the built-in ImageGen tool on October 12, 2026. The output was inspected, resized to 1500 pixels wide, and compressed to WebP. No external stock imagery is used.

Final prompt:

> Use case: illustration-story. Asset type: original library banner illustration for Page Grove HQ, a private ebook RSVP reading app. Create a refined hand-painted editorial watercolor and gouache illustration of a small quiet grove growing from and around the pages of a large open cream-colored book resting on soft rolling moss hills. A few leafy trees, a delicate fern, and little page shapes suggesting leaves. Warm ivory paper backdrop matching #eef0e3, muted sage green, forest green #203c31, soft golden ochre accents. Landscape composition, artwork concentrated in the right two-thirds with sparse pale negative space at the left so UI copy can be placed separately. Sophisticated literary and botanical feeling, subtle paper texture, elegant restrained detail, warm morning light. No text, letters, typography, logos, watermark, interface, or border. Finished actual illustration, not a mockup.

## Vector identity and motion

- Book-and-leaf logo: original SVG in `public/grove.svg` and the `Logo` component.
- Sample covers: original CSS layouts with botanical ornaments using Lucide's ISC-licensed icons. Titles and authors are rendered as text, not baked into generated artwork.
- Motion: bookshelf arrival, subtle cover lift, dialog entrance, and leaf sway during import. Operating-system reduced-motion preferences and the app's own setting disable decorative animation.
- RSVP: no word transitions; the anchor glyph is aligned to a fixed focal point. Long words scale to fit the viewport.
