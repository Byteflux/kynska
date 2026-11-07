# Decide what to write: music theory, with a check for each decision

The other pages prove that the code plays what you wrote. This one is for deciding what to write. Each rule is a **default with its reason**: music breaks every one of them on purpose, so when you break one, do it on purpose and say so with the music. Each rule names the check that shows what you did.

`kynska harmony song.js --sections <form>` measures most of them, from the events: the key of each section and every note outside it, the chord at each change over its bass, how often each other layer plays a chord tone on the beat, and clashes between layers.

## Key and scale

- **Choose a key for each section before writing notes**, and write it in your expected events ("verse: D minor").
- **Write pitches as scale degrees** where you can: `n("0 2 4").scale("D4:minor")` keeps every note in the key. Chords from symbols, `chord("<Dm9 Gm9>").voicing()`, are in the key only if the symbols are.
- **Proof:** `harmony` names each section's key. "Unclear" means the notes fit two keys about equally: usually a minor key and its relative major (D minor and F major share every note), or a vamp between two chords (i and V) that reads as the key of the V. Land the tonic chord on strong bars and at the ends of phrases, or accept the ambiguity.

## Notes outside the key

Notes outside the key are normal, and most have a name. `harmony` lists each with its usual reason, and every one should be one you meant; an unexplained one is usually a typo (a sharp for a flat, a wrong letter).

- **In minor, the raised 7th** (C# in D minor) makes the V chord major (A7), which pulls back to the tonic. The most common outside note of all.
- **In minor, the raised 6th** (B in D minor): melodic minor, or the Dorian mode.
- **In major, notes borrowed from the parallel minor** (modal mixture): the minor iv (Fm in C major), bVI (Ab), bVII (Bb), bIII (Eb). Mixture is more common in major keys than in minor, where its usual form is a major tonic at the very end.
- **Blue notes:** the flat 3rd, 5th and 7th over major chords, in blues and the styles that come from it.

## Melody against the chords

- **On the beat, play chord tones**, especially on beat 1 and on held notes. Scale notes that are not in the triad (the 9th, 11th, 13th) are colour; notes between beats can move freely.
- **A note a minor 2nd or minor 9th above a chord tone that sounds with it** (F over a C major chord's E) is the harshest choice; jazz theory calls it an avoid note, better read as "handle with care". Use it short, or between beats, or not at all. A semitone *below* a chord tone is a major 7th above it, a common colour.
- **Minor pentatonic** (`scale("D4:minor:pentatonic")`: D F G A C) has no semitones, so a melody on it fits most chords of the key, but not every one: over A7, its C against the chord's C# is the blues "sharp 9" sound, a colour when meant. `harmony` lists it as a clash when the C# sounds above the C.
- **Proof:** `harmony`'s line for each melodic layer, "N of M notes in the chord" on the beat, with the ones that are not; and its clashes, none or each one meant. Short notes off the beat are counted as passing, not listed.

## Bass

- **Play each chord's root at the chord change**, usually on beat 1 with the kick. Another chord note in the bass is an inversion (Dm/F), which sounds less settled.
- **Proof:** `harmony` writes the bass under each chord as `/X` when it is not the root: only the inversions you meant should show it.

## Sections and contrast

- **Something changes between sections:** the key, the chords, the register (an octave up), the density (layers in or out) or the rhythm. Groove music (hip-hop, house, techno) usually keeps one key and changes density; songs more often change chords or key.
- **Proof:** `form` shows which layers play in each section; `harmony` the key and chords of each.

## Changing key

- **Closely related keys** are those whose key signatures differ by at most one accidental: they share most of their notes and chords, so a change between them sounds smooth. The relative key shares every note (D minor and F major); the keys a fifth up and down change one note.
- **Distant keys** (four or more notes changed) sound abrupt: use that as an effect, like a last chorus lifted one or two semitones.
- **To change smoothly**, pass through a chord both keys share (Dm is i in D minor and vi in F major), or arrive on the new key's V chord first.
- **Proof:** `harmony` reports "changes key from X", the relation, and how many scale notes changed.

## Mixing scales, and what each looks like in `harmony`

| Technique | What `harmony` shows |
|---|---|
| Minor-key variants (harmonic, melodic minor) | outside notes: the raised 7th or 6th, in the bars of the V chord or the melody |
| A smaller scale inside the key (pentatonic) | no outside notes; the melody's off-chord notes are colour, not clashes |
| A borrowed chord | outside notes "from the parallel minor", in that chord's bars only |
| A blues clash | clashes in the melody over major chords: meant, so say so |
| A key change | a section whose key differs, with the relation and notes changed |
| Two keys at once (polytonality) | clashes in nearly every bar between two layers: rare outside 20th-century concert music |

## What `harmony` cannot see

It reads events. A layer without pitches (drums, `crackle`, a sample played by name) has no notes; a sampled loop's pitches are invisible. Chords are named only where a layer plays three or more notes together, so an arpeggio is a melody to it.

## Sources

- C. L. Krumhansl and E. J. Kessler (1982), "Tracing the dynamic changes in perceived tonal organization in a spatial representation of musical keys", *Psychological Review* 89(4): the key profiles `harmony` uses.
- Open Music Theory (CC BY-SA 4.0; cited, not copied): Brian Jarvis, [Modal Mixture](https://viva.pressbooks.pub/openmusictheory/chapter/modal-mixture/); John Peterson, [Extended Tonicization and Modulation to Closely Related Keys](https://viva.pressbooks.pub/openmusictheory/chapter/extended-tonicization-and-modulation-to-closely-related-keys/).
- Mark Levine, *The Jazz Theory Book* (1995), on avoid notes as "handle with care"; [Avoid note](https://en.wikipedia.org/wiki/Avoid_note) for the minor-9th definition.
