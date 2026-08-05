// Reads a South African vehicle licence disc from a photo and returns
// structured data. Discs are photographed through windscreens at odd angles,
// so the model is told to return nulls rather than guess.

const MODEL = 'claude-sonnet-4-6';
const MAX_BYTES = 5 * 1024 * 1024;

const PROMPT = `You are reading a South African vehicle licence disc (motor vehicle licence).

The photo may be rotated, angled, reflective or partly obscured — read it in any orientation.

Extract these fields, using the printed labels as your guide:
- vin            : the "VIN" field. Exactly 17 characters, letters and digits. Never contains I, O or Q.
- engine_no      : the "Engine no./Enjinnr." field
- make           : the "Make" field (e.g. BMW, TOYOTA, VOLKSWAGEN)
- description    : the "Description/Beskrywing" field (e.g. "Sedan (closed top)")
- licence_no     : the "Licence no./Lisensienr." field
- register_no    : the "Veh. register no./Vrt.registernr." field
- expiry_date    : the "Date of expiry/Vervaldatum" field, as YYYY-MM-DD
- test_date      : the "Date of test/Datum van toets" field, as YYYY-MM-DD
- gvm            : the "GVM/BVM" value including units
- tare           : the "Tare/Tarra" value including units

Rules:
- Return ONLY a JSON object. No markdown, no backticks, no explanation.
- Use null for any field you cannot read with confidence. Do NOT guess.
- For the VIN, only return a value if you can read all 17 characters clearly. If any character is ambiguous, return null.
- Do not correct or "fix" what is printed. Transcribe exactly.

Respond with exactly this shape:
{"vin":null,"engine_no":null,"make":null,"description":null,"licence_no":null,"register_no":null,"expiry_date":null,"test_date":null,"gvm":null,"tare":null}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Disc scanning is not configured on this site yet.' });
  }

  try {
    const { image, media_type } = req.body || {};
    if (!image) return res.status(400).json({ error: 'No image supplied.' });

    const mt = ['image/jpeg', 'image/png', 'image/webp'].includes(media_type) ? media_type : 'image/jpeg';
    if (image.length * 0.75 > MAX_BYTES) {
      return res.status(413).json({ error: 'That image is too large — please try again.' });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
            { type: 'text', text: PROMPT }
          ]
        }]
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Vision API error', r.status, detail.slice(0, 400));
      return res.status(502).json({ error: 'Could not read the disc right now. Please try again.' });
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) {
      return res.status(422).json({ error: "Couldn't read that disc. Try a clearer, straighter photo." });
    }

    // Never trust a VIN that isn't structurally valid
    const vin = String(parsed.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    parsed.vin = /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
    parsed.vin_unreadable = !parsed.vin;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('disc handler', err);
    return res.status(500).json({ error: 'Something went wrong reading that image.' });
  }
}
